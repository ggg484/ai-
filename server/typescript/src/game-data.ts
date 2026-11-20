/**
 * Replay is bounded by the published ID window and recent decisions per resource.
 * Explicit mutation IDs retry known requests. idempotency_expired does not prove
 * a historical write was not committed; never replace the ID to repeat a reward.
 * Resume of an already unknown operation stays unknown after receipt eviction.
 * See README.md for recovery and time-based game recipes. No first-send flag
 * is exposed to authors.
 */
import {
  ASYNC_SOURCE_GAME_DATA,
  admitAsyncRuntime,
  captureAsyncSettlementTicket,
  currentAsyncSettlementEpoch,
  ingestAsyncRuntimeCompletions,
  invalidateAsyncSettlements,
  nextFairPhase,
  nextRescanOperationId,
  requestAsyncRescan,
  scheduleDeferredSettlement,
  takeReadyCompletion,
  takeAsyncDriverNotifications,
  type AsyncSettlementTicket,
} from "./async-runtime.ts";
import { currentRoomHost } from "./host.ts";
import {
  I64_MAX,
  I64_MIN,
  WRITE_KINDS,
  canonicalJsonObject,
  canonicalScore,
  decodeJsonBytes,
  formatCanonicalInteger,
  isThenable,
  parseCanonicalInteger,
  publicCode,
  publicReason,
  safeNonNegative,
  validMutationId,
  type HostFailure,
  type HostFound,
  type HostOperation,
  type HostPoll,
  type HostProposal,
  type HostValue,
  type ResultKind,
} from "./game-data-abi.ts";
import {
  GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON,
  GAME_DATA_MESSAGE_QUEUE_ENABLED,
} from "./game-data-message-queue-feature.ts";

export type { ResultKind };

const recoveryMint: unique symbol = Symbol("cysj.gameData.recovery");

function isMessageQueueKind(kind: ResultKind): boolean {
  return kind === "queue-enqueue" || kind === "queue-receive" || kind === "queue-ack";
}

function isMessageQueueRequest(request: HostOperation): boolean {
  return request.tag === "queue-enqueue" || request.tag === "queue-receive" || request.tag === "queue-ack";
}

function queueErrorMutationId(options?: CallOptions, request?: HostOperation): string | undefined {
  const fromOptions = (options as (CallOptions & { mutationId?: unknown }) | undefined)?.mutationId;
  const fromRequest = request ? (request as { mutationId?: unknown }).mutationId : undefined;
  const value = fromOptions ?? fromRequest;
  return typeof value === "string" ? value : undefined;
}

/** Opaque recovery material bound to the original result type. Authors cannot construct it. */
export class RecoveryHandle<T> {
  readonly #id: bigint;
  readonly #kind: ResultKind;
  /** Invariant in T. An optional T would be covariant and would let handles cross result types. */
  readonly #resultType?: (value: T) => T;

  /** @internal Minted only by the SDK when the Host returns a recovery id. */
  constructor(mint: typeof recoveryMint, id: bigint, kind: ResultKind) {
    if (mint !== recoveryMint) throw new Error("RecoveryHandle cannot be constructed");
    this.#id = id;
    this.#kind = kind;
  }

  /** @internal */
  hostId(): bigint {
    return this.#id;
  }

  /** @internal */
  kind(): ResultKind {
    return this.#kind;
  }
}

/** Typed rejection payload for `*Async` helpers (same fields as {@link GameDataError}). */
export type GameDataAsyncError<T = never> = GameDataError<T>;

export type GameDataError<T = never> = {
  code: string;
  requestId: string;
  reason?: string;
  /** Human-readable local explanation; code and reason remain the stable fields for program logic. */
  message?: string;
  mutationId?: string;
  retryAfterMs?: number;
  recoveryHandle?: RecoveryHandle<T>;
  recoveryError?: { code: string; reason?: string };
};

/** Explain a Game Data error without interpreting unknown writes as failures. */
export function gameDataErrorMessage(code: string, reason?: string): string {
  if (code === "outcome_unknown") return "The write result is unknown. Keep any original recovery handle and do not submit a new write.";
  if (code === "rate_limited") {
    switch (reason) {
      case "game_write_limit": return "This game's writes exceeded the per-game limit. The request was not executed; retry after the indicated delay if provided, or write less often.";
      case "key_write_limit": return "Writes to this key exceeded the per-key limit. The request was not executed; retry after the indicated delay if provided, or spread or batch writes.";
      case "circuit_open": return "Game Data is temporarily paused after repeated service failures. The request was not executed; retry after the indicated delay if provided.";
      case "replica_busy": return "Game Data is temporarily busy. The request was not executed; retry after the indicated delay if provided.";
      case "quota_wait_too_long": return "This game is using more Game Data traffic than its current allowance. The request was not executed; retry after the indicated delay if provided, or read and write less data.";
      case "quota_queue_full": return "Too many of this game's Game Data requests are waiting for traffic allowance. The request was not executed; retry after the indicated delay if provided, and limit concurrent calls.";
      case "quota_deadline_short": return "This call did not have enough time left to wait for traffic allowance. The request was not executed; use a longer timeout or reduce Game Data traffic.";
      case "quota_replica_memory": return "Game Data is temporarily busy. The request was not executed; retry after the indicated delay if provided.";
      case "quota_shutdown": return "Game Data is temporarily unable to accept this request. The request was not executed; retry after the indicated delay if provided.";
      case "attempt_budget_exhausted": return "The Game Data request stayed rate limited until its retry budget ran out. Retry later with a bounded backoff, or reduce Game Data traffic.";
      default: return "The Game Data request was rate limited. Check the reason and retry after the indicated delay if provided.";
    }
  }
  if (code === "forbidden" && reason === "game_data_blocked") return "Game Data for this game was stopped by the platform. Contact the platform for help.";
  return "The Game Data request failed. Check the error code and reason.";
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: GameDataError<T> };
export type Poll<T> = { state: "pending" } | { state: "done"; result: Result<T> } | { state: "expired" };

type AsyncWaiter<T> = {
  ticket: AsyncSettlementTicket;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: GameDataAsyncError<T>) => void;
};

type Stored<T> = {
  id: bigint | null;
  driverEpoch?: number;
  kind: ResultKind;
  phase: "pending" | "done" | "expired";
  result?: Result<T>;
  proposedGeneration?: bigint;
  recoveryOf?: bigint;
  update?: (current: ReadResult<JSONObject>) => JSONObject;
  released: boolean;
  asyncWaiter?: AsyncWaiter<T>;
  /** Async Promise not yet settled; skip retained Host polls for this slot. */
  pendingAsyncSettlement?: boolean;
};

/** Synchronous handle. poll reads only a result the driver has already observed. */
export class Operation<T> {
  /** @internal */
  constructor(private readonly slot: Stored<T>, private readonly owner: GameData) {}

  poll(): Poll<T> {
    if (this.slot.released || this.slot.phase === "expired") return { state: "expired" };
    if (this.slot.phase === "done" && this.slot.result) return { state: "done", result: this.slot.result };
    return { state: "pending" };
  }

  release(): void {
    if (this.slot.released) return;
    this.slot.released = true;
    this.slot.phase = "expired";
    this.slot.result = undefined;
    this.slot.update = undefined;
    this.owner.releaseSlot(this.slot as Stored<unknown>);
  }
}

export type JSONValue = null | boolean | number | string | JSONValue[] | JSONObject;
export type JSONObject = { [key: string]: JSONValue };
export type CallOptions = { timeoutMs?: number };
/**
 * Object reads only.
 * @deprecated `fresh` is kept for compatibility, has no guaranteed effect and should not be set.
 */
export type ReadOptions = CallOptions & { fresh?: boolean };
export type WriteOptions = CallOptions & { mutationId?: string };
export type RemoveOptions = WriteOptions & { expectedRevision?: string };
export type ReadResult<T> = { found: true; value: T; revision: string; stateToken: string } | { found: false; stateToken: string };
export type WriteResult = { revision: string; changed: boolean; replayed: boolean };
export type RemoveResult = WriteResult & { removed: boolean };
export type ObjectRef = { kind: "object"; ns: string; key: string };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type QueueMessage = {
  messageId: string;
  payload: JSONObject;
  receipt: string;
  visibleUntil: number;
  expiresAt: number;
};
export type GameDataLimits = {
  nsMaxBytes: number;
  keyMaxBytes: number;
  memberMaxBytes: number;
  objectJsonMaxBytes: number;
  objectMaxDepth: number;
  batchReadMax: number;
  batchResponseMaxBytes: number;
  pageDefault: number;
  pageMax: number;
  queueMessageJsonMaxBytes: number;
  receiveMax: number;
  messageTtlDefaultMs: number;
  messageTtlMaxMs: number;
  visibilityDefaultMs: number;
  visibilityMaxMs: number;
  waitTimeoutMaxMs: number;
  cursorTtlMs: number;
  idempotencyWindowMs: number;
  transportMaxBytes: number;
};
export type Capabilities = { apiMajor: number; capabilityIds: string[]; limits: GameDataLimits };

