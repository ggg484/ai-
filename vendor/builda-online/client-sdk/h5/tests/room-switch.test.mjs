import assert from 'node:assert/strict'
import test from 'node:test'
import { RoomSwitchDriver } from '../dist/room-switch.js'
import { OnlineSocket } from '../dist/index.js'
import { encodeRoomFrame } from '../dist/room-frame.js'

const switchId = `switch-${'a'.repeat(64)}`
const snapshot = (phase) => ({ switch_id: switchId, phase, source_room_id: 'lobby',
  target_room_id: 'battle', target_generation: 1, expected_presence_epoch: 0,
  current_room_id: phase === 'cancelled' ? 'lobby' : 'battle' })
const yieldTurn = () => new Promise((resolve) => setImmediate(resolve))

// 只替换网络边界；凭据、连接替换、初始状态屏障和完成通知仍执行实际 SDK。
class JoiningWebSocket extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  constructor() {
    super()
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')) })
  }
  send(value) {
    if (typeof value !== 'string') return
    queueMicrotask(() => {
      for (const [type, payload] of [['room_joined', { generation: 1, session_id: 'reconnected-target', reconnected: true }], ['state', { ready: true }]]) {
        const frame = encodeRoomFrame(type, 1, new TextEncoder().encode(JSON.stringify(payload)))
        const outer = new Uint8Array(frame.length + 1); outer[0] = 1; outer.set(frame, 1)
        const event = new Event('message'); Object.defineProperty(event, 'data', { value: outer.buffer })
        this.dispatchEvent(event)
      }
    })
  }
  close() { this.readyState = 3 }
}

test('a target disconnected before completion is replaced without a second join or host entry', async () => {
  let peers = 0, oldCloses = 0, completed = 0
  const hostEvents = []
  const socket = new OnlineSocket({ gatewayUrl: 'wss://example.invalid', gameId: 'game', defaultQueueName: 'lobby',
    webSocketFactory: () => { peers++; return new JoiningWebSocket() },
    chatGroupHostBridge: { available: () => false, roomNotificationsAvailable: () => true,
      notifyRoom: async (kind, args) => { hostEvents.push([kind, args.roomId]) } } })
  const targetHandle = { roomId: 'battle' }
  const oldTransport = { close() { oldCloses++ }, send() {} }
  socket.rooms.set('lobby', { transport: { close() {} }, handle: { roomId: 'lobby' }, credential: {} })
  socket.rooms.set('battle', { transport: oldTransport, handle: targetHandle, initialStateReceived: true,
    terminal: false, reconnecting: false, credential: {} })
  socket.hostRooms.add('battle')
  socket.switchByTarget.set('battle', switchId)
  socket.handleRoomDisconnected('battle', oldTransport, 'transport_closed')
  const credentialKeys = []
  socket.control.request = async (kind, args) => {
    if (kind === 'room_switch_state') return snapshot('completed')
    assert.equal(kind, 'room_credential')
    credentialKeys.push(args.idempotency_key)
    return { room_transport: 'websocket', credential: { room_id: 'battle', room_generation: 1, presence_epoch: 2 },
      websocket_transport: { transport: 'websocket', endpoint: 'wss://room.invalid/room', room_id: 'battle', token: 'fixture-only', transport_epoch: 2 } }
  }
  socket.on('roomSwitchCompleted', event => { completed++; assert.equal(event.room, targetHandle) })
  let timeout
  try {
    await Promise.race([socket.roomSwitches.offer(switchId), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Target switch did not reconnect')), 3000)
    })])
    assert.equal(completed, 1); assert.equal(peers, 1); assert.equal(oldCloses, 1)
    assert.equal(socket.rooms.get('battle').switchDisconnected, undefined)
    assert.equal(socket.rooms.has('lobby'), false)
    assert.equal(credentialKeys.length, 1)
    assert.deepEqual(hostEvents, [])
  } finally { clearTimeout(timeout); socket.close() }
})

