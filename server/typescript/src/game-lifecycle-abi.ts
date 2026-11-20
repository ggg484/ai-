/** Host ABI for `builda:game-lifecycle/game-lifecycle-api@1.0.0`. */

export type GameLifecyclePeriod = "minute-1" | "minute-2" | "minute-5" | "minute-10";

export type GameLifecycleCatchUp = "latest" | "each";

export type GameLifecycleKind = "refresh" | "settlement";

export type GameLifecycleRegistration = {
  period: GameLifecyclePeriod;
  key: string;
  catchUp: GameLifecycleCatchUp;
  kind: GameLifecycleKind;
};

export type GameLifecycleSyncError =
  | "capability-unavailable"
  | "too-many-registrations"
  | "invalid-key"
  | "duplicate-registration"
  | "unsupported-period"
  | "catch-up-kind-mismatch";

export type GameLifecycleDispatchHandle = { id: bigint };

export type GameLifecycleDispatchedEvent = {
  handle: GameLifecycleDispatchHandle;
  period: GameLifecyclePeriod;
  key: string;
  kind: GameLifecycleKind;
  eventId: string;
  scheduledAtMillis: bigint;
};

export type GameLifecycleClaimBatch = {
  events: GameLifecycleDispatchedEvent[];
};

export type GameLifecycleFailureDetail = {
  code: string;
  reason?: string;
};

export type GameLifecycleHandlerReport =
  | { tag: "success" }
  | { tag: "failed"; val: GameLifecycleFailureDetail };

export type GameLifecycleCompleteError =
  | "handle-unknown"
  | "handle-expired"
  | "already-completed"
  | "capability-unavailable";

export const ASYNC_SOURCE_GAME_LIFECYCLE = 2;

export const MAX_GAME_LIFECYCLE_KEY_BYTES = 128;
export const MAX_GAME_LIFECYCLE_REGISTRATIONS = 32;
export const MAX_GAME_LIFECYCLE_DISPATCHES = 64;
export const MAX_GAME_LIFECYCLE_CLAIM = 16;

const keyEncoder = new TextEncoder();

/** Stable registration identity `(period, key)`. */
export function gameLifecycleRegistrationId(period: GameLifecyclePeriod, key: string): string {
  return `${period}:${key}`;
}

export function gameLifecycleKeyByteLength(key: string): number {
  return keyEncoder.encode(key).length;
}
