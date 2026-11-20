/** Bounded, payload-free evidence retained by one Socket. Times use the local monotonic clock. */
export interface NetworkDiagnostic {
  sequence: number
  elapsedMs: number
  stage: string
  switchId?: string
  origin?: 'notice' | 'restore' | 'recovery'
  phase?: string
  connectionEpoch?: number
  requestSequence?: number
  requestType?: string
  durationMs?: number
  receiveIdleMs?: number
  open?: boolean
  closeCode?: number
}

/** Kept separate from gameplay events: diagnostics never invoke game callbacks or print payloads. */
export class NetworkDiagnostics {
  private readonly started = performance.now()
  private sequence = 0
  private readonly events: NetworkDiagnostic[] = []

  record(event: Omit<NetworkDiagnostic, 'sequence' | 'elapsedMs'>): void {
    this.events.push({ ...event, sequence: ++this.sequence, elapsedMs: Math.max(0, Math.round(performance.now() - this.started)) })
    if (this.events.length > 64) this.events.shift()
  }

  snapshot(): NetworkDiagnostic[] { return this.events.map(event => ({ ...event })) }
}
