/** Host ABI types for Game Data. Author-facing types live in game-data.ts. */

const textEncoder = new TextEncoder();
let textDecoder: TextDecoder | undefined;

function decodeUtf8(bytes: Uint8Array): string {
  textDecoder ??= new TextDecoder("utf-8", { fatal: true });
  return textDecoder.decode(bytes);
}

export const I64_MIN = -9223372036854775808n;
export const I64_MAX = 9223372036854775807n;
export const SCORE_ABS_MAX = 9007199254740991n;

export type ResultKind =
  | "object-read"
  | "object-batch"
  | "object-write"
  | "object-remove"
  | "object-list-keys"
  | "sorted-write"
  | "sorted-score"
  | "sorted-page"
  | "sorted-rank"
  | "sorted-count"
  | "sorted-remove"
  | "queue-enqueue"
  | "queue-receive"
  | "queue-ack"
  | "counter-read"
  | "counter-write"
  | "counter-remove"
  | "capabilities";

export const WRITE_KINDS = new Set<ResultKind>([
  "object-write",
  "object-remove",
  "sorted-write",
  "sorted-remove",
  "queue-enqueue",
  "queue-receive",
  "queue-ack",
  "counter-write",
  "counter-remove",
]);

export type HostFound =
  | { found: true; valueJson: Uint8Array; revision: string; stateToken: string }
  | { found: false; stateToken: string };

export type HostOperation =
  | { tag: "objects-get"; ns: string; key: string; fresh: boolean }
  | { tag: "objects-get-many"; ns: string; keys: string[]; fresh: boolean }
  | { tag: "objects-create" | "objects-set"; ns: string; key: string; valueJson: Uint8Array; mutationId?: string }
  | { tag: "objects-compare-exchange"; ns: string; key: string; stateToken: string; valueJson: Uint8Array; mutationId?: string }
  | { tag: "objects-update"; ns: string; key: string; maxAttempts: number }
  | { tag: "objects-remove"; ns: string; key: string; mutationId?: string; expectedRevision?: string }
  | { tag: "objects-list-keys"; ns: string; prefix?: string; limit?: number; cursor?: string }
  | { tag: "sorted-set-score"; ns: string; memberId: string; score: string; mutationId?: string }
  | { tag: "sorted-get-score"; ns: string; memberId: string }
  | { tag: "sorted-remove"; ns: string; memberId: string; mutationId?: string }
  | { tag: "sorted-range"; ns: string; order?: "ascending" | "descending"; minScore?: string; maxScore?: string; limit?: number; cursor?: string }
  | { tag: "sorted-rank"; ns: string; memberId: string; order?: "ascending" | "descending" }
  | { tag: "sorted-count"; ns: string }
  | { tag: "queue-enqueue"; ns: string; payloadJson: Uint8Array; mutationId?: string; messageTtlMs?: bigint }
  | { tag: "queue-receive"; ns: string; mutationId?: string; limit?: number; visibilityTimeoutMs?: bigint; waitTimeoutMs?: number }
  | { tag: "queue-ack"; ns: string; receipt: string; mutationId?: string }
  | { tag: "counters-get"; ns: string; key: string }
  | { tag: "counters-add"; ns: string; key: string; delta: string; mutationId?: string; min?: string; max?: string }
  | { tag: "counters-compare-exchange"; ns: string; key: string; stateToken: string; value: string; mutationId?: string }
  | { tag: "counters-remove"; ns: string; key: string; mutationId?: string; expectedRevision?: string }
  | { tag: "capabilities" };

export type HostBatchItem =
  | { tag: "ok"; key: string; found: HostFound }
  | { tag: "error"; key: string; code: string; reason?: string; requestId: string };

export type HostValue =
  | { tag: "object-read"; found: HostFound }
  | { tag: "object-batch"; items: HostBatchItem[] }
  | { tag: "object-write" | "counter-write"; revision: string; changed: boolean; replayed: boolean; value?: string }
  | { tag: "object-remove" | "counter-remove"; revision: string; changed: boolean; replayed: boolean; removed: boolean }
  | { tag: "object-list-keys"; keys: string[]; nextCursor: string | null }
  | { tag: "sorted-write"; changed: boolean; replayed: boolean }
  | { tag: "sorted-score"; found: false } | { tag: "sorted-score"; found: true; score: string }
  | { tag: "sorted-remove"; removed: boolean; replayed: boolean }
  | { tag: "sorted-page"; items: Array<{ memberId: string; score: string }>; nextCursor: string | null }
  | { tag: "sorted-rank"; found: false } | { tag: "sorted-rank"; found: true; rank: bigint }
  | { tag: "sorted-count"; count: bigint }
  | { tag: "queue-enqueue"; messageId: string; expiresAt: bigint; replayed: boolean }
  | { tag: "queue-receive"; messages: Array<{ messageId: string; payloadJson: Uint8Array; receipt: string; visibleUntil: bigint; expiresAt: bigint }>; replayed: boolean }
  | { tag: "queue-ack"; replayed: boolean }
  | { tag: "counter-read"; found: true; value: string; revision: string; stateToken: string }
  | { tag: "counter-read"; found: false; stateToken: string }
  | { tag: "capabilities"; apiMajor: number; capabilityIds: string[]; limits: Record<string, bigint> };

export type HostFailure = {
  code: string;
  requestId: string;
  reason?: string;
  mutationId?: string;
  retryAfterMs?: number;
  recoveryId?: bigint;
  resultKind: ResultKind;
  recoveryError?: { code: string; reason?: string };
};