const LIMIT_FIELDS: Array<[keyof GameDataLimits, string]> = [
  ["nsMaxBytes", "nsMaxBytes"],
  ["keyMaxBytes", "keyMaxBytes"],
  ["memberMaxBytes", "memberMaxBytes"],
  ["objectJsonMaxBytes", "objectJsonMaxBytes"],
  ["objectMaxDepth", "objectMaxDepth"],
  ["batchReadMax", "batchReadMax"],
  ["batchResponseMaxBytes", "batchResponseMaxBytes"],
  ["pageDefault", "pageDefault"],
  ["pageMax", "pageMax"],
  ["queueMessageJsonMaxBytes", "queueMessageJsonMaxBytes"],
  ["receiveMax", "receiveMax"],
  ["messageTtlDefaultMs", "messageTtlDefaultMs"],
  ["messageTtlMaxMs", "messageTtlMaxMs"],
  ["visibilityDefaultMs", "visibilityDefaultMs"],
  ["visibilityMaxMs", "visibilityMaxMs"],
  ["waitTimeoutMaxMs", "waitTimeoutMaxMs"],
  ["cursorTtlMs", "cursorTtlMs"],
  ["idempotencyWindowMs", "idempotencyWindowMs"],
  ["transportMaxBytes", "transportMaxBytes"],
];

function failure<T>(kind: ResultKind, code: string, reason?: string, requestId = ""): Result<T> {
  const error: GameDataError<T> = { code: publicCode(code), requestId };
  const stable = publicReason(reason);
  if (stable) error.reason = stable;
  error.message = gameDataErrorMessage(error.code, error.reason);
  return { ok: false, error };
}

function localError<T>(
  kind: ResultKind,
  code: string,
  reason?: string,
  details?: { mutationId?: string; recoveryHandle?: RecoveryHandle<T> },
): Operation<T> {
  const result = failure<T>(kind, code, reason);
  if (!result.ok && details?.mutationId !== undefined) result.error.mutationId = details.mutationId;
  if (!result.ok && details?.recoveryHandle !== undefined) result.error.recoveryHandle = details.recoveryHandle;
  const slot: Stored<T> = { id: null, kind, phase: "done", released: false, result };
  return new Operation(slot, detached);
}

function unknownResume<T>(kind: ResultKind, recoveryCode: string, reason?: string, handle?: RecoveryHandle<T>): Operation<T> {
  const recoveryError: { code: string; reason?: string } = { code: publicCode(recoveryCode) };
  const stable = publicReason(reason);
  if (stable) recoveryError.reason = stable;
  const error: GameDataError<T> = {
    code: publicCode("outcome-unknown"),
    requestId: "",
    message: gameDataErrorMessage("outcome_unknown"),
    recoveryError,
  };
  if (handle) error.recoveryHandle = handle;
  const slot: Stored<T> = { id: null, kind, phase: "done", released: false, result: { ok: false, error } };
  return new Operation(slot, detached);
}

const detached = {
  releaseSlot() {},
  discardFlag: false,
} as unknown as GameData;

function requireName(value: string, label: string): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes(String.fromCharCode(0))) return label;
  return undefined;
}

function optionalMutation(options: WriteOptions | undefined): string | undefined | false {
  if (!options?.mutationId) return undefined;
  return validMutationId(options.mutationId) ? options.mutationId : false;
}

function resolveTimeout(options: CallOptions | undefined, waitTimeoutMs = 0): number | undefined {
  const explicit = options?.timeoutMs;
  if (explicit === undefined) {
    const derived = Math.min(30_000, waitTimeoutMs + 5_000);
    return derived >= 1 && derived <= 30_000 && derived > waitTimeoutMs ? derived : undefined;
  }
  if (!Number.isInteger(explicit) || explicit < 1 || explicit > 30_000 || explicit <= waitTimeoutMs) return undefined;
  return explicit;
}

function foundObject(read: HostFound): ReadResult<JSONObject> | undefined {
  if (!read.found) return { found: false, stateToken: read.stateToken };
  try {
    const value = decodeJsonBytes(read.valueJson);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return { found: true, value: value as JSONObject, revision: read.revision, stateToken: read.stateToken };
  } catch {
    return undefined;
  }
}

function decodeValue<T>(kind: ResultKind, value: HostValue): Result<T> {
  try {
    return { ok: true, value: projectValue(kind, value) as T };
  } catch (error) {
    const reason = error instanceof Error && error.message === "range" ? "integer_overflow" : "invalid_response";
    const code = WRITE_KINDS.has(kind) ? "outcome_unknown" : "unavailable";
    return failure(kind, code, reason);
  }
}

function projectValue(kind: ResultKind, value: HostValue): unknown {
  if (value.tag !== kind && !(kind === "object-remove" && value.tag === "counter-remove") && !(kind === "counter-remove" && value.tag === "object-remove")) {
    throw new Error("variant");
  }
  switch (value.tag) {
    case "object-read": {
      const read = foundObject(value.found);
      if (!read) throw new Error("variant");
      return read;
    }
    case "object-batch":
      return value.items.map((item) => {
        if (item.tag === "error") {
          const error: { code: string; requestId: string; reason?: string } = {
            code: publicCode(item.code),
            requestId: item.requestId,
          };
          const reason = publicReason(item.reason);
          if (reason) error.reason = reason;
          return { key: item.key, error };
        }
        const read = foundObject(item.found);
        if (!read) throw new Error("variant");
        return { key: item.key, result: read };
      });
    case "object-write":
      return { revision: value.revision, changed: value.changed, replayed: value.replayed };
    case "counter-write": {
      const parsed = value.value === undefined ? undefined : parseCanonicalInteger(value.value, I64_MIN, I64_MAX);
      if (parsed === undefined) throw new Error("variant");
      return { revision: value.revision, changed: value.changed, replayed: value.replayed, value: parsed };
    }
    case "object-remove":
    case "counter-remove":
      return { revision: value.revision, changed: value.changed, replayed: value.replayed, removed: value.removed };
    case "object-list-keys":
      return { keys: value.keys, nextCursor: value.nextCursor };
    case "sorted-write":
      return { changed: value.changed, replayed: value.replayed };
    case "sorted-score":
      if (!value.found) return { found: false };
      {
        const score = parseCanonicalInteger(value.score, -9007199254740991n, 9007199254740991n);
        if (score === undefined) throw new Error("range");
        return { found: true, score: Number(score) };
      }
    case "sorted-remove":
      return { removed: value.removed, replayed: value.replayed };
    case "sorted-page":
      return {
        items: value.items.map((item) => {
          const score = parseCanonicalInteger(item.score, -9007199254740991n, 9007199254740991n);
          if (score === undefined) throw new Error("range");
          return { memberId: item.memberId, score: Number(score) };
        }),
        nextCursor: value.nextCursor,
      };
    case "sorted-rank":
      if (!value.found) return { found: false };
      {
        const rank = safeNonNegative(value.rank);
        if (rank === undefined || rank < 1) throw new Error("range");
        return { found: true, rank };
      }
    case "sorted-count": {
      const count = safeNonNegative(value.count);
      if (count === undefined) throw new Error("range");
      return { count };
    }
    case "queue-enqueue": {
      const expiresAt = safeNonNegative(value.expiresAt);
      if (expiresAt === undefined) throw new Error("range");
      return { messageId: value.messageId, expiresAt, replayed: value.replayed };
    }
    case "queue-receive":
      return {
        replayed: value.replayed,
        messages: value.messages.map((message) => {
          const payload = decodeJsonBytes(message.payloadJson);
          if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("variant");
          const visibleUntil = safeNonNegative(message.visibleUntil);
          const expiresAt = safeNonNegative(message.expiresAt);
          if (visibleUntil === undefined || expiresAt === undefined) throw new Error("range");
          return {
            messageId: message.messageId,
            payload: payload as JSONObject,
            receipt: message.receipt,
            visibleUntil,
            expiresAt,
          };
        }),
      };
    case "queue-ack":
      return { acknowledged: true as const, replayed: value.replayed };
    case "counter-read": {
      if (!value.found) return { found: false, stateToken: value.stateToken };
      const parsed = parseCanonicalInteger(value.value, I64_MIN, I64_MAX);
      if (parsed === undefined) throw new Error("variant");
      return { found: true, value: parsed, revision: value.revision, stateToken: value.stateToken };
    }
    case "capabilities": {
      const limits = {} as GameDataLimits;
      for (const [field] of LIMIT_FIELDS) {
        const raw = value.limits[field];
        const number = raw === undefined ? undefined : safeNonNegative(raw);
        if (number === undefined) throw new Error("range");
        limits[field] = number;
      }
      return {
        apiMajor: value.apiMajor,
        capabilityIds: GAME_DATA_MESSAGE_QUEUE_ENABLED
          ? [...value.capabilityIds]
          : value.capabilityIds.filter((capability) => capability !== "queue_v1"),
        limits,
      };
    }
    default:
      throw new Error("variant");
  }
}

