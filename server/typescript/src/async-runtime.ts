import { currentRoomHost, log } from "./host.ts";
import {
  ASYNC_SOURCE_GAME_DATA,
  type AsyncCompletion,
  type AsyncCompletionBatch,
} from "./async-runtime-abi.ts";

export { ASYNC_SOURCE_GAME_DATA };
export { ASYNC_SOURCE_MANAGED_QUEUE } from "./async-runtime-abi.ts";
export type { AsyncCompletion, AsyncCompletionBatch };

const sourceWork = new Map<number, { hasWork: () => boolean; notify: (id: bigint) => void }>();
/** One source-local driver per Room capability; no cross-source handle lookup. */
export function registerAsyncSource(source: number, hasWork: () => boolean, notify: (id: bigint) => void): void { sourceWork.set(source, { hasWork, notify }); }
const MAX_POLL = 16;
const MAX_READY = 64;
export const MAX_MANAGED_TASKS = 32;
/** Host async-runtime generation `0` means unsupported; real hosts start at `1`. */
export const MIN_ASYNC_HOST_GENERATION = 1n;

export function isValidAsyncHostGeneration(generation: bigint): boolean {
  return generation >= MIN_ASYNC_HOST_GENERATION;
}

type ManagedTask = {
  alive: boolean;
  run: () => Promise<void>;
};

const managedTasks: ManagedTask[] = [];
let managedTaskEpoch = 0;
let asyncSettlementEpoch = 0;
let pendingMicrotasks = 0;
export function hasReadyAsyncMicrotasks(): boolean { return pendingMicrotasks > 0; }

export type AsyncSettlementTicket = {
  settlementEpoch: number;
  hostGeneration: bigint | null;
};

export function currentAsyncSettlementEpoch(): number {
  return asyncSettlementEpoch;
}

/** Drop deferred Promise/settlement work without resolving/rejecting waiters. */
export function invalidateAsyncSettlements(): void {
  asyncSettlementEpoch += 1;
  pendingMicrotasks = 0;
}

export function captureAsyncSettlementTicket(): AsyncSettlementTicket {
  return {
    settlementEpoch: asyncSettlementEpoch,
    hostGeneration: runtime.generationObserved ? runtime.hostGeneration : null,
  };
}

function asyncSettlementStillValid(ticket: AsyncSettlementTicket): boolean {
  if (ticket.settlementEpoch !== asyncSettlementEpoch) return false;
  if (!runtime.generationObserved) return true;
  if (runtime.hostGeneration === null || !isValidAsyncHostGeneration(runtime.hostGeneration)) return false;
  // Tasks scheduled before the first poll(0)/getAsync observation share the current generation.
  if (ticket.hostGeneration === null) return true;
  return runtime.hostGeneration === ticket.hostGeneration;
}

/** Resolve/reject on a microtask after re-checking generation and waiter liveness. */
export function scheduleDeferredSettlement(stillWaiter: () => boolean, run: () => void, ticket: AsyncSettlementTicket): void {
  if (!asyncSettlementStillValid(ticket)) return;
  pendingMicrotasks += 1;
  queueMicrotask(() => {
    if (ticket.settlementEpoch === asyncSettlementEpoch) pendingMicrotasks -= 1;
    if (!asyncSettlementStillValid(ticket)) return;
    if (!stillWaiter()) return;
    run();
  });
  requestAsyncDrive();
}

type RuntimeState = {
  hostGeneration: bigint | null;
  generationObserved: boolean;
  rescanRequired: boolean;
  rescanRepeat: boolean;
  rescanCursor: number;
  rescanSnapshot: bigint[];
  readyQueue: AsyncCompletion[];
  fairPhase: number;
};

const runtime: RuntimeState = {
  hostGeneration: null,
  generationObserved: false,
  rescanRequired: false,
  rescanRepeat: false,
  rescanCursor: 0,
  rescanSnapshot: [],
  readyQueue: [],
  fairPhase: 0,
};

export function resetAsyncRuntimeLocalState(): void {
  runtime.hostGeneration = null;
  runtime.generationObserved = false;
  runtime.rescanRequired = false;
  runtime.rescanRepeat = false;
  runtime.rescanCursor = 0;
  runtime.rescanSnapshot.length = 0;
  runtime.readyQueue.length = 0;
  runtime.fairPhase = 0;
}

function detachManagedTasks(): void {
  managedTaskEpoch += 1;
  invalidateAsyncSettlements();
  for (const task of managedTasks) task.alive = false;
  managedTasks.length = 0;
}

