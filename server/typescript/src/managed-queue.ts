import {
  MAX_GAME_QUEUE_CLAIM,
  MAX_GAME_QUEUE_DISPATCHES,
  MAX_GAME_QUEUE_IDENTIFIER_BYTES,
  MAX_GAME_QUEUE_REGISTRATIONS,
  gameQueueIdentifierByteLength,
  type GameQueueCompleteError,
  type GameQueueDispatchedMessage,
  type GameQueueHandlerReport,
  type GameQueueRegistration,
  type GameQueueSyncError,
} from "./managed-queue-abi.ts";
import {
  managedQueueClaim,
  managedQueueComplete,
  managedQueueReleaseDispatch,
  managedQueueSyncRegistrations,
} from "./host.ts";
import type { JSONObject } from "./game-data.ts";
import { currentAsyncSettlementEpoch, currentObservedAsyncGeneration } from "./async-runtime.ts";
import { GAME_DATA_MESSAGE_QUEUE_ENABLED } from "./game-data-message-queue-feature.ts";

export type { GameQueueRegistration, GameQueueSyncError, GameQueueCompleteError };
export type GameQueueEvent = {
  namespace: string;
  messageId: string;
  payload: JSONObject;
  visibleUntilMillis: bigint;
};
export type GameQueueHandler = (event: GameQueueEvent) => Promise<void>;
export type GameQueueRegistrar = {
  register(registration: GameQueueRegistration, handler: GameQueueHandler): void;
};

type RegistrationRecord = GameQueueRegistration & { handler: GameQueueHandler };
type DispatchSlot = { message: GameQueueDispatchedMessage; epoch: number; settlementEpoch: number; pendingReport?: GameQueueHandlerReport };

let decoder: TextDecoder | undefined;
function validateId(value: string, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const length = gameQueueIdentifierByteLength(value);
  if (length < 1 || length > MAX_GAME_QUEUE_IDENTIFIER_BYTES || value.includes("\0")) {
    throw new Error(`${label} must be 1..${MAX_GAME_QUEUE_IDENTIFIER_BYTES} UTF-8 bytes without NUL`);
  }
}

function validateRegistration(entry: GameQueueRegistration): void {
  validateId(entry.namespace, "Game queue namespace");
  validateId(entry.handlerId, "Game queue handlerId");
  if (!Number.isInteger(entry.compatVersion) || entry.compatVersion <= 0 || entry.compatVersion > 0xffff_ffff) {
    throw new Error("Game queue compatVersion must be a positive u32 integer");
  }
}

function decodeJSONObject(bytes: Uint8Array): JSONObject | undefined {
  try {
    decoder ??= new TextDecoder("utf-8", { fatal: true });
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const valid = (value: unknown): boolean => {
      if (value === null || typeof value === "string" || typeof value === "boolean") return true;
      if (typeof value === "number") return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(valid);
      if (typeof value !== "object") return false;
      return Object.values(value as Record<string, unknown>).every(valid);
    };
    return valid(parsed) ? parsed as JSONObject : undefined;
  } catch {
    return undefined;
  }
}

/** Local Room driver for the Host managed durable queues capability. */
export class GameQueues {
  readonly #registrations = new Map<string, RegistrationRecord>();
  readonly #dispatches = new Map<bigint, DispatchSlot>();
  #dirty = false;
  #epoch = 0;
  #settlementEpoch?: number;

  asRegistrar(): GameQueueRegistrar {
    return { register: (registration, handler) => this.register(registration, handler) };
  }

  resetAuthorRegistrations(): void {
    this.#registrations.clear();
    this.#dirty = true;
  }

  register(registration: GameQueueRegistration, handler: GameQueueHandler): void {
    validateRegistration(registration);
    if (typeof handler !== "function") throw new Error("Game queue handler must be a function");
    if (this.#registrations.has(registration.namespace)) {
      throw new Error(`Duplicate game queue namespace: ${registration.namespace}`);
    }
    if (this.#registrations.size >= MAX_GAME_QUEUE_REGISTRATIONS) {
      throw new Error("Game queue registration limit exceeded");
    }
    this.#registrations.set(registration.namespace, { ...registration, handler });
    this.#dirty = true;
  }