test('late cancelled notices and restore snapshots cannot block ordinary source reconnection', async () => {
  let peers = 0, failed = 0, started = 0, credentials = 0, queries = 0
  const socket = new OnlineSocket({ gatewayUrl: 'wss://example.invalid', gameId: 'game', defaultQueueName: 'lobby',
    webSocketFactory: () => { peers++; return new JoiningWebSocket() } })
  const sourceHandle = { roomId: 'lobby' }
  const transport = { close() {}, send() {} }
  socket.rooms.set('lobby', { transport, handle: sourceHandle, terminal: false, reconnecting: false,
    credential: { credential: { room_id: 'lobby', room_generation: 1, presence_epoch: 1 } } })
  socket.switchBySource.set('lobby', switchId)
  socket.control.isOpen = () => true
  socket.control.request = async kind => {
    if (kind === 'room_switch_state') { queries++; return snapshot('cancelled') }
    if (kind === 'room_switch_current') return { switch: snapshot('cancelled') }
    assert.equal(kind, 'room_credential')
    credentials++
    return { room_transport: 'websocket', credential: { room_id: 'lobby', room_generation: 1, presence_epoch: 2 },
      websocket_transport: { transport: 'websocket', endpoint: 'wss://room.invalid/room', room_id: 'lobby', token: 'fixture-only', transport_epoch: 2 } }
  }
  socket.on('roomSwitchStarted', () => { started++ })
  socket.on('roomSwitchFailed', () => { failed++ })
  socket.on('roomSwitchCompleted', () => assert.fail('Cancellation must not complete'))
  let timeout
  try {
    await socket.roomSwitches.offer(switchId)
    assert.equal(socket.switchBySource.size, 0)
    socket.handleRoomEnvelope('lobby', transport, { channel: 'control_reliable', type: '__cysj_room_switch',
      payload: new TextEncoder().encode(JSON.stringify(snapshot('cancelled'))), seq: 1 })
    assert.equal(socket.switchBySource.size, 0, 'A late terminal notice must not reattach the switch')
    const recovered = new Promise(resolve => socket.on('roomReconnected', resolve))
    socket.handleRoomDisconnected('lobby', transport, 'transport_closed')
    await Promise.race([recovered, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Source did not reconnect after a cancelled switch')), 3000)
    })])
    assert.equal(socket.rooms.get('lobby').handle, sourceHandle)
    assert.equal(socket.switchBySource.size, 0)
    assert.equal(queries, 1); assert.equal(credentials, 1); assert.equal(peers, 1)
    assert.equal(started, 1); assert.equal(failed, 1)
  } finally { clearTimeout(timeout); socket.close() }
})

test('standard scenario: five of ten players automatically enter one new room; UI callback failures do not drive the protocol', async () => {
  const ready = new Set()
  const retired = new Set()
  const completed = new Set()
  const connected = new Map()
  const prepared = new Map()
  const players = Array.from({ length: 10 }, (_, index) => `p${index + 1}`)
  const drivers = players.slice(0, 5).map((player) => new RoomSwitchDriver({
    async query() {
      if (ready.size === 5) {
        for (const [role, resolve] of prepared) {
          const room = { roomId: 'battle', role }
          connected.set(role, room)
          resolve(room)
        }
        return snapshot('completed')
      }
      return snapshot('connecting')
    },
    prepare() {
      assert.equal(retired.size, 0)
      ready.add(player)
      return new Promise((resolve) => prepared.set(player, resolve))
    },
    retireSource() { assert.equal(ready.size, 5); retired.add(player) },
    discardTarget() { assert.fail('successful switches do not discard the target') },
    holdSource() {},
    notify(kind, event) {
      if (kind === 'completed') {
        assert.equal(event.room.roomId, 'battle')
        completed.add(player)
      }
      if (player === 'p3') throw new Error('simulated game UI exception')
    },
  }, yieldTurn, 20))
  await Promise.all(drivers.map((driver) => driver.offer(switchId)))
  assert.equal(completed.size, 5)
  assert.equal(retired.size, 5)
  assert.equal(connected.size, 5)
  for (const remaining of players.slice(5)) assert.equal(retired.has(remaining), false)
  await Promise.all(drivers.map((driver) => driver.offer(switchId)))
  assert.equal(completed.size, 5)
})

test('a missing player causes authoritative cancellation; no client retires the source', async () => {
  let reads = 0
  const actions = []
  const driver = new RoomSwitchDriver({
    async query() { return snapshot(++reads < 3 ? 'connecting' : 'cancelled') },
    prepare() { return new Promise(() => {}) },
    discardTarget(roomId) { actions.push(`discard:${roomId}`) },
    retireSource() { assert.fail('cancelled switches cannot retire the source') },
    holdSource(roomId, hold) { actions.push(`hold:${hold}`) },
    notify(kind, event) {
      if (kind === 'failed') assert.equal(event.currentRoomId, 'lobby')
      actions.push(kind)
    },
  }, yieldTurn, 8)
  await driver.offer(switchId)
  assert.deepEqual(actions, ['hold:true', 'started', 'discard:battle', 'hold:false', 'failed'])
})