/** Drop async-runtime tasks and Host generation observation at a Room generation boundary. */
export function discardAsyncRuntimeGeneration(): void {
  detachManagedTasks();
  resetAsyncRuntimeLocalState();
}

export function admitAsyncRuntime(): boolean {
  if (runtime.generationObserved) {
    return runtime.hostGeneration !== null && isValidAsyncHostGeneration(runtime.hostGeneration);
  }
  try {
    const batch = hostPoll(0);
    if (!isValidAsyncHostGeneration(batch.generation)) return false;
    applyBatch(batch, false);
    return true;
  } catch {
    return false;
  }
}

export function isAsyncRuntimeSupported(): boolean {
  return admitAsyncRuntime();
}

export function observeAsyncGeneration(): bigint {
  admitAsyncRuntime();
  return runtime.hostGeneration ?? 0n;
}

/** Read the generation already observed by the shared poll path without polling again. */
export function currentObservedAsyncGeneration(): bigint | undefined {
  return runtime.generationObserved ? runtime.hostGeneration ?? undefined : undefined;
}

/** Register a user async task; returns false when the 32-task cap is reached (work is never invoked). */
function releaseManagedTask(task: ManagedTask, epoch: number): void {
  if (epoch !== managedTaskEpoch) return;
  task.alive = false;
  const index = managedTasks.indexOf(task);
  if (index >= 0) managedTasks.splice(index, 1);
}

export function runManagedTask(work: () => Promise<void>): boolean {
  const live = managedTasks.filter((task) => task.alive).length;
  if (live >= MAX_MANAGED_TASKS) return false;
  admitAsyncRuntime();
  const task: ManagedTask = {
    alive: true,
    run: work,
  };
  managedTasks.push(task);
  const epoch = managedTaskEpoch;
  const ticket = captureAsyncSettlementTicket();
  pendingMicrotasks += 1;
  queueMicrotask(() => {
    if (ticket.settlementEpoch === asyncSettlementEpoch) pendingMicrotasks -= 1;
    if (!task.alive || epoch !== managedTaskEpoch) return;
    if (!asyncSettlementStillValid(ticket)) {
      releaseManagedTask(task, epoch);
      return;
    }
    void (async () => {
      try {
        await task.run();
      } catch {
        if (epoch === managedTaskEpoch && asyncSettlementStillValid(ticket)) {
          log("error", "User async task failed");
        }
      } finally {
        releaseManagedTask(task, epoch);
      }
    })();
  });
  requestAsyncDrive();
  return true;
}

export function logAsyncCapacityRejected(kind: string): void {
  log("error", `User async task capacity rejected (${kind})`);
}

/** Fixed ASCII message; Online adapter tests match /must be synchronous; use runAsync/. */
export const SYNC_USER_HOOK_MUST_BE_SYNC = "must be synchronous; use runAsync";

export function isUserThenable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const kind = typeof value;
  if (kind !== "object" && kind !== "function") return false;
  return typeof (value as { then?: unknown }).then === "function";
}

function suppressUnhandledRejection(outcome: unknown): void {
  Promise.resolve(outcome).catch(() => {});
}

/**
 * Reject accidental thenable returns from sync user hooks. Does not run async work;
 * attaches a no-op rejection handler so the stray Promise cannot become an unhandled rejection.
 */
export function guardSyncUserReturn<T>(kind: string, outcome: T): T {
  if (!isUserThenable(outcome)) return outcome;
  suppressUnhandledRejection(outcome);
  currentRoomHost()?.log("error", `User Room sync hook misuse (${kind})`);
  throw new Error(SYNC_USER_HOOK_MUST_BE_SYNC);
}

function hostPoll(limit: number): AsyncCompletionBatch {
  const poll = currentRoomHost()?.asyncRuntimePoll;
  if (!poll) {
    return { generation: runtime.hostGeneration ?? 0n, rescan: false, events: [] };
  }
  return poll(limit);
}

function applyBatch(batch: AsyncCompletionBatch, consume: boolean): void {
  if (!isValidAsyncHostGeneration(batch.generation)) {
    if (runtime.generationObserved) {
      detachManagedTasks();
      resetAsyncRuntimeLocalState();
    }
    return;
  }
  const previous = runtime.hostGeneration;
  runtime.hostGeneration = batch.generation;
  if (!runtime.generationObserved) {
    runtime.generationObserved = true;
  } else if (previous !== null && previous !== batch.generation) {
    detachManagedTasks();
    resetAsyncRuntimeLocalState();
  }
  if (batch.rescan) requestRescan();
  void consume;
}

function requestRescan(): void {
  runtime.rescanRequired = true;
  if (runtime.rescanSnapshot.length > 0) runtime.rescanRepeat = true;
}