export type HostPoll =
  | { tag: "pending" }
  | { tag: "needs-transform"; readGeneration: bigint; read: HostFound }
  | { tag: "completed"; value: HostValue }
  | { tag: "failed"; error: HostFailure }
  | { tag: "expired" };

export type HostProposal = { tag: "object"; valueJson: Uint8Array } | { tag: "callback-abort" };

const PUBLIC_CODES: Record<string, string> = {
  "invalid-argument": "invalid_argument",
  invalid_argument: "invalid_argument",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  conflict: "conflict",
  "rate-limited": "rate_limited",
  rate_limited: "rate_limited",
  "capacity-exceeded": "capacity_exceeded",
  capacity_exceeded: "capacity_exceeded",
  "stale-receipt": "stale_receipt",
  stale_receipt: "stale_receipt",
  "invalid-cursor": "invalid_cursor",
  invalid_cursor: "invalid_cursor",
  "unsupported-capability": "unsupported_capability",
  unsupported_capability: "unsupported_capability",
  unavailable: "unavailable",
  "outcome-unknown": "outcome_unknown",
  outcome_unknown: "outcome_unknown",
  "idempotency-mismatch": "idempotency_mismatch",
  idempotency_mismatch: "idempotency_mismatch",
  "idempotency-expired": "idempotency_expired",
  idempotency_expired: "idempotency_expired",
  timeout: "timeout",
  cancelled: "cancelled",
  "operation-expired": "operation_expired",
  operation_expired: "operation_expired",
  "recovery-expired": "recovery_expired",
  recovery_expired: "recovery_expired",
  "callback-failed": "callback_failed",
  callback_failed: "callback_failed",
  busy: "busy",
  "not-ready": "unavailable",
  "too-many-handles": "capacity_exceeded",
  "invalid-deadline": "invalid_argument",
  "callback-reentrancy": "busy",
};

/** Map a WIT or start error onto the public snake_case code. */
export function publicCode(raw: string): string {
  return PUBLIC_CODES[raw] ?? "unavailable";
}

const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;

/** Keep only a stable reason token. */
export function publicReason(raw: string | undefined): string | undefined {
  if (!raw || !REASON_PATTERN.test(raw)) return undefined;
  return raw;
}

const MUTATION_ID_PATTERN = /^m1\.[0-9]+\.[0-9a-f]{32}$/;

/** Host-allocated and author-supplied mutation ids share one format. */
export function validMutationId(value: string): boolean {
  return MUTATION_ID_PATTERN.test(value);
}

/** Parse a canonical signed decimal inside an inclusive bigint range. */
export function parseCanonicalInteger(text: string, min: bigint, max: bigint): bigint | undefined {
  if (typeof text !== "string" || text === "-0" || !/^-?(?:0|[1-9][0-9]*)$/.test(text)) return undefined;
  const value = BigInt(text);
  if (value < min || value > max) return undefined;
  return value;
}

/** Format a bigint as a canonical decimal. */
export function formatCanonicalInteger(value: bigint): string {
  return value.toString();
}

/** Canonical score string for a JS safe integer. Negative zero becomes 0. */
export function canonicalScore(score: number): string | undefined {
  if (typeof score !== "number" || !Number.isSafeInteger(score)) return undefined;
  if (Object.is(score, -0)) return "0";
  const value = BigInt(score);
  if (value < -SCORE_ABS_MAX || value > SCORE_ABS_MAX) return undefined;
  return value.toString();
}

function compareUtf8(left: string, right: string): number {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

function escapeJson(source: string, out: string[]): void {
  out.push(JSON.stringify(source));
}

function appendCanonical(value: unknown, out: string[], seen: Set<object>, depth: number): void {
  if (depth > 64) throw new Error("depth");
  if (value === null) {
    out.push("null");
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("number");
    if (Object.is(value, -0)) {
      out.push("0");
      return;
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw new Error("integer");
      out.push(String(value));
      return;
    }
    out.push(JSON.stringify(value));
    return;
  }
  if (typeof value === "string") {
    escapeJson(value, out);
    return;
  }
  if (typeof value !== "object") throw new Error("type");
  if (seen.has(value)) throw new Error("cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((item, index) => {
      if (index > 0) out.push(",");
      appendCanonical(item, out, seen, depth + 1);
    });
    out.push("]");
  } else {
    out.push("{");
    const keys = Object.keys(value).sort(compareUtf8);
    keys.forEach((key, index) => {
      if (key.includes(String.fromCharCode(0))) throw new Error("nul");
      if (index > 0) out.push(",");
      escapeJson(key, out);
      out.push(":");
      appendCanonical((value as Record<string, unknown>)[key], out, seen, depth + 1);
    });
    out.push("}");
  }
  seen.delete(value);
}

/** Encode a JSON object with UTF-8 key order and canonical negative zero. */
export function canonicalJsonObject(value: unknown): Uint8Array {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("object");
  }
  const parts: string[] = [];
  appendCanonical(value, parts, new Set(), 0);
  return textEncoder.encode(parts.join(""));
}

/** Decode canonical JSON bytes. Invalid UTF-8 throws. */
export function decodeJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(decodeUtf8(bytes));
}

/** True when a callback result is a thenable. */
export function isThenable(value: unknown): boolean {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}

export function safeNonNegative(value: bigint): number | undefined {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}