function errorFromHost<T>(kind: ResultKind, error: HostFailure): Result<T> {
  const mapped: GameDataError<T> = { code: publicCode(error.code), requestId: error.requestId };
  const reason = publicReason(error.reason);
  if (reason) mapped.reason = reason;
  if (error.mutationId) mapped.mutationId = error.mutationId;
  if (error.retryAfterMs !== undefined) mapped.retryAfterMs = error.retryAfterMs;
  mapped.message = gameDataErrorMessage(mapped.code, mapped.reason);
  if (error.recoveryError) {
    mapped.recoveryError = { code: publicCode(error.recoveryError.code) };
    const recoveryReason = publicReason(error.recoveryError.reason);
    if (recoveryReason) mapped.recoveryError.reason = recoveryReason;
  }
  if (error.recoveryId !== undefined && error.resultKind === kind) {
    mapped.recoveryHandle = new RecoveryHandle<T>(recoveryMint, error.recoveryId, kind);
  }
  return { ok: false, error: mapped };
}

/** Per-Room Game Data driver. The adapter calls drive before the user tick. */
export class GameData {
  private readonly slots = new Map<bigint, Stored<unknown>>();
  private readonly pending: bigint[] = [];
  private readonly recoveries = new Set<bigint>();
  private readonly asyncIds: bigint[] = [];
  private readonly transformPending: bigint[] = [];
  private retainedCursor = 0;
  private transforming = false;

  objects(ns: string): Objects {
    return new Objects(this, ns);
  }

  sortedIndex(ns: string): SortedIndex {
    return new SortedIndex(this, ns);
  }

  queue(ns: string): GameQueue {
    return new GameQueue(this, ns);
  }

  counters(ns: string): Counters {
    return new Counters(this, ns);
  }

  capabilities(options?: CallOptions): Operation<Capabilities> {
    return this.start("capabilities", { tag: "capabilities" }, options);
  }

  capabilitiesAsync(options?: CallOptions): Promise<Capabilities> {
    return this.startAsync("capabilities", { tag: "capabilities" }, options);
  }

  /** Gate for `*Async` helpers: fail before Host start when async-runtime is unavailable. */
  blockAsyncStart<T>(kind: ResultKind): Operation<T> | undefined {
    if (admitAsyncRuntime()) return undefined;
    return localError(kind, "unsupported-capability");
  }

  resume<T>(handle: RecoveryHandle<T>, options?: CallOptions): Operation<T> {
    const kind = handle.kind();
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED && isMessageQueueKind(kind)) {
      return localError(kind, "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { recoveryHandle: handle });
    }
    if (!this.recoveries.has(handle.hostId())) return unknownResume(kind, "recovery-expired");
    if (this.transforming) return unknownResume(kind, "busy", "callback_reentrancy", handle);
    const timeout = resolveTimeout(options);
    if (timeout === undefined) return unknownResume(kind, "invalid-argument", "invalid_deadline", handle);
    const host = currentRoomHost();
    if (!host?.gameDataResume) return unknownResume(kind, "unsupported-capability", undefined, handle);
    let started: { ok: true; id: bigint } | { ok: false; error: string };
    try {
      started = host.gameDataResume({ id: handle.hostId() }, timeout);
    } catch {
      return unknownResume(kind, "unavailable", "host_threw", handle);
    }
    if (!started.ok) {
      if (started.error === "recovery-expired") {
        this.recoveries.delete(handle.hostId());
        return unknownResume(kind, "recovery-expired");
      }
      const reason = started.error === "invalid-deadline"
        ? "invalid_deadline"
        : started.error === "too-many-handles"
          ? "too_many_handles"
          : started.error === "not-ready"
            ? "not_ready"
            : started.error === "callback-reentrancy"
              ? "callback_reentrancy"
              : undefined;
      return unknownResume(kind, started.error, reason, handle);
    }
    return this.track(started.id, kind, handle.hostId());
  }

  resumeAsync<T>(handle: RecoveryHandle<T>, options?: CallOptions): Promise<T> {
    const kind = handle.kind();
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED && isMessageQueueKind(kind)) {
      return asyncReject(kind, "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { recoveryHandle: handle });
    }
    if (this.blockAsyncStart(kind)) {
      return asyncUnknownResume(kind, "unsupported-capability", undefined, handle);
    }
    if (!this.recoveries.has(handle.hostId())) return asyncUnknownResume(kind, "recovery-expired");
    if (this.transforming) return asyncUnknownResume(kind, "busy", "callback_reentrancy", handle);
    const timeout = resolveTimeout(options);
    if (timeout === undefined) return asyncUnknownResume(kind, "invalid-argument", "invalid_deadline", handle);
    const host = currentRoomHost();
    if (!host?.gameDataResume) return asyncUnknownResume(kind, "unsupported-capability", undefined, handle);
    let started: { ok: true; id: bigint } | { ok: false; error: string };
    try {
      started = host.gameDataResume({ id: handle.hostId() }, timeout);
    } catch {
      return asyncUnknownResume(kind, "unavailable", "host_threw", handle);
    }
    if (!started.ok) {
      if (started.error === "recovery-expired") {
        this.recoveries.delete(handle.hostId());
        return asyncUnknownResume(kind, "recovery-expired");
      }
      const reason = started.error === "invalid-deadline"
        ? "invalid_deadline"
        : started.error === "too-many-handles"
          ? "too_many_handles"
          : started.error === "not-ready"
            ? "not_ready"
            : started.error === "callback-reentrancy"
              ? "callback_reentrancy"
              : undefined;
      return asyncUnknownResume(kind, started.error.replaceAll("-", "_"), reason, handle);
    }
    const slot = this.beginAsyncSlot<T>(started.id, kind, handle.hostId());
    return this.attachAsyncWaiter(slot);
  }

  releaseRecovery<T>(handle: RecoveryHandle<T>): void {
    this.recoveries.delete(handle.hostId());
    try {
      currentRoomHost()?.gameDataReleaseRecovery?.({ id: handle.hostId() });
    } catch {
      // Release is local and idempotent.
    }
  }

  /** Observe at most 16 typed polls and 4 update callbacks with fair legacy/async/rescan rotation. */
  drive(): void {
    const ingested = ingestAsyncRuntimeCompletions(
      this.pending.length > 0
        || this.asyncIds.length > 0
        || this.transformPending.length > 0,
    );
    if (!ingested.ok && ingested.reason === "host-poll-failed") {
      this.failOpenAsyncInterestHostPoll();
    }
    const legacyBatch: bigint[] = [];
    while (legacyBatch.length < 16 && this.pending.length > 0) {
      const id = this.pending.shift();
      if (id !== undefined) legacyBatch.push(id);
    }
    let legacyIndex = 0;
    let transformIndex = 0;
    let polls = 0;
    let callbacks = 4;
    let idleRounds = 0;
    while (polls < 16) {
      const phase = nextFairPhase();
      let progressed = false;
      if (phase === 0) {
        const transformId = this.transformPending[transformIndex];
        const legacyId = legacyBatch[legacyIndex];
        const id = transformId ?? legacyId;
        if (transformId !== undefined) transformIndex += 1;
        else if (legacyId !== undefined) legacyIndex += 1;
        if (id !== undefined && this.slots.has(id)) {
          callbacks = this.step(id, callbacks);
          progressed = true;
        }
      } else if (phase === 1) {
        const event = takeReadyCompletion();
        if (event?.source === ASYNC_SOURCE_GAME_DATA && this.slots.has(event.operationId)) {
          this.markAsyncInterest(event.operationId);
          callbacks = this.step(event.operationId, callbacks);
          progressed = true;
        }
      } else if (phase === 2) {
        const id = nextRescanOperationId(this.asyncIds);
        if (id !== undefined && this.slots.has(id)) {
          callbacks = this.step(id, callbacks);
          progressed = true;
        }
      } else {
        const id = this.nextRetainedId();
        if (id !== undefined && this.observeRetainedId(id)) progressed = true;
      }
      if (progressed) {
        polls += 1;
        idleRounds = 0;
      } else {
        idleRounds += 1;
        if (idleRounds >= 4) break;
      }
    }
    if (legacyIndex < legacyBatch.length) {
      this.pending.unshift(...legacyBatch.slice(legacyIndex));
    }
  }