/** When deferred transform backlog is full, schedule rescan instead of dropping work. */
export function requestAsyncRescan(): void {
  requestRescan();
  requestAsyncDrive();
}

function enqueueReady(event: AsyncCompletion): void {
  // Lifecycle and managed queue dispatches are claimed separately; they do not occupy Game Data readiness.
  if (event.source !== ASYNC_SOURCE_GAME_DATA) { sourceWork.get(event.source)?.notify(event.operationId); return; }
  if (runtime.readyQueue.some((existing) => existing.source === event.source && existing.operationId === event.operationId)) {
    return;
  }
  if (runtime.readyQueue.length >= MAX_READY) {
    requestRescan();
    return;
  }
  runtime.readyQueue.push(event);
}

export function syncHostGeneration(): void {
  if (!runtime.generationObserved) return;
  try {
    applyBatch(hostPoll(0), false);
  } catch {
    // Host poll errors are ignored; typed reads still fail closed separately.
  }
}

export type IngestAsyncRuntimeResult =
  | { ok: true; batch: AsyncCompletionBatch }
  | { ok: false; reason: "host-poll-failed" };

/** Ingest Host completion notifications before Game Data poll steps run. */
export function ingestAsyncRuntimeCompletions(hasLocalWork = false): IngestAsyncRuntimeResult {
  syncHostGeneration();
  if (!runtime.generationObserved) {
    try {
      const batch = hostPoll(0);
      applyBatch(batch, false);
      return { ok: true, batch };
    } catch {
      return { ok: false, reason: "host-poll-failed" };
    }
  }
  const shouldPoll = [...sourceWork.values()].some((source) => source.hasWork())
    || hasLocalWork
    || runtime.rescanRequired
    || runtime.readyQueue.length > 0;
  if (!shouldPoll) {
    return { ok: true, batch: { generation: runtime.hostGeneration ?? 0n, rescan: false, events: [] } };
  }
  try {
    const batch = hostPoll(MAX_POLL);
    applyBatch(batch, true);
    for (const event of batch.events) enqueueReady(event);
    return { ok: true, batch };
  } catch {
    return { ok: false, reason: "host-poll-failed" };
  }
}

export function takeReadyCompletion(): AsyncCompletion | undefined {
  return runtime.readyQueue.shift();
}

export function asyncRescanRequired(): boolean {
  return runtime.rescanRequired;
}

export function nextRescanOperationId(liveAsyncIds: bigint[]): bigint | undefined {
  if (!runtime.rescanRequired) return undefined;
  if (runtime.rescanSnapshot.length === 0) {
    runtime.rescanSnapshot = [...liveAsyncIds];
    runtime.rescanCursor = 0;
  }
  if (runtime.rescanSnapshot.length === 0) {
    runtime.rescanRequired = false;
    runtime.rescanRepeat = false;
    return undefined;
  }
  if (runtime.rescanCursor >= runtime.rescanSnapshot.length) {
    runtime.rescanSnapshot.length = 0;
    runtime.rescanCursor = 0;
    if (runtime.rescanRepeat) {
      runtime.rescanRepeat = false;
      runtime.rescanRequired = true;
    } else {
      runtime.rescanRequired = false;
    }
    return undefined;
  }
  const id = runtime.rescanSnapshot[runtime.rescanCursor];
  runtime.rescanCursor += 1;
  return id;
}

export function nextFairPhase(): number {
  const phase = runtime.fairPhase;
  runtime.fairPhase = (phase + 1) % 4;
  return phase;
}

/** Schedule after this synchronous boundary; legacy hosts keep their original behavior. */
export function requestAsyncDrive(): void {
  try { currentRoomHost()?.requestDrive?.(); }
  catch {
    // Local work is already queued. A failed scheduling hint cannot change a
    // typed verdict, leak a task slot or throw into an unrelated callback.
    // Keep readiness visible to drive(); Host owns bounded scheduling recovery.
    try { log("error", "Async drive notification unavailable"); } catch { /* Preserve the result. */ }
  }
}

/** Independent driver ingestion. Legacy tick ingestion and its routing stay unchanged. */
export function pollAsyncDriverBatch(): AsyncCompletionBatch {
  const batch = hostPoll(MAX_POLL);
  applyBatch(batch, false);
  for (const event of batch.events) {
    if (event.source !== 1 && event.source !== 4) enqueueReady(event);
  }
  return batch;
}

/** Transfer already-ingested source-1 readiness without polling Host again. */
export function takeAsyncDriverNotifications(): AsyncCompletion[] { return runtime.readyQueue.splice(0); }
