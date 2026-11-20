import assert from 'node:assert/strict'
import test from 'node:test'
import { OnlineSocket } from '../dist/index.js'
import { NetworkDiagnostics } from '../dist/diagnostics.js'
import { RoomSwitchDriver } from '../dist/room-switch.js'
import { encodeRoomFrame, encodeJsonPayload } from '../dist/room-frame.js'

globalThis.WebSocket = class { static OPEN = 1; static CLOSING = 2; static CLOSED = 3 }
const switchId = `switch-${'a'.repeat(64)}`
const snapshot = phase => ({ switch_id: switchId, phase, source_room_id: 'source',
  target_room_id: 'target', target_generation: 1, expected_presence_epoch: 2 })

// Only the network is substituted; the default timeout, authority loop and target initial-state barrier are real.
class Wire extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  sent = []
  polls = 0
  constructor(kind, halfOpen, connection) {
    super(); Object.assign(this, { kind, halfOpen, connection })
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')) })
  }
  message(data) { const event = new Event('message'); Object.defineProperty(event, 'data', { value: data }); this.dispatchEvent(event) }
  send(value) {
    if (this.kind === 'room') {
      queueMicrotask(() => {
        for (const [type, body] of [['room_joined', { generation: 1, session_id: 'fixture' }], ['state', { ready: true }]]) {
          const frame = encodeRoomFrame(type, 1, encodeJsonPayload(body))
          const outer = new Uint8Array(frame.length + 1); outer[0] = 1; outer.set(frame, 1)
          this.message(outer.buffer)
        }
      })
      return
    }
    const request = JSON.parse(value); this.sent.push(request)
    if (this.halfOpen && this.connection === 1 && request.type === 'room_switch_state') return
    let payload = {}
    if (request.type === 'auth') payload = { user_id: 'role', game_id: 'game', expires_at_unix_seconds: 9999999999 }
    if (request.type === 'room_switch_current') payload = { switch: this.connection > 1 ? snapshot('connecting') : null }
    if (request.type === 'room_switch_state') payload = snapshot(++this.polls < 3 ? 'connecting' : 'completed')
    if (request.type === 'room_credential') payload = { room_transport: 'websocket',
      credential: { room_id: 'target', room_generation: 1, presence_epoch: 3 },
      websocket_transport: { transport: 'websocket', endpoint: 'wss://room.invalid/private-address', room_id: 'target', token: 'SECRET_CREDENTIAL', transport_epoch: 3 } }
    queueMicrotask(() => this.message(JSON.stringify({ type: request.type, payload, request_id: request.request_id })))
  }
  close() { this.readyState = 3 }
}

for (const halfOpen of [false, true]) test(`switch diagnostics cover ${halfOpen ? 'default 20-second half-open recovery' : 'ordinary switching'} without poll spam`, async () => {
  let connections = 0, completions = 0
  const wires = []
  const socket = new OnlineSocket({ gatewayUrl: 'wss://control.invalid/private-address', gameId: 'game', defaultQueueName: 'lobby',
    webSocketFactory: url => { const room = url.includes('room.invalid'); const wire = new Wire(room ? 'room' : 'control', halfOpen, room ? 0 : ++connections); wires.push(wire); return wire } })
  socket.on('roomSwitchCompleted', () => completions++)
  try {
    await socket.connect({ token: 'SECRET_AUTH', userId: '', gameId: '', onlineCompatibilityRevision: 0, expiresAtUnixSeconds: 0 })
    const source = { close() {}, send() {} }
    socket.rooms.set('source', { transport: source, handle: { roomId: 'source' }, credential: {}, terminal: false })
    socket.handleRoomEnvelope('source', source, { channel: 'control_reliable', type: '__cysj_room_switch', payload: encodeJsonPayload(snapshot('connecting')) })
    await socket.roomSwitches.offer(switchId)
    const events = (await socket.networkSnapshot()).diagnostics
    const stages = events.map(e => e.stage)
    assert.equal(completions, 1)
    assert.equal(socket.rooms.has('source'), false)
    assert.equal(socket.rooms.get('target').initialStateReceived, true)
    assert.equal(stages.filter(s => s === 'switch_received').length, 1)
    assert.equal(stages.filter(s => s === 'switch_phase').length, halfOpen ? 1 : 2)
    assert.equal(stages.filter(s => s === 'switch_completed').length, 1)
    assert(stages.indexOf('switch_target_ready') < stages.indexOf('switch_completed'))
    assert(!/SECRET|private-address|wss:|ready":true/.test(JSON.stringify(events)))
    const reports = wires.flatMap(w => w.sent).filter(r => r.payload.client_wait)
    if (halfOpen) {
      const timeout = events.find(e => e.stage === 'control_request_timeout')
      assert(timeout.durationMs >= 19_900)
      assert.equal(timeout.open, true)
      assert.equal(timeout.switchId, switchId)
      assert.equal(connections, 2)
      assert(stages.indexOf('switch_received') < stages.indexOf('control_request_timeout'))
      assert(stages.indexOf('control_request_timeout') < stages.indexOf('control_invalidated'))
      assert(stages.includes('control_recovered'))
      assert.equal(reports.length, 1)
      assert.equal(reports[0].payload.client_wait.request_sequence, timeout.requestSequence)
      assert.equal(reports[0].payload.client_wait.wait_ms, timeout.durationMs)
      assert.equal(reports[0].payload.client_wait.socket_open, true)
    } else { assert.equal(connections, 1); assert.equal(reports.length, 0) }
  } finally { socket.close() }
})

test('history stays bounded and exported snapshots cannot mutate retained evidence', () => {
  const history = new NetworkDiagnostics()
  for (let i = 0; i < 1000; i++) history.record({ stage: 'control_invalidated' })
  const first = history.snapshot()
  assert.equal(first.length, 64); assert.equal(first[0].sequence, 937)
  first[0].stage = 'tampered'; first.length = 0
  assert.equal(history.snapshot()[0].stage, 'control_invalidated')
})

test('polling and failed-query streaks are summarized and diagnostic exceptions cannot change cancellation', async () => {
  let calls = 0, failed = 0
  const records = []
  const driver = new RoomSwitchDriver({
    query: async () => { if (++calls <= 50) throw new Error('SECRET'); return snapshot(calls < 100 ? 'preparing' : 'cancelled') },
    prepare: async () => assert.fail('Cancellation must not prepare a target'), discardTarget() {}, retireSource() {}, holdSource() {},
    notify(kind) { if (kind === 'failed') failed++ },
    diagnostic(event) { records.push(event); throw new Error('observer failed') },
  }, async () => {})
  await driver.offer(switchId)
  await driver.offer(switchId)
  assert.equal(failed, 1)
  assert.equal(records.filter(e => e.stage === 'switch_query_failed').length, 1)
  assert.equal(records.filter(e => e.stage === 'switch_query_recovered').length, 1)
  assert.equal(records.filter(e => e.stage === 'switch_failed').length, 1)
  assert(records.length < 10)
  assert(!JSON.stringify(records).includes('SECRET'))
})