  /** @internal: share the existing slots and result ownership with the event driver. */
  takeAsyncDriverReadyIds(): bigint[] {
    return [...takeAsyncDriverNotifications().map((event) => event.operationId), ...this.transformPending.splice(0)];
  }

  asyncDriverIds(): bigint[] { return [...this.slots].filter(([, slot]) => slot.driverEpoch === currentAsyncSettlementEpoch()).map(([id]) => id); }

  /** @internal: one typed poll, with the caller's remaining transform budget. */
  driveAsyncOperation(id: bigint, callbacks: number): number {
    const slot = this.slots.get(id);
    if (!slot || slot.driverEpoch !== currentAsyncSettlementEpoch()) return callbacks;
    if (slot.phase === "done") {
      if (!slot.released && !slot.pendingAsyncSettlement) {
        this.observeRetainedId(id);
      }
      return callbacks;
    }
    const ownedRecovery = slot.recoveryOf !== undefined && this.recoveries.has(slot.recoveryOf);
    const remaining = this.step(id, callbacks);
    if (slot.phase === "expired" && slot.asyncWaiter) this.settleAsyncDriverExpiry(slot, ownedRecovery);
    // Legacy step requeues pending async work for tick fallback. The event driver
    // waits for a new notification after polling/proposing, never self-polls it.
    this.removeTransformIndex(id);
    return remaining;
  }

  /** Expiry observed by the independent path must settle, not orphan, its waiter. */
  private settleAsyncDriverExpiry(slot: Stored<unknown>, ownedRecovery: boolean): void {
    const waiter = slot.asyncWaiter;
    if (!waiter || slot.id === null) return;
    slot.asyncWaiter = undefined;
    slot.pendingAsyncSettlement = true;
    const id = slot.id;
    this.removePendingIndex(id);
    this.removeTransformIndex(id);
    this.removeAsyncInterest(id);
    const writing = WRITE_KINDS.has(slot.kind);
    const error: GameDataAsyncError<unknown> = { code: writing ? "outcome_unknown" : "operation_expired", requestId: "" };
    error.message = gameDataErrorMessage(error.code);
    if (writing) {
      error.recoveryError = { code: "operation_expired" };
      if (ownedRecovery && slot.recoveryOf !== undefined) {
        this.recoveries.add(slot.recoveryOf);
        error.recoveryHandle = new RecoveryHandle(recoveryMint, slot.recoveryOf, slot.kind);
      }
    }
    scheduleDeferredSettlement(
      () => slot.phase === "expired" && !slot.released,
      () => {
        slot.pendingAsyncSettlement = false;
        waiter.reject(error);
        this.releaseAsyncHostSlot(id);
      },
      waiter.ticket,
    );
  }

  /** @internal */
  failAsyncDriver(): void { this.failOpenAsyncInterestHostPoll(); }

  /**
   * Host retains a terminal result until release or its own window. The design
   * initial value is 60 seconds; this driver does not time that window. Author
   * poll reads the last observation, so a completed slot is polled again here.
   * Only Host expired drops it. A later poll error keeps the observed result.
   * Dropping the result does not drop a recovery handle the author already holds.
   */
  private nextRetainedId(): bigint | undefined {
    const ids = [...this.slots.values()]
      .filter((slot) => slot.phase === "done" && !slot.released && slot.id !== null && !slot.pendingAsyncSettlement)
      .map((slot) => slot.id as bigint)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (ids.length === 0) {
      this.retainedCursor = 0;
      return undefined;
    }
    const index = this.retainedCursor % ids.length;
    this.retainedCursor += 1;
    return ids[index];
  }

  /** One retained Host poll; counts toward the shared per-tick typed poll budget. */
  private observeRetainedId(id: bigint): boolean {
    const slot = this.slots.get(id);
    if (!slot || slot.phase !== "done" || slot.released || slot.id === null) return false;
    let polled: HostPoll | undefined;
    try {
      polled = currentRoomHost()?.gameDataPoll?.({ id: slot.id });
    } catch {
      return true;
    }
    if (polled?.tag !== "expired") return true;
    slot.phase = "expired";
    slot.result = undefined;
    slot.update = undefined;
    this.removeAsyncInterest(slot.id);
    this.slots.delete(slot.id);
    return true;
  }

  /** Drop local handles when the Room generation changes or the Room is disposed. */
  discard(): void {
    invalidateAsyncSettlements();
    this.transforming = false;
    const slots = [...this.slots.values()];
    const recoveries = [...this.recoveries];
    for (const slot of slots) {
      slot.released = true;
      slot.phase = "expired";
      slot.result = undefined;
      slot.update = undefined;
    }
    this.slots.clear();
    this.pending.length = 0;
    this.asyncIds.length = 0;
    this.transformPending.length = 0;
    this.recoveries.clear();
    for (const slot of slots) {
      if (slot.id === null) continue;
      try {
        currentRoomHost()?.gameDataRelease?.({ id: slot.id });
      } catch {
        // The generation is already gone.
      }
    }
    for (const id of recoveries) {
      try {
        currentRoomHost()?.gameDataReleaseRecovery?.({ id });
      } catch {
        // The generation is already gone.
      }
    }
  }

  /** @internal */
  releaseSlot(slot: Stored<unknown>): void {
    if (slot.id === null) return;
    this.removePendingIndex(slot.id);
    this.removeTransformIndex(slot.id);
    this.removeAsyncInterest(slot.id);
    this.slots.delete(slot.id);
    try {
      currentRoomHost()?.gameDataRelease?.({ id: slot.id });
    } catch {
      // Release stays idempotent.
    }
  }