test('a lost response after commit never causes the SDK to return to the source', async () => {
  let reads = 0
  const events = []
  const driver = new RoomSwitchDriver({
    async query() {
      reads++
      if (reads === 2) throw new Error('connection lost after server commit')
      return snapshot(reads === 1 ? 'committed' : 'completed')
    },
    async prepare() { return { roomId: 'battle' } },
    discardTarget() { assert.fail('unknown responses do not revoke the target') },
    retireSource() { events.push('retired') },
    holdSource(_roomId, hold) { assert.equal(hold, true) },
    notify(kind) { events.push(kind) },
  }, yieldTurn, 8)
  await driver.offer(switchId)
  assert.deepEqual(events, ['started', 'retired', 'completed'])
})

test('bounded query exhaustion reports unknown and preserves both recovery evidence and authority', async () => {
  const events = []
  const driver = new RoomSwitchDriver({
    async query() { return snapshot('connecting') },
    prepare() { return new Promise(() => {}) },
    discardTarget() { assert.fail('unknown is not cancellation') },
    retireSource() { assert.fail('unknown is not completion') },
    holdSource(_roomId, hold) { assert.equal(hold, true) },
    notify(kind, event) { events.push({ kind, event }) },
  }, yieldTurn, 3)
  await driver.offer(switchId)
  assert.equal(events.at(-1).event.errorCode, 'ROOM_SWITCH_STATUS_UNKNOWN')
  assert.equal(events.at(-1).event.currentRoomId, undefined)
  assert.equal(driver.hasFinished(switchId), false, 'Unknown must remain eligible for authoritative recovery')
})

test('closing the socket detaches late operation results', async () => {
  let deliver
  const events = []
  const driver = new RoomSwitchDriver({
    query() { return new Promise((resolve) => { deliver = resolve }) },
    async prepare() { assert.fail('disposed socket cannot open a room') },
    discardTarget() {}, retireSource() {}, holdSource() {},
    notify(kind) { events.push(kind) },
  }, yieldTurn, 3)
  const pending = driver.offer(switchId)
  driver.dispose()
  deliver(snapshot('completed'))
  await pending
  assert.deepEqual(events, [])
})

test('a lost source notice is discovered before reconnecting the old room', async () => {
  const socket = new OnlineSocket({ gatewayUrl: 'wss://example.invalid', gameId: 'game', defaultQueueName: 'lobby' })
  const transport = { close() {} }
  const entry = { transport, handle: { roomId: 'lobby' }, terminal: false, reconnecting: false, credential: { credential: {} } }
  socket.rooms.set('lobby', entry)
  const requests = []
  socket.control.request = async (type) => {
    requests.push(type)
    if (type === 'room_switch_current') return { switch: snapshot('connecting') }
    if (type === 'room_switch_state') return new Promise(() => {})
    assert.fail(`unexpected old-room reconnect: ${type}`)
  }
  socket.handleRoomDisconnected('lobby', transport, 'transport_closed')
  await yieldTurn()
  assert.equal(socket.switchBySource.get('lobby'), switchId)
  assert.equal(entry.reconnecting, false)
  assert.deepEqual(requests, ['room_switch_current', 'room_switch_state'])
  socket.roomSwitches.dispose()
})

test('a stale target transport callback cannot invalidate a newer target connection', () => {
  const socket = new OnlineSocket({ gatewayUrl: 'wss://example.invalid', gameId: 'game', defaultQueueName: 'lobby' })
  const entry = { transport: {}, handle: { roomId: 'battle' }, terminal: false, reconnecting: false }
  socket.rooms.set('battle', entry)
  socket.switchByTarget.set('battle', switchId)
  socket.handleRoomDisconnected('battle', {}, 'connection_replaced')
  assert.equal(entry.switchDisconnected, undefined)
})

test('recovering the Gateway in an already switched room does not replay the old switch notification', async () => {
  const socket = new OnlineSocket({ gatewayUrl: 'wss://example.invalid', gameId: 'game', defaultQueueName: 'lobby' })
  socket.rooms.set('battle', { handle: { roomId: 'battle' } })
  socket.control.request = async () => ({ switch: snapshot('completed') })
  socket.roomSwitches.offer = () => assert.fail('completed local switch must not restart')
  await socket.restoreRoomSwitch()
  assert.equal(socket.switchBySource.size, 0)
})

test('a long-lived SDK can switch more than 64 times without evicting active operations', async () => {
  let currentId
  let completed = 0
  const driver = new RoomSwitchDriver({
    async query() { return { ...snapshot('completed'), switch_id: currentId } },
    async prepare() { return { roomId: 'battle' } },
    discardTarget() {}, retireSource() {}, holdSource() {},
    notify(kind) { if (kind === 'completed') completed++ },
  }, yieldTurn, 8)
  for (let index = 0; index < 70; index++) {
    currentId = `switch-${index.toString(16).padStart(64, '0')}`
    await driver.offer(currentId)
  }
  assert.equal(completed, 70)
})
