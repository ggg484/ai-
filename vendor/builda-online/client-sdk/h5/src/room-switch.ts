import type { NetworkDiagnostic } from './diagnostics.js'

/** Platform-driven room changes. Game callbacks only observe the protocol. */
export interface SwitchSnapshot {
  switch_id: string
  phase: string
  source_room_id: string
  target_room_id?: string
  target_generation?: number
  expected_presence_epoch?: number
  current_room_id?: string | null
  error_code?: string
}

export interface RoomSwitchEvent<T = unknown> {
  switchId: string
  sourceRoomId: string
  targetRoomId?: string | undefined
  currentRoomId?: string | undefined
  errorCode?: string | undefined
  committed?: boolean | undefined
  room?: T | undefined
}

export interface SwitchDriverHost<T> {
  query(switchId: string): Promise<SwitchSnapshot>
  prepare(snapshot: SwitchSnapshot): Promise<T>
  isReady?(snapshot: SwitchSnapshot, room: T): boolean
  discardTarget(roomId: string): void
  retireSource(roomId: string): void
  holdSource(roomId: string, hold: boolean): void
  notify(kind: 'started' | 'completed' | 'failed', event: RoomSwitchEvent<T>): void
  diagnostic?(event: Omit<NetworkDiagnostic, 'sequence' | 'elapsedMs'>): void
}

/** H5 and Cocos share bounded automation and query authority before recovering a room. */
export class RoomSwitchDriver<T> {
  private readonly operations = new Map<string, Promise<void>>()
  private readonly finished = new Set<string>()
  private generation = 0