  /** @internal */
  start<T>(kind: ResultKind, request: HostOperation, options?: CallOptions, update?: Stored<T>["update"], waitTimeoutMs = 0): Operation<T> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED && (isMessageQueueKind(kind) || isMessageQueueRequest(request))) {
      return localError(kind, "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, {
        mutationId: queueErrorMutationId(options, request),
      });
    }
    if (this.transforming) return localError(kind, "busy", "callback_reentrancy");
    const timeout = resolveTimeout(options, waitTimeoutMs);
    if (timeout === undefined) return localError(kind, "invalid_argument", "invalid_deadline");
    const host = currentRoomHost();
    if (!host?.gameDataStart || !host.gameDataPoll) return localError(kind, "unsupported-capability");
    let started: { ok: true; id: bigint } | { ok: false; error: string };
    try {
      started = host.gameDataStart(request, timeout);
    } catch {
      return localError(kind, "unavailable", "host_threw");
    }
    if (!started.ok) {
      const reason = started.error === "invalid-deadline"
        ? "invalid_deadline"
        : started.error === "too-many-handles"
          ? "too_many_handles"
          : started.error === "not-ready"
            ? "not_ready"
            : started.error === "callback-reentrancy"
              ? "callback_reentrancy"
              : undefined;
      return localError(kind, started.error, reason);
    }
    const operation = this.track<T>(started.id, kind);
    if (update) {
      const slot = this.slots.get(started.id) as Stored<T> | undefined;
      if (slot) slot.update = update;
    }
    return operation;
  }

  /** @internal Start a Host operation and return a Promise settled on a microtask after drive observes the result. */
  startAsync<T>(
    kind: ResultKind,
    request: HostOperation,
    options?: CallOptions,
    update?: Stored<T>["update"],
    waitTimeoutMs = 0,
  ): Promise<T> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED && (isMessageQueueKind(kind) || isMessageQueueRequest(request))) {
      return asyncReject(kind, "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, {
        mutationId: queueErrorMutationId(options, request),
      });
    }
    const blocked = this.blockAsyncStart<T>(kind);
    if (blocked) return asyncFromBlocked(blocked);
    if (this.transforming) return asyncReject(kind, "busy", "callback_reentrancy");
    const timeout = resolveTimeout(options, waitTimeoutMs);
    if (timeout === undefined) return asyncReject(kind, "invalid_argument", "invalid_deadline");
    const host = currentRoomHost();
    if (!host?.gameDataStart || !host.gameDataPoll) return asyncReject(kind, "unsupported-capability");
    let started: { ok: true; id: bigint } | { ok: false; error: string };
    try {
      started = host.gameDataStart(request, timeout);
    } catch {
      return asyncReject(kind, "unavailable", "host_threw");
    }
    if (!started.ok) {
      const reason = started.error === "invalid-deadline"
        ? "invalid_deadline"
        : started.error === "too-many-handles"
          ? "too_many_handles"
          : started.error === "not-ready"
            ? "not_ready"
            : started.error === "callback-reentrancy"
              ? "callback_reentrancy"
              : undefined;
      return asyncReject(kind, started.error.replaceAll("-", "_"), reason);
    }
    const slot = this.beginAsyncSlot<T>(started.id, kind, undefined, update);
    return this.attachAsyncWaiter(slot);
  }

  private beginAsyncSlot<T>(
    id: bigint,
    kind: ResultKind,
    recoveryOf?: bigint,
    update?: Stored<T>["update"],
  ): Stored<T> {
    const slot: Stored<T> = { id, kind, phase: "pending", released: false, recoveryOf, driverEpoch: currentAsyncSettlementEpoch() };
    this.slots.set(id, slot as Stored<unknown>);
    if (update) slot.update = update;
    this.markAsyncInterest(id);
    return slot;
  }

  /** Release a typed Host handle for async-only operations (does not release recovery material). */
  private releaseAsyncHostSlot(id: bigint): void {
    const slot = this.slots.get(id);
    if (!slot || slot.released || slot.id === null) return;
    slot.released = true;
    slot.phase = "expired";
    slot.result = undefined;
    slot.update = undefined;
    slot.asyncWaiter = undefined;
    this.removePendingIndex(id);
    this.removeTransformIndex(id);
    this.removeAsyncInterest(id);
    this.slots.delete(id);
    try {
      currentRoomHost()?.gameDataRelease?.({ id });
    } catch {
      // Release stays idempotent.
    }
  }

  private attachAsyncWaiter<T>(slot: Stored<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: GameDataAsyncError<T>) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    slot.asyncWaiter = {
      ticket: captureAsyncSettlementTicket(),
      promise,
      resolve,
      reject,
    };
    return promise;
  }

  private track<T>(id: bigint, kind: ResultKind, recoveryOf?: bigint): Operation<T> {
    const slot: Stored<T> = { id, kind, phase: "pending", released: false, recoveryOf, driverEpoch: currentAsyncSettlementEpoch() };
    this.slots.set(id, slot as Stored<unknown>);
    this.pending.push(id);
    return new Operation(slot, this);
  }

  private markAsyncInterest(id: bigint): void {
    if (!this.asyncIds.includes(id)) this.asyncIds.push(id);
  }

  private removeAsyncInterest(id: bigint): void {
    const asyncIndex = this.asyncIds.indexOf(id);
    if (asyncIndex >= 0) this.asyncIds.splice(asyncIndex, 1);
  }

  private removePendingIndex(id: bigint): void {
    const index = this.pending.indexOf(id);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private removeTransformIndex(id: bigint): void {
    const index = this.transformPending.indexOf(id);
    if (index >= 0) this.transformPending.splice(index, 1);
  }

  private static readonly MAX_DEFERRED_TRANSFORMS = 64;

  private enqueueTransform(id: bigint): void {
    if (this.transformPending.includes(id)) return;
    if (this.transformPending.length >= GameData.MAX_DEFERRED_TRANSFORMS) {
      requestAsyncRescan();
      return;
    }
    this.transformPending.push(id);
  }

  private requeuePending(id: bigint, slot: Stored<unknown>): void {
    if (slot.asyncWaiter) {
      if (slot.update) this.enqueueTransform(id);
      return;
    }
    if (!this.pending.includes(id)) this.pending.push(id);
  }

  /** @internal */
  failOpenAsyncInterestHostPoll(): void {
    for (const id of [...this.asyncIds]) {
      const slot = this.slots.get(id);
      if (!slot || slot.phase !== "pending") continue;
      const code = WRITE_KINDS.has(slot.kind) ? "outcome-unknown" : "unavailable";
      this.finish(slot, failure(slot.kind, code, "host_threw"));
    }
  }

  private step(id: bigint, callbacks: number): number {
    const slot = this.slots.get(id);
    if (!slot || slot.released || slot.phase !== "pending") return callbacks;
    const host = currentRoomHost();
    let polled: HostPoll;
    try {
      polled = host?.gameDataPoll?.({ id }) ?? { tag: "failed", error: { code: "unsupported-capability", requestId: "", resultKind: slot.kind } };
    } catch {
      const code = WRITE_KINDS.has(slot.kind) ? "outcome-unknown" : "unavailable";
      polled = { tag: "failed", error: { code, requestId: "", reason: "host_threw", resultKind: slot.kind } };
    }
    if (polled.tag === "pending") {
      this.requeuePending(id, slot);
      return callbacks;
    }
    if (polled.tag === "needs-transform") {
      if (slot.kind !== "object-write" || !slot.update) {
        this.finish(slot, failure(slot.kind, WRITE_KINDS.has(slot.kind) ? "outcome_unknown" : "unavailable", "invalid_response"));
        return callbacks;
      }
      if (slot.proposedGeneration === polled.readGeneration) {
        this.requeuePending(id, slot);
        return callbacks;
      }
      if (callbacks <= 0) {
        this.requeuePending(id, slot);
        return callbacks;
      }
      slot.proposedGeneration = polled.readGeneration;
      const proposal = this.proposeFromCallback(slot, polled.read);
      this.sendProposal(id, polled.readGeneration, proposal);
      if (slot.phase === "pending") this.requeuePending(id, slot);
      return callbacks - 1;
    }
    if (polled.tag === "expired") {
      this.closeRecovery(slot, undefined);
      slot.phase = "expired";
      this.slots.delete(id);
      return callbacks;
    }
    if (polled.tag === "failed") {
      if (polled.error.recoveryId !== undefined) this.recoveries.add(polled.error.recoveryId);
      this.finish(slot, errorFromHost(slot.kind, polled.error));
      return callbacks;
    }
    this.finish(slot, decodeValue(slot.kind, polled.value));
    return callbacks;
  }

  private proposeFromCallback(slot: Stored<unknown>, read: HostFound): HostProposal {
    const current = foundObject(read);
    if (!current || !slot.update) return { tag: "callback-abort" };
    let returned: unknown;
    this.transforming = true;
    try {
      returned = slot.update(current);
    } catch {
      this.transforming = false;
      this.finish(slot, failure(slot.kind, "callback_failed"));
      return { tag: "callback-abort" };
    }
    this.transforming = false;
    if (isThenable(returned)) {
      this.finish(slot, failure(slot.kind, "invalid_argument", "callback_returned_promise"));
      return { tag: "callback-abort" };
    }
    if (returned === undefined || returned === null || typeof returned !== "object" || Array.isArray(returned)) {
      this.finish(slot, failure(slot.kind, "invalid_argument", "invalid_callback_result"));
      return { tag: "callback-abort" };
    }
    try {
      return { tag: "object", valueJson: canonicalJsonObject(returned) };
    } catch {
      this.finish(slot, failure(slot.kind, "invalid_argument", "invalid_callback_result"));
      return { tag: "callback-abort" };
    }
  }

  private sendProposal(id: bigint, generation: bigint, proposal: HostProposal): void {
    try {
      const result = currentRoomHost()?.gameDataUpdatePropose?.({ id }, generation, proposal);
      if (result && !result.ok && proposal.tag === "object") {
        const slot = this.slots.get(id);
        if (slot && slot.phase === "pending") {
          this.finish(slot, failure(slot.kind, "unavailable", result.error.replaceAll("-", "_")));
        }
      }
    } catch {
      const slot = this.slots.get(id);
      if (slot && slot.phase === "pending" && proposal.tag === "object") {
        this.finish(slot, failure(slot.kind, "unavailable", "host_threw"));
      }
    }
  }

  private closeRecovery<T>(slot: Stored<T>, result: Result<T> | undefined): void {
    if (slot.recoveryOf === undefined) return;
    const stillOpen = result?.ok === false && result.error.recoveryHandle?.hostId() === slot.recoveryOf;
    if (!stillOpen) this.recoveries.delete(slot.recoveryOf);
  }

  private finish<T>(slot: Stored<T>, result: Result<T>): void {
    if (slot.released || slot.phase !== "pending") return;
    slot.phase = "done";
    slot.result = result;
    slot.update = undefined;
    this.closeRecovery(slot, result);
    if (slot.id !== null) {
      this.removePendingIndex(slot.id);
      this.removeTransformIndex(slot.id);
      this.removeAsyncInterest(slot.id);
    }
    const waiter = slot.asyncWaiter;
    if (!waiter) return;
    slot.asyncWaiter = undefined;
    slot.pendingAsyncSettlement = true;
    const hostId = slot.id;
    scheduleDeferredSettlement(
      () => slot.phase === "done" && !slot.released && slot.asyncWaiter === undefined,
      () => {
        slot.pendingAsyncSettlement = false;
        if (result.ok) waiter.resolve(result.value);
        else waiter.reject(result.error);
        if (hostId !== null) this.releaseAsyncHostSlot(hostId);
      },
      waiter.ticket,
    );
  }
}

