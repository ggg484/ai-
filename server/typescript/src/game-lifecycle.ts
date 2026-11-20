import {
  MAX_GAME_LIFECYCLE_CLAIM,
  MAX_GAME_LIFECYCLE_DISPATCHES,
  MAX_GAME_LIFECYCLE_KEY_BYTES,
  MAX_GAME_LIFECYCLE_REGISTRATIONS,
  gameLifecycleKeyByteLength,
  gameLifecycleRegistrationId,
  type GameLifecycleDispatchedEvent,
  type GameLifecycleHandlerReport,
  type GameLifecycleKind,
  type GameLifecyclePeriod,
  type GameLifecycleRegistration,
  type GameLifecycleSyncError,
} from "./game-lifecycle-abi.ts";
import {
  gameLifecycleClaim,
  gameLifecycleComplete,
  gameLifecycleReleaseDispatch,
  gameLifecycleSyncRegistrations,
} from "./host.ts";

export type GameLifecycleEvent = {
  period: GameLifecyclePeriod;
  key: string;
  kind: GameLifecycleKind;
  eventId: string;
  scheduledAtMillis: bigint;
};

export type GameLifecycleHandler = (event: GameLifecycleEvent) => Promise<void>;

export type GameLifecycleRegistrar = {
  register(entry: GameLifecycleRegistration, handler: GameLifecycleHandler): void;
};

type RegistrationRecord = GameLifecycleRegistration & { handler: GameLifecycleHandler };

type DispatchSlot = {
  event: GameLifecycleDispatchedEvent;
  pendingReport?: GameLifecycleHandlerReport;
};

const PERIODS = new Set<GameLifecyclePeriod>(["minute-1", "minute-2", "minute-5", "minute-10"]);

function validateRegistration(entry: GameLifecycleRegistration): void {
  if (!PERIODS.has(entry.period)) {
    throw new Error("Unsupported game lifecycle period");
  }
  const keyBytes = gameLifecycleKeyByteLength(entry.key);
  if (keyBytes === 0 || keyBytes > MAX_GAME_LIFECYCLE_KEY_BYTES) {
    throw new Error(`Game lifecycle key must be 1..${MAX_GAME_LIFECYCLE_KEY_BYTES} UTF-8 bytes`);
  }
  if (entry.kind === "refresh" && entry.catchUp !== "latest") {
    throw new Error("Refresh handlers must use catchUp latest");
  }
  if (entry.kind === "settlement" && entry.catchUp !== "each") {
    throw new Error("Settlement handlers must use catchUp each");
  }
}

/** Platform-scheduled minute handlers with explicit `(period, key)` identity. */
export class GameLifecycle {
  readonly #registrations = new Map<string, RegistrationRecord>();
  readonly #dispatches = new Map<bigint, DispatchSlot>();
  #dirty = false;

  /** Registrar passed to {@link Room.configureGameLifecycle}. */
  asRegistrar(): GameLifecycleRegistrar {
    return {
      register: (entry, handler) => this.register(entry, handler),
    };
  }

  /** @internal Clear author table before create/restore load entry re-runs. */
  resetAuthorRegistrations(): void {
    this.#registrations.clear();
    this.#dirty = true;
  }

  register(entry: GameLifecycleRegistration, handler: GameLifecycleHandler): void {
    validateRegistration(entry);
    const id = gameLifecycleRegistrationId(entry.period, entry.key);
    if (this.#registrations.size >= MAX_GAME_LIFECYCLE_REGISTRATIONS && !this.#registrations.has(id)) {
      throw new Error("Game lifecycle registration limit exceeded");
    }
    if (this.#registrations.has(id)) {
      const existing = this.#registrations.get(id)!;
      if (existing.catchUp !== entry.catchUp || existing.kind !== entry.kind) {
        throw new Error(`Game lifecycle registration mismatch for (${entry.period}, ${entry.key})`);
      }
    }
    this.#registrations.set(id, { ...entry, handler });
    this.#dirty = true;
  }

  /** @internal Push registration snapshot to Host after create/restore load entry. */
  syncRegistrationsToHost(): { ok: true } | { ok: false; error: GameLifecycleSyncError } {
    if (!this.#dirty && this.#registrations.size === 0) return { ok: true };
    const entries: GameLifecycleRegistration[] = [...this.#registrations.values()].map(({ handler: _h, ...rest }) => rest);
    const result = gameLifecycleSyncRegistrations(entries);
    if (!result.ok) {
      return result;
    }
    this.#dirty = false;
    return { ok: true };
  }

  /** @internal Called after Game Data has ingested the shared notification batch. */
  drive(runAsync: (work: () => Promise<void>) => boolean): void {
    if (this.#dispatches.size >= MAX_GAME_LIFECYCLE_DISPATCHES) {
      return;
    }
    const batch = gameLifecycleClaim(MAX_GAME_LIFECYCLE_CLAIM);
    for (let index = 0; index < batch.events.length; index += 1) {
      const event = batch.events[index]!;
      if (this.#dispatches.size >= MAX_GAME_LIFECYCLE_DISPATCHES) {
        for (let rest = index; rest < batch.events.length; rest += 1) {
          gameLifecycleReleaseDispatch(batch.events[rest]!.handle);
        }
        break;
      }
      const reg = this.#registrations.get(gameLifecycleRegistrationId(event.period, event.key));
      if (!reg) {
        gameLifecycleReleaseDispatch(event.handle);
        continue;
      }
      if (this.#dispatches.has(event.handle.id)) continue;
      this.#dispatches.set(event.handle.id, { event });
      const started = runAsync(() => this.#runHandler(reg.handler, event));
      if (!started) {
        this.#dispatches.delete(event.handle.id);
        gameLifecycleReleaseDispatch(event.handle);
        continue;
      }
    }
    this.#flushPendingReports();
  }

  /** @internal Drop in-flight dispatches at generation boundary. */
  discard(): void {
    for (const slot of this.#dispatches.values()) {
      try {
        gameLifecycleReleaseDispatch(slot.event.handle);
      } catch {
        // Host may already be torn down at dispose.
      }
    }
    this.#dispatches.clear();
    this.#dirty = this.#registrations.size > 0;
  }

  async #runHandler(handler: GameLifecycleHandler, event: GameLifecycleDispatchedEvent): Promise<void> {
    const slot = this.#dispatches.get(event.handle.id);
    if (!slot) return;
    let report: GameLifecycleHandlerReport;
    try {
      await handler({
        period: event.period,
        key: event.key,
        kind: event.kind,
        eventId: event.eventId,
        scheduledAtMillis: event.scheduledAtMillis,
      });
      report = { tag: "success" };
    } catch (error) {
      report = {
        tag: "failed",
        val: {
          code: "handler-error",
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }
    slot.pendingReport = report;
    this.#flushPendingReports();
  }

  #flushPendingReports(): void {
    for (const [id, slot] of [...this.#dispatches]) {
      if (!slot.pendingReport) continue;
      const result = gameLifecycleComplete(slot.event.handle, slot.pendingReport);
      if (!result.ok) {
        if (result.error === "handle-expired" || result.error === "already-completed") {
          this.#dispatches.delete(id);
        }
        continue;
      }
      this.#dispatches.delete(id);
    }
  }
}
