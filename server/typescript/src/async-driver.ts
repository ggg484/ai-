import { currentAsyncSettlementEpoch, hasReadyAsyncMicrotasks, pollAsyncDriverBatch, type AsyncCompletion } from "./async-runtime.ts";

type Capability = {
  asyncDriverIds(): bigint[];
  takeAsyncDriverReadyIds(): bigint[];
  driveAsyncOperation(id: bigint, callbacks: number): number;
  failAsyncDriver(): void;
};

/** One Room-local scheduler. Pending operations do not keep it runnable. */
export class AsyncDriver {
  private epoch = -1;
  private ready: AsyncCompletion[] = [];
  private scan: AsyncCompletion[] = [];
  private scanAgain = false;
  private phase = false;

  drive(game: Capability, player: Capability): boolean {
    let batch;
    try { batch = pollAsyncDriverBatch(); } catch {
      this.ready.length = this.scan.length = 0;
      this.scanAgain = false;
      game.failAsyncDriver(); player.failAsyncDriver();
      return hasReadyAsyncMicrotasks();
    }
    const epoch = currentAsyncSettlementEpoch();
    if (epoch !== this.epoch || batch.generation === 0n) {
      this.ready.length = this.scan.length = 0;
      this.scanAgain = false; this.epoch = epoch;
    }
    if (batch.generation === 0n) return false;
    const snapshot = () => [
      ...game.asyncDriverIds().map((operationId) => ({ source: 1, operationId })),
      ...player.asyncDriverIds().map((operationId) => ({ source: 4, operationId })),
    ];
    if (batch.rescan) {
      if (this.scan.length) this.scanAgain = true;
      else this.scan = snapshot();
    }
    const events = [...batch.events,
      ...game.takeAsyncDriverReadyIds().map((operationId) => ({ source: 1, operationId })),
      ...player.takeAsyncDriverReadyIds().map((operationId) => ({ source: 4, operationId })),
    ];
    for (const event of events) {
      if (event.source !== 1 && event.source !== 4) continue;
      if (this.ready.some((e) => e.source === event.source && e.operationId === event.operationId)) continue;
      if (this.ready.length < 128) this.ready.push(event);
      else if (!this.scan.length) this.scan = snapshot();
      else this.scanAgain = true;
    }
    let callbacks = 4;
    for (let polls = 0; polls < 16 && callbacks > 0; polls++) {
      this.phase = !this.phase;
      const event = this.phase ? this.ready.shift() ?? this.scan.shift() : this.scan.shift() ?? this.ready.shift();
      if (!event) break;
      const capability = event.source === 1 ? game : player;
      callbacks = capability.driveAsyncOperation(event.operationId, callbacks);
    }
    if (!this.scan.length && this.scanAgain) { this.scanAgain = false; this.scan = snapshot(); }
    return hasReadyAsyncMicrotasks() || this.ready.length > 0 || this.scan.length > 0;
  }
}