function asyncReject<T>(
  kind: ResultKind,
  code: string,
  reason?: string,
  details?: { mutationId?: string; recoveryHandle?: RecoveryHandle<T> },
): Promise<T> {
  const result = failure<T>(kind, code, reason);
  if (!result.ok) {
    if (details?.mutationId !== undefined) result.error.mutationId = details.mutationId;
    if (details?.recoveryHandle !== undefined) result.error.recoveryHandle = details.recoveryHandle;
    return Promise.reject(result.error);
  }
  return Promise.reject({ code: "internal", requestId: "" } satisfies GameDataAsyncError<T>);
}

function asyncFromBlocked<T>(operation: Operation<T>): Promise<T> {
  const poll = operation.poll();
  if (poll.state === "done" && poll.result && !poll.result.ok) {
    return Promise.reject(poll.result.error);
  }
  return asyncReject("capabilities", "unsupported-capability");
}

function asyncUnknownResume<T>(
  kind: ResultKind,
  recoveryCode: string,
  reason?: string,
  handle?: RecoveryHandle<T>,
): Promise<T> {
  const poll = unknownResume(kind, recoveryCode, reason, handle).poll();
  if (poll.state === "done" && poll.result && !poll.result.ok) {
    return Promise.reject(poll.result.error);
  }
  return asyncReject(kind, "outcome_unknown");
}

function encodeObject(value: JSONObject): Uint8Array | undefined {
  try {
    return canonicalJsonObject(value);
  } catch {
    return undefined;
  }
}

export class Objects {
  /** @internal */
  constructor(private readonly gameData: GameData, private readonly ns: string) {}

  ref(key: string): ObjectRef {
    return { kind: "object", ns: this.ns, key };
  }

