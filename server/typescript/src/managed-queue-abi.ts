/** Host ABI for `builda:managed-queue/managed-queue-api@1.0.0`. */

export type GameQueueRegistration = {
  namespace: string;
  handlerId: string;
  compatVersion: number;
};

export type GameQueueSyncError =
  | "capability-unavailable"
  | "too-many-registrations"
  | "invalid-namespace"
  | "invalid-handler-id"
  | "invalid-compat-version"
  | "duplicate-registration"
  | "definition-conflict";

export type GameQueueDispatchHandle = { id: bigint };

export type GameQueueDispatchedMessage = {
  handle: GameQueueDispatchHandle;
  namespace: string;
  messageId: string;
  payloadJson: Uint8Array;
  visibleUntilMillis: bigint;
};

export type GameQueueClaimBatch = { messages: GameQueueDispatchedMessage[] };
export type GameQueueHandlerReport = { tag: "success" } | { tag: "failed"; val: string };
export type GameQueueCompleteError =
  | "handle-unknown"
  | "handle-expired"
  | "already-completed"
  | "capability-unavailable";

export const MAX_GAME_QUEUE_REGISTRATIONS = 32;
export const MAX_GAME_QUEUE_DISPATCHES = 32;
export const MAX_GAME_QUEUE_CLAIM = 16;
export const MAX_GAME_QUEUE_IDENTIFIER_BYTES = 128;

const encoder = new TextEncoder();

export function gameQueueIdentifierByteLength(value: string): number {
  return encoder.encode(value).length;
}