  syncRegistrationsToHost(): { ok: true } | { ok: false; error: GameQueueSyncError } {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) {
      return this.#registrations.size === 0 ? { ok: true } : { ok: false, error: "capability-unavailable" };
    }
    if (!this.#dirty && this.#registrations.size === 0) return { ok: true };
    const registrations = [...this.#registrations.values()].map(({ handler: _handler, ...entry }) => entry);
    const result = managedQueueSyncRegistrations(registrations);
    if (result.ok) {
      this.#dirty = false;
      this.#settlementEpoch = currentAsyncSettlementEpoch();
      const generation = this.#readGeneration();
      if (generation !== undefined) this.#generation = generation;
    }
    return result;
  }

  /** Claim and run work through Room's shared managed task budget. */
  drive(runAsync: (work: () => Promise<void>) => boolean): void {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return;
    const settlementEpoch = currentAsyncSettlementEpoch();
    const generation = this.#readGeneration();
    if (this.#settlementEpoch !== undefined && settlementEpoch !== this.#settlementEpoch) this.#detach();
    this.#settlementEpoch = settlementEpoch;
    if (generation !== undefined) {
      if (this.#generation !== undefined && generation !== this.#generation) this.#detach();
      this.#generation = generation;
    }
    if (this.#dirty) {
      const synced = this.syncRegistrationsToHost();
      if (!synced.ok) return;
    }
    this.#flushPendingReports();
    if (this.#dispatches.size >= MAX_GAME_QUEUE_DISPATCHES) return;
    const batch = managedQueueClaim(MAX_GAME_QUEUE_CLAIM);
    for (let index = 0; index < batch.messages.length; index += 1) {
      const message = batch.messages[index]!;
      if (index >= MAX_GAME_QUEUE_CLAIM || this.#dispatches.size >= MAX_GAME_QUEUE_DISPATCHES) {
        managedQueueReleaseDispatch(message.handle);
        continue;
      }
      if (this.#dispatches.has(message.handle.id)) continue;
      const registration = this.#registrations.get(message.namespace);
      if (!registration) {
        managedQueueReleaseDispatch(message.handle);
        continue;
      }
      const slot = { message, epoch: this.#epoch, settlementEpoch: currentAsyncSettlementEpoch() };
      this.#dispatches.set(message.handle.id, slot);
      const started = runAsync(() => this.#runHandler(registration.handler, slot));
      if (!started) {
        if (this.#dispatches.get(message.handle.id) === slot) this.#dispatches.delete(message.handle.id);
        managedQueueReleaseDispatch(message.handle);
      }
    }
    this.#flushPendingReports();
  }

  discard(): void {
    this.#epoch += 1;
    this.#dispatches.clear();
    this.#generation = undefined;
    this.#settlementEpoch = undefined;
    this.#dirty = this.#registrations.size > 0;
  }

  #generation?: bigint;

  #readGeneration(): bigint | undefined {
    return currentObservedAsyncGeneration();
  }

  #detach(): void {
    // Host generations can reuse numeric handles. Never release or complete an old
    // generation's handle after observing a boundary.
    this.#epoch += 1;
    this.#dispatches.clear();
    this.#dirty = this.#registrations.size > 0;
  }

  async #runHandler(handler: GameQueueHandler, slot: DispatchSlot): Promise<void> {
    const { message } = slot;
    const active = () => slot.epoch === this.#epoch
      && slot.settlementEpoch === currentAsyncSettlementEpoch()
      && this.#dispatches.get(message.handle.id) === slot;
    if (!active()) return;
    const payload = decodeJSONObject(message.payloadJson);
    let report: GameQueueHandlerReport;
    if (payload === undefined) {
      report = { tag: "failed", val: "invalid_payload" };
    } else {
      try {
        await handler({ namespace: message.namespace, messageId: message.messageId, payload, visibleUntilMillis: message.visibleUntilMillis });
        if (!active()) return;
        report = { tag: "success" };
      } catch {
        if (!active()) return;
        report = { tag: "failed", val: "handler_failed" };
      }
    }
    if (!active()) return;
    slot.pendingReport = report;
    this.#flushPendingReports();
  }

  #flushPendingReports(): void {
    for (const [id, slot] of [...this.#dispatches]) {
      if (!slot.pendingReport || slot.settlementEpoch !== currentAsyncSettlementEpoch()) continue;
      const result = managedQueueComplete(slot.message.handle, slot.pendingReport);
      if (result.ok || result.error === "handle-unknown" || result.error === "handle-expired" || result.error === "already-completed") {
        this.#dispatches.delete(id);
      }
    }
  }
}