  get(key: string, options?: ReadOptions): Operation<ReadResult<JSONObject>> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("object-read", "invalid_argument", invalid);
    return this.gameData.start("object-read", { tag: "objects-get", ns: this.ns, key, fresh: options?.fresh === true }, options);
  }

  getAsync(key: string, options?: ReadOptions): Promise<ReadResult<JSONObject>> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("object-read", "invalid_argument", invalid);
    return this.gameData.startAsync("object-read", { tag: "objects-get", ns: this.ns, key, fresh: options?.fresh === true }, options);
  }

  getManyAsync(
    keys: string[],
    options?: ReadOptions,
  ): Promise<Array<{ key: string; result: ReadResult<JSONObject> } | { key: string; error: { code: string; requestId: string; reason?: string } }>> {
    if (requireName(this.ns, "ns") || !Array.isArray(keys) || keys.some((key) => requireName(key, "key"))) {
      return asyncReject("object-batch", "invalid_argument", "key");
    }
    return this.gameData.startAsync("object-batch", { tag: "objects-get-many", ns: this.ns, keys: [...keys], fresh: options?.fresh === true }, options);
  }

  getMany(keys: string[], options?: ReadOptions): Operation<Array<{ key: string; result: ReadResult<JSONObject> } | { key: string; error: { code: string; requestId: string; reason?: string } }>> {
    if (requireName(this.ns, "ns") || !Array.isArray(keys) || keys.some((key) => requireName(key, "key"))) {
      return localError("object-batch", "invalid_argument", "key");
    }
    return this.gameData.start("object-batch", { tag: "objects-get-many", ns: this.ns, keys: [...keys], fresh: options?.fresh === true }, options);
  }

  create(key: string, value: JSONObject, options?: WriteOptions): Operation<WriteResult> {
    return this.write("objects-create", "object-write", key, value, options);
  }

  createAsync(key: string, value: JSONObject, options?: WriteOptions): Promise<WriteResult> {
    return this.writeAsync("objects-create", "object-write", key, value, options);
  }

  set(key: string, value: JSONObject, options?: WriteOptions): Operation<WriteResult> {
    return this.write("objects-set", "object-write", key, value, options);
  }

  setAsync(key: string, value: JSONObject, options?: WriteOptions): Promise<WriteResult> {
    return this.writeAsync("objects-set", "object-write", key, value, options);
  }

  compareExchange(key: string, stateToken: string, value: JSONObject, options?: WriteOptions): Operation<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key") ?? requireName(stateToken, "state_token");
    if (invalid) return localError("object-write", "invalid_argument", invalid);
    const encoded = encodeObject(value);
    if (!encoded) return localError("object-write", "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("object-write", "invalid_argument", "mutation_id");
    return this.gameData.start("object-write", {
      tag: "objects-compare-exchange",
      ns: this.ns,
      key,
      stateToken,
      valueJson: encoded,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  compareExchangeAsync(key: string, stateToken: string, value: JSONObject, options?: WriteOptions): Promise<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key") ?? requireName(stateToken, "state_token");
    if (invalid) return asyncReject("object-write", "invalid_argument", invalid);
    const encoded = encodeObject(value);
    if (!encoded) return asyncReject("object-write", "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("object-write", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("object-write", {
      tag: "objects-compare-exchange",
      ns: this.ns,
      key,
      stateToken,
      valueJson: encoded,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  update(key: string, fn: (current: ReadResult<JSONObject>) => JSONObject, options?: CallOptions & { maxAttempts?: number }): Operation<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("object-write", "invalid_argument", invalid);
    if (typeof fn !== "function") return localError("object-write", "invalid_argument", "callback");
    const maxAttempts = options?.maxAttempts ?? 8;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
      return localError("object-write", "invalid_argument", "max_attempts");
    }
    return this.gameData.start("object-write", { tag: "objects-update", ns: this.ns, key, maxAttempts }, options, fn);
  }

  updateAsync(
    key: string,
    fn: (current: ReadResult<JSONObject>) => JSONObject,
    options?: CallOptions & { maxAttempts?: number },
  ): Promise<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("object-write", "invalid_argument", invalid);
    if (typeof fn !== "function") return asyncReject("object-write", "invalid_argument", "callback");
    const maxAttempts = options?.maxAttempts ?? 8;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
      return asyncReject("object-write", "invalid_argument", "max_attempts");
    }
    return this.gameData.startAsync("object-write", { tag: "objects-update", ns: this.ns, key, maxAttempts }, options, fn);
  }

  remove(key: string, options?: RemoveOptions): Operation<RemoveResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("object-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("object-remove", "invalid_argument", "mutation_id");
    return this.gameData.start("object-remove", {
      tag: "objects-remove",
      ns: this.ns,
      key,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
    }, options);
  }

  removeAsync(key: string, options?: RemoveOptions): Promise<RemoveResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("object-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("object-remove", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("object-remove", {
      tag: "objects-remove",
      ns: this.ns,
      key,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
    }, options);
  }

  listKeys(options?: CallOptions & { prefix?: string; limit?: number; cursor?: string }): Operation<{ keys: string[]; nextCursor: string | null }> {
    if (requireName(this.ns, "ns")) return localError("object-list-keys", "invalid_argument", "ns");
    return this.gameData.start("object-list-keys", {
      tag: "objects-list-keys",
      ns: this.ns,
      ...(options?.prefix !== undefined ? { prefix: options.prefix } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
    }, options);
  }

  listKeysAsync(
    options?: CallOptions & { prefix?: string; limit?: number; cursor?: string },
  ): Promise<{ keys: string[]; nextCursor: string | null }> {
    if (requireName(this.ns, "ns")) return asyncReject("object-list-keys", "invalid_argument", "ns");
    return this.gameData.startAsync("object-list-keys", {
      tag: "objects-list-keys",
      ns: this.ns,
      ...(options?.prefix !== undefined ? { prefix: options.prefix } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
    }, options);
  }

  private write(tag: "objects-create" | "objects-set", kind: ResultKind, key: string, value: JSONObject, options?: WriteOptions): Operation<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError(kind, "invalid_argument", invalid);
    const encoded = encodeObject(value);
    if (!encoded) return localError(kind, "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError(kind, "invalid_argument", "mutation_id");
    return this.gameData.start(kind, { tag, ns: this.ns, key, valueJson: encoded, ...(mutationId ? { mutationId } : {}) }, options);
  }

  private writeAsync(
    tag: "objects-create" | "objects-set",
    kind: ResultKind,
    key: string,
    value: JSONObject,
    options?: WriteOptions,
  ): Promise<WriteResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject(kind, "invalid_argument", invalid);
    const encoded = encodeObject(value);
    if (!encoded) return asyncReject(kind, "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject(kind, "invalid_argument", "mutation_id");
    return this.gameData.startAsync(kind, { tag, ns: this.ns, key, valueJson: encoded, ...(mutationId ? { mutationId } : {}) }, options);
  }
}

export class SortedIndex {
  /** @internal */
  constructor(private readonly gameData: GameData, private readonly ns: string) {}

  setScore(memberId: string, score: number, options?: WriteOptions): Operation<{ changed: boolean; replayed: boolean }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return localError("sorted-write", "invalid_argument", invalid);
    const canonical = canonicalScore(score);
    if (!canonical) return localError("sorted-write", "invalid_argument", "integer_overflow");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("sorted-write", "invalid_argument", "mutation_id");
    return this.gameData.start("sorted-write", {
      tag: "sorted-set-score",
      ns: this.ns,
      memberId,
      score: canonical,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  setScoreAsync(
    memberId: string,
    score: number,
    options?: WriteOptions,
  ): Promise<{ changed: boolean; replayed: boolean }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return asyncReject("sorted-write", "invalid_argument", invalid);
    const canonical = canonicalScore(score);
    if (!canonical) return asyncReject("sorted-write", "invalid_argument", "integer_overflow");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("sorted-write", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("sorted-write", {
      tag: "sorted-set-score",
      ns: this.ns,
      memberId,
      score: canonical,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  getScore(memberId: string, options?: CallOptions): Operation<{ found: true; score: number } | { found: false }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return localError("sorted-score", "invalid_argument", invalid);
    return this.gameData.start("sorted-score", { tag: "sorted-get-score", ns: this.ns, memberId }, options);
  }

  getScoreAsync(
    memberId: string,
    options?: CallOptions,
  ): Promise<{ found: true; score: number } | { found: false }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return asyncReject("sorted-score", "invalid_argument", invalid);
    return this.gameData.startAsync("sorted-score", { tag: "sorted-get-score", ns: this.ns, memberId }, options);
  }

  remove(memberId: string, options?: WriteOptions): Operation<{ removed: boolean; replayed: boolean }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return localError("sorted-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("sorted-remove", "invalid_argument", "mutation_id");
    return this.gameData.start("sorted-remove", {
      tag: "sorted-remove",
      ns: this.ns,
      memberId,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  removeAsync(memberId: string, options?: WriteOptions): Promise<{ removed: boolean; replayed: boolean }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return asyncReject("sorted-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("sorted-remove", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("sorted-remove", {
      tag: "sorted-remove",
      ns: this.ns,
      memberId,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  range(options?: CallOptions & { order?: "ascending" | "descending"; minScore?: number; maxScore?: number; limit?: number; cursor?: string }): Operation<Page<{ memberId: string; score: number }>> {
    if (requireName(this.ns, "ns")) return localError("sorted-page", "invalid_argument", "ns");
    const minScore = options?.minScore === undefined ? undefined : canonicalScore(options.minScore);
    const maxScore = options?.maxScore === undefined ? undefined : canonicalScore(options.maxScore);
    if ((options?.minScore !== undefined && !minScore) || (options?.maxScore !== undefined && !maxScore)) {
      return localError("sorted-page", "invalid_argument", "integer_overflow");
    }
    return this.gameData.start("sorted-page", {
      tag: "sorted-range",
      ns: this.ns,
      ...(options?.order ? { order: options.order } : {}),
      ...(minScore ? { minScore } : {}),
      ...(maxScore ? { maxScore } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    }, options);
  }

  rangeAsync(
    options?: CallOptions & { order?: "ascending" | "descending"; minScore?: number; maxScore?: number; limit?: number; cursor?: string },
  ): Promise<Page<{ memberId: string; score: number }>> {
    if (requireName(this.ns, "ns")) return asyncReject("sorted-page", "invalid_argument", "ns");
    const minScore = options?.minScore === undefined ? undefined : canonicalScore(options.minScore);
    const maxScore = options?.maxScore === undefined ? undefined : canonicalScore(options.maxScore);
    if ((options?.minScore !== undefined && !minScore) || (options?.maxScore !== undefined && !maxScore)) {
      return asyncReject("sorted-page", "invalid_argument", "integer_overflow");
    }
    return this.gameData.startAsync("sorted-page", {
      tag: "sorted-range",
      ns: this.ns,
      ...(options?.order ? { order: options.order } : {}),
      ...(minScore ? { minScore } : {}),
      ...(maxScore ? { maxScore } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    }, options);
  }

  rank(memberId: string, options?: CallOptions & { order?: "ascending" | "descending" }): Operation<{ found: true; rank: number } | { found: false }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return localError("sorted-rank", "invalid_argument", invalid);
    return this.gameData.start("sorted-rank", {
      tag: "sorted-rank",
      ns: this.ns,
      memberId,
      ...(options?.order ? { order: options.order } : {}),
    }, options);
  }

  rankAsync(
    memberId: string,
    options?: CallOptions & { order?: "ascending" | "descending" },
  ): Promise<{ found: true; rank: number } | { found: false }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(memberId, "member_id");
    if (invalid) return asyncReject("sorted-rank", "invalid_argument", invalid);
    return this.gameData.startAsync("sorted-rank", {
      tag: "sorted-rank",
      ns: this.ns,
      memberId,
      ...(options?.order ? { order: options.order } : {}),
    }, options);
  }

  count(options?: CallOptions): Operation<{ count: number }> {
    if (requireName(this.ns, "ns")) return localError("sorted-count", "invalid_argument", "ns");
    return this.gameData.start("sorted-count", { tag: "sorted-count", ns: this.ns }, options);
  }

  countAsync(options?: CallOptions): Promise<{ count: number }> {
    if (requireName(this.ns, "ns")) return asyncReject("sorted-count", "invalid_argument", "ns");
    return this.gameData.startAsync("sorted-count", { tag: "sorted-count", ns: this.ns }, options);
  }
}

export class GameQueue {
  /** @internal */
  constructor(private readonly gameData: GameData, private readonly ns: string) {}

  enqueue(payload: JSONObject, options?: WriteOptions & { messageTtlMs?: number }): Operation<{ messageId: string; expiresAt: number; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return localError("queue-enqueue", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    if (requireName(this.ns, "ns")) return localError("queue-enqueue", "invalid_argument", "ns");
    const encoded = encodeObject(payload);
    if (!encoded) return localError("queue-enqueue", "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("queue-enqueue", "invalid_argument", "mutation_id");
    if (options?.messageTtlMs !== undefined && (!Number.isInteger(options.messageTtlMs) || options.messageTtlMs < 1)) {
      return localError("queue-enqueue", "invalid_argument", "message_ttl");
    }
    return this.gameData.start("queue-enqueue", {
      tag: "queue-enqueue",
      ns: this.ns,
      payloadJson: encoded,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.messageTtlMs !== undefined ? { messageTtlMs: BigInt(options.messageTtlMs) } : {}),
    }, options);
  }

  enqueueAsync(
    payload: JSONObject,
    options?: WriteOptions & { messageTtlMs?: number },
  ): Promise<{ messageId: string; expiresAt: number; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return asyncReject("queue-enqueue", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    if (requireName(this.ns, "ns")) return asyncReject("queue-enqueue", "invalid_argument", "ns");
    const encoded = encodeObject(payload);
    if (!encoded) return asyncReject("queue-enqueue", "invalid_argument", "value");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("queue-enqueue", "invalid_argument", "mutation_id");
    if (options?.messageTtlMs !== undefined && (!Number.isInteger(options.messageTtlMs) || options.messageTtlMs < 1)) {
      return asyncReject("queue-enqueue", "invalid_argument", "message_ttl");
    }
    return this.gameData.startAsync("queue-enqueue", {
      tag: "queue-enqueue",
      ns: this.ns,
      payloadJson: encoded,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.messageTtlMs !== undefined ? { messageTtlMs: BigInt(options.messageTtlMs) } : {}),
    }, options);
  }

  receive(options?: WriteOptions & { limit?: number; visibilityTimeoutMs?: number; waitTimeoutMs?: number }): Operation<{ messages: QueueMessage[]; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return localError("queue-receive", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    if (requireName(this.ns, "ns")) return localError("queue-receive", "invalid_argument", "ns");
    const wait = options?.waitTimeoutMs ?? 0;
    if (!Number.isInteger(wait) || wait < 0 || wait > 25_000) return localError("queue-receive", "invalid_argument", "wait_timeout");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("queue-receive", "invalid_argument", "mutation_id");
    return this.gameData.start("queue-receive", {
      tag: "queue-receive",
      ns: this.ns,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.visibilityTimeoutMs !== undefined ? { visibilityTimeoutMs: BigInt(options.visibilityTimeoutMs) } : {}),
      ...(options?.waitTimeoutMs !== undefined ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
    }, options, undefined, wait);
  }

  receiveAsync(
    options?: WriteOptions & { limit?: number; visibilityTimeoutMs?: number; waitTimeoutMs?: number },
  ): Promise<{ messages: QueueMessage[]; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return asyncReject("queue-receive", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    if (requireName(this.ns, "ns")) return asyncReject("queue-receive", "invalid_argument", "ns");
    const wait = options?.waitTimeoutMs ?? 0;
    if (!Number.isInteger(wait) || wait < 0 || wait > 25_000) return asyncReject("queue-receive", "invalid_argument", "wait_timeout");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("queue-receive", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("queue-receive", {
      tag: "queue-receive",
      ns: this.ns,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.visibilityTimeoutMs !== undefined ? { visibilityTimeoutMs: BigInt(options.visibilityTimeoutMs) } : {}),
      ...(options?.waitTimeoutMs !== undefined ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
    }, options, undefined, wait);
  }

  ack(receipt: string, options?: WriteOptions): Operation<{ acknowledged: true; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return localError("queue-ack", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    const invalid = requireName(this.ns, "ns") ?? requireName(receipt, "receipt");
    if (invalid) return localError("queue-ack", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("queue-ack", "invalid_argument", "mutation_id");
    return this.gameData.start("queue-ack", {
      tag: "queue-ack",
      ns: this.ns,
      receipt,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  ackAsync(receipt: string, options?: WriteOptions): Promise<{ acknowledged: true; replayed: boolean }> {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return asyncReject("queue-ack", "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON, { mutationId: queueErrorMutationId(options) });
    const invalid = requireName(this.ns, "ns") ?? requireName(receipt, "receipt");
    if (invalid) return asyncReject("queue-ack", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("queue-ack", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("queue-ack", {
      tag: "queue-ack",
      ns: this.ns,
      receipt,
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }
}

export class Counters {
  /** @internal */
  constructor(private readonly gameData: GameData, private readonly ns: string) {}

  get(key: string, options?: CallOptions): Operation<ReadResult<bigint>> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("counter-read", "invalid_argument", invalid);
    return this.gameData.start("counter-read", { tag: "counters-get", ns: this.ns, key }, options);
  }

  getAsync(key: string, options?: CallOptions): Promise<ReadResult<bigint>> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("counter-read", "invalid_argument", invalid);
    return this.gameData.startAsync("counter-read", { tag: "counters-get", ns: this.ns, key }, options);
  }

  add(key: string, delta: bigint, options?: WriteOptions & { min?: bigint; max?: bigint }): Operation<WriteResult & { value: bigint }> {
    return this.counterWrite("counters-add", key, delta, options);
  }

  addAsync(
    key: string,
    delta: bigint,
    options?: WriteOptions & { min?: bigint; max?: bigint },
  ): Promise<WriteResult & { value: bigint }> {
    return this.counterWriteAsync("counters-add", key, delta, options);
  }

  compareExchange(key: string, stateToken: string, value: bigint, options?: WriteOptions): Operation<WriteResult & { value: bigint }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key") ?? requireName(stateToken, "state_token");
    if (invalid) return localError("counter-write", "invalid_argument", invalid);
    if (typeof value !== "bigint") return localError("counter-write", "invalid_argument", "value");
    const canonical = parseCanonicalInteger(formatCanonicalInteger(value), I64_MIN, I64_MAX);
    if (canonical === undefined) return localError("counter-write", "invalid_argument", "integer_overflow");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("counter-write", "invalid_argument", "mutation_id");
    return this.gameData.start("counter-write", {
      tag: "counters-compare-exchange",
      ns: this.ns,
      key,
      stateToken,
      value: formatCanonicalInteger(canonical),
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  compareExchangeAsync(
    key: string,
    stateToken: string,
    value: bigint,
    options?: WriteOptions,
  ): Promise<WriteResult & { value: bigint }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key") ?? requireName(stateToken, "state_token");
    if (invalid) return asyncReject("counter-write", "invalid_argument", invalid);
    if (typeof value !== "bigint") return asyncReject("counter-write", "invalid_argument", "value");
    const canonical = parseCanonicalInteger(formatCanonicalInteger(value), I64_MIN, I64_MAX);
    if (canonical === undefined) return asyncReject("counter-write", "invalid_argument", "integer_overflow");
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("counter-write", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("counter-write", {
      tag: "counters-compare-exchange",
      ns: this.ns,
      key,
      stateToken,
      value: formatCanonicalInteger(canonical),
      ...(mutationId ? { mutationId } : {}),
    }, options);
  }

  remove(key: string, options?: RemoveOptions): Operation<RemoveResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("counter-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("counter-remove", "invalid_argument", "mutation_id");
    return this.gameData.start("counter-remove", {
      tag: "counters-remove",
      ns: this.ns,
      key,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
    }, options);
  }

  removeAsync(key: string, options?: RemoveOptions): Promise<RemoveResult> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("counter-remove", "invalid_argument", invalid);
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("counter-remove", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("counter-remove", {
      tag: "counters-remove",
      ns: this.ns,
      key,
      ...(mutationId ? { mutationId } : {}),
      ...(options?.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
    }, options);
  }

  private counterWrite(tag: "counters-add", key: string, delta: bigint, options?: WriteOptions & { min?: bigint; max?: bigint }): Operation<WriteResult & { value: bigint }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return localError("counter-write", "invalid_argument", invalid);
    if (typeof delta !== "bigint") return localError("counter-write", "invalid_argument", "value");
    const canonical = parseCanonicalInteger(formatCanonicalInteger(delta), I64_MIN, I64_MAX);
    if (canonical === undefined) return localError("counter-write", "invalid_argument", "integer_overflow");
    const min = options?.min === undefined ? undefined : parseCanonicalInteger(formatCanonicalInteger(options.min), I64_MIN, I64_MAX);
    const max = options?.max === undefined ? undefined : parseCanonicalInteger(formatCanonicalInteger(options.max), I64_MIN, I64_MAX);
    if ((options?.min !== undefined && min === undefined) || (options?.max !== undefined && max === undefined)) {
      return localError("counter-write", "invalid_argument", "integer_overflow");
    }
    const mutationId = optionalMutation(options);
    if (mutationId === false) return localError("counter-write", "invalid_argument", "mutation_id");
    return this.gameData.start("counter-write", {
      tag,
      ns: this.ns,
      key,
      delta: formatCanonicalInteger(canonical),
      ...(mutationId ? { mutationId } : {}),
      ...(min !== undefined ? { min: formatCanonicalInteger(min) } : {}),
      ...(max !== undefined ? { max: formatCanonicalInteger(max) } : {}),
    }, options);
  }

  private counterWriteAsync(
    tag: "counters-add",
    key: string,
    delta: bigint,
    options?: WriteOptions & { min?: bigint; max?: bigint },
  ): Promise<WriteResult & { value: bigint }> {
    const invalid = requireName(this.ns, "ns") ?? requireName(key, "key");
    if (invalid) return asyncReject("counter-write", "invalid_argument", invalid);
    if (typeof delta !== "bigint") return asyncReject("counter-write", "invalid_argument", "value");
    const canonical = parseCanonicalInteger(formatCanonicalInteger(delta), I64_MIN, I64_MAX);
    if (canonical === undefined) return asyncReject("counter-write", "invalid_argument", "integer_overflow");
    const min = options?.min === undefined ? undefined : parseCanonicalInteger(formatCanonicalInteger(options.min), I64_MIN, I64_MAX);
    const max = options?.max === undefined ? undefined : parseCanonicalInteger(formatCanonicalInteger(options.max), I64_MIN, I64_MAX);
    if ((options?.min !== undefined && min === undefined) || (options?.max !== undefined && max === undefined)) {
      return asyncReject("counter-write", "invalid_argument", "integer_overflow");
    }
    const mutationId = optionalMutation(options);
    if (mutationId === false) return asyncReject("counter-write", "invalid_argument", "mutation_id");
    return this.gameData.startAsync("counter-write", {
      tag,
      ns: this.ns,
      key,
      delta: formatCanonicalInteger(canonical),
      ...(mutationId ? { mutationId } : {}),
      ...(min !== undefined ? { min: formatCanonicalInteger(min) } : {}),
      ...(max !== undefined ? { max: formatCanonicalInteger(max) } : {}),
    }, options);
  }
}
