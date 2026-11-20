export { Client } from "./client.ts";
export { createRoomAndTransfer, roomSwitchOrigin, normalizeRoomSwitch, RoomSwitchOperation, RoomSwitchError,
  type RoomSwitchRequest, type RoomSwitchStatus, type RoomSwitchPhase, type RoomSwitchOrigin } from "./room-switch.ts";
export { Room, type MessageHandler } from "./room.ts";
export {
  admitAsyncRuntime,
  discardAsyncRuntimeGeneration,
  guardSyncUserReturn,
  isAsyncRuntimeSupported,
  observeAsyncGeneration,
  MIN_ASYNC_HOST_GENERATION,
  SYNC_USER_HOOK_MUST_BE_SYNC,
} from "./async-runtime.ts";
export {
  cloudEnqueueState,
  cloudFlushBarrier,
  cloudGetSnapshot,
  cloudInt64Value,
  cloudPollFlush,
  cloudPollSnapshot,
  cloudReadCurrent,
  cloudReadManyCurrent,
  cloudStringValue,
  CloudStateError,
  configureRoomHost,
  decodeJson,
  encodeJson,
  type CloudBufferedReceipt,
  type CloudCurrentRead,
  type CloudFlushResult,
  type CloudSnapshotResult,
  type CloudWriteRequest,
  type OrderDeliveryCallback,
  type OrderDeliveryResult,
  type OrderDeliveryStatus,
  type RoomHost,
  type VerifiedOrder,
} from "./host.ts";
export {
  GameQueues,
  type GameQueueEvent,
  type GameQueueHandler,
  type GameQueueRegistrar,
} from "./managed-queue.ts";
export {
  GameLifecycle,
  type GameLifecycleEvent,
  type GameLifecycleHandler,
  type GameLifecycleRegistrar,
} from "./game-lifecycle.ts";
export { gameLifecycleKeyByteLength, gameLifecycleRegistrationId } from "./game-lifecycle-abi.ts";
export {
  type GameQueueRegistration,
  type GameQueueSyncError,
  type GameQueueCompleteError,
} from "./managed-queue-abi.ts";
export {
  type GameLifecycleCatchUp,
  type GameLifecycleKind,
  type GameLifecyclePeriod,
  type GameLifecycleRegistration,
} from "./game-lifecycle-abi.ts";
export { ConfigTables, type ConfigRead } from "./config-tables.ts";
export {
  Counters,
  GameData,
  GameQueue,
  Objects,
  Operation,
  RecoveryHandle,
  SortedIndex,
  gameDataErrorMessage,
} from "./game-data.ts";
export type {
  CallOptions,
  Capabilities,
  GameDataAsyncError,
  GameDataError,
  GameDataLimits,
  JSONObject,
  JSONValue,
  ObjectRef,
  Page,
  Poll,
  QueueMessage,
  ReadOptions,
  ReadResult,
  RemoveOptions,
  RemoveResult,
  Result,
  WriteOptions,
  WriteResult,
} from "./game-data.ts";
export type {
  ActivationReason,
  CheckpointReason,
  DisposeReason,
  JsonValue,
  RoomChannel,
  RoomConstructor,
  RoomContext,
  RoomRosterSeat,
  RoomSnapshot,
} from "./types.ts";

/** Keep the Room constructor type so the platform build adapter can generate the WIT guest. */
export function defineRoom<T>(room: T): T {
  return room;
}

export { PlayerData, PlayerDataTarget, PlayerDataRecoveryHandle } from "./player-data.ts";
export type { CloudValue, PlayerDataCallOptions, PlayerDataRead, PlayerDataDecision, PlayerDataWriteResult, PlayerDataPendingWrite, PlayerDataCloseResult, PlayerDataError } from "./player-data.ts";