  constructor(private readonly host: SwitchDriverHost<T>, private readonly delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)), private readonly attempts = 240) {}

  dispose(): void { this.generation++; this.operations.clear(); this.finished.clear() }

  /** 已确认终结的操作不能被迟到推送重新挂到来源房间。 */
  hasFinished(switchId: string): boolean { return this.finished.has(switchId) }

  offer(switchId: string, origin: 'notice' | 'restore' | 'recovery' = 'recovery'): Promise<void> {
    const previous = this.operations.get(switchId)
    if (previous) return previous
    if (!/^switch-[a-f0-9]{64}$/.test(switchId)) return Promise.resolve()
    if (this.operations.size >= 64) {
      const oldest = this.finished.values().next().value
      if (oldest === undefined) return Promise.resolve()
      this.operations.delete(oldest)
      this.finished.delete(oldest)
    }
    this.trace({ stage: 'switch_received', switchId, origin })
    const operation = this.run(switchId, this.generation)
    this.operations.set(switchId, operation)
    void operation.then(() => {
      if (this.operations.get(switchId) === operation) this.finished.add(switchId)
    })
    return operation
  }

  private notice(kind: 'started' | 'completed' | 'failed', event: RoomSwitchEvent<T>): void {
    if (kind !== 'started') this.trace({ stage: event.errorCode === 'ROOM_SWITCH_STATUS_UNKNOWN' ? 'switch_status_unknown' : `switch_${kind}`, switchId: event.switchId })
    if (kind !== 'started' && event.errorCode !== 'ROOM_SWITCH_STATUS_UNKNOWN') this.finished.add(event.switchId)
    try { this.host.notify(kind, event) } catch { /* UI failures cannot cancel a switch. */ }
  }

  private trace(event: Omit<NetworkDiagnostic, 'sequence' | 'elapsedMs'>): void {
    try { this.host.diagnostic?.(event) } catch { /* Diagnostics cannot affect authority or recovery. */ }
  }

  private async run(switchId: string, generation: number): Promise<void> {
    let snapshot: SwitchSnapshot | undefined
    let started = false
    let committed = false
    let room: T | undefined
    let connecting = false
    let connectFailed = false
    let phase: string | undefined
    let queryFailed = false
    let targetAttempts = 0
    const deadline = Date.now() + 180_000
    for (let attempt = 0; attempt < this.attempts && Date.now() < deadline; attempt++) {
      if (generation !== this.generation) return
      try {
        if (attempt === 0) this.trace({ stage: 'switch_query_started', switchId })
        const queryStarted = performance.now()
        snapshot = await this.host.query(switchId)
        if (generation !== this.generation) return
        if (snapshot.switch_id !== switchId) throw new Error('ROOM_SWITCH_RESPONSE_INVALID')
        if (snapshot.phase !== phase || queryFailed) {
          const safePhase = ['preparing', 'connecting', 'freezing', 'cancelling', 'cancelled', 'committed', 'activating', 'completed', 'failed_after_commit'].includes(snapshot.phase) ? snapshot.phase : 'other'
          this.trace({ stage: queryFailed ? 'switch_query_recovered' : 'switch_phase', switchId, phase: safePhase,
            durationMs: Math.round(performance.now() - queryStarted) })
          phase = snapshot.phase
        }
        queryFailed = false
        committed ||= ['committed', 'activating', 'completed', 'failed_after_commit'].includes(snapshot.phase)
        if (!started) {
          started = true
          this.host.holdSource(snapshot.source_room_id, true)
          this.notice('started', { switchId, sourceRoomId: snapshot.source_room_id, targetRoomId: snapshot.target_room_id })
        }
        if (snapshot.phase === 'cancelled') {
          if (committed) throw new Error('ROOM_SWITCH_DECISION_CONFLICT')
          if (snapshot.target_room_id) this.host.discardTarget(snapshot.target_room_id)
          this.host.holdSource(snapshot.source_room_id, false)
          this.notice('failed', { switchId, sourceRoomId: snapshot.source_room_id,
            targetRoomId: snapshot.target_room_id, currentRoomId: snapshot.current_room_id ?? undefined,
            errorCode: snapshot.error_code ?? 'ROOM_SWITCH_CANCELLED', committed: false })
          return
        }
        if (snapshot.phase === 'failed_after_commit') {
          this.host.retireSource(snapshot.source_room_id)
          if (snapshot.target_room_id) this.host.discardTarget(snapshot.target_room_id)
          this.notice('failed', { switchId, sourceRoomId: snapshot.source_room_id,
            targetRoomId: snapshot.target_room_id, currentRoomId: snapshot.current_room_id ?? undefined, errorCode: snapshot.error_code ?? 'ROOM_SWITCH_FAILED', committed: true })
          return
        }
        if (room !== undefined && this.host.isReady && !this.host.isReady(snapshot, room)) room = undefined
        if (snapshot.target_room_id && snapshot.target_generation && !connecting && room === undefined
          && !['preparing', 'cancelling'].includes(snapshot.phase)) {
          connecting = true
          connectFailed = false
          const prepareStarted = performance.now()
          if (++targetAttempts === 1) this.trace({ stage: 'switch_target_connect_started', switchId })
          void this.host.prepare(snapshot).then((handle) => {
            if (generation === this.generation) {
              room = handle
              this.trace({ stage: 'switch_target_ready', switchId, durationMs: Math.round(performance.now() - prepareStarted) })
            }
          }, () => {
            connectFailed = true
            if (generation === this.generation && targetAttempts === 1) this.trace({ stage: 'switch_target_connect_failed', switchId, durationMs: Math.round(performance.now() - prepareStarted) })
          }).finally(() => { connecting = false })
        }
        if (snapshot.phase === 'completed' && room !== undefined) {
          this.host.retireSource(snapshot.source_room_id)
          this.notice('completed', { switchId, sourceRoomId: snapshot.source_room_id,
            targetRoomId: snapshot.target_room_id, currentRoomId: snapshot.target_room_id, room, committed: true })
          return
        }
      } catch { // A transport error never proves cancellation; record only the start of a failed query streak.
        if (!queryFailed) this.trace({ stage: 'switch_query_failed', switchId })
        queryFailed = true
      }
      if (generation !== this.generation) return
      await this.delay(connectFailed ? 1_000 : 500)
    }
    if (generation !== this.generation) return
    this.operations.delete(switchId)
    if (!snapshot) this.trace({ stage: 'switch_status_unknown', switchId })
    if (snapshot) this.notice('failed', { switchId, sourceRoomId: snapshot.source_room_id,
      targetRoomId: snapshot.target_room_id,
      errorCode: 'ROOM_SWITCH_STATUS_UNKNOWN', committed })
  }
}
