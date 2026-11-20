/** Host ABI for `builda:async-runtime/async-runtime-api@1.0.0`. */

export const ASYNC_SOURCE_GAME_DATA = 1;
export const ASYNC_SOURCE_MANAGED_QUEUE = 3;

export type AsyncCompletion = {
  source: number;
  operationId: bigint;
};

export type AsyncCompletionBatch = {
  generation: bigint;
  rescan: boolean;
  events: AsyncCompletion[];
};

/** `limit` 0 observes generation only; Host caps limit at 16. */
export type AsyncRuntimePoll = (limit: number) => AsyncCompletionBatch;
