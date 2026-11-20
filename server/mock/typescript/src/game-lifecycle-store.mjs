/** In-process Host stubs for `builda:game-lifecycle/game-lifecycle-api@1.0.0`. */

const PERIODS = new Set(["minute-1", "minute-2", "minute-5", "minute-10"]);
const encoder = new TextEncoder();

function registrationIdentity(entry) {
  return `${entry.period}:${entry.key}`;
}

/** @param {() => bigint} _nowMillis */
export function createGameLifecycleStore(_nowMillis) {
  let registrations = [];
  let nextDispatchId = 1n;
  const pendingDispatches = new Map();

  return {
    gameLifecycleSyncRegistrations(entries) {
      const ids = new Set();
      for (const entry of entries) {
        const keyBytes = encoder.encode(String(entry?.key ?? "")).length;
        if (keyBytes === 0 || keyBytes > 128) return { ok: false, error: "invalid-key" };
        if (!PERIODS.has(entry.period)) return { ok: false, error: "unsupported-period" };
        const id = registrationIdentity(entry);
        if (ids.has(id)) return { ok: false, error: "duplicate-registration" };
        ids.add(id);
        if (entry.kind === "refresh" && entry.catchUp !== "latest") {
          return { ok: false, error: "catch-up-kind-mismatch" };
        }
        if (entry.kind === "settlement" && entry.catchUp !== "each") {
          return { ok: false, error: "catch-up-kind-mismatch" };
        }
      }
      if (entries.length > 32) return { ok: false, error: "too-many-registrations" };
      registrations = entries.map((entry) => ({ ...entry }));
      return { ok: true };
    },
    gameLifecycleClaim(_limit) {
      return { events: [] };
    },
    gameLifecycleComplete(handle, _report) {
      if (!pendingDispatches.has(handle.id)) {
        return { ok: false, error: "handle-unknown" };
      }
      pendingDispatches.delete(handle.id);
      return { ok: true };
    },
    gameLifecycleReleaseDispatch(handle) {
      pendingDispatches.delete(handle.id);
    },
    _enqueueMockDispatch(event) {
      const id = nextDispatchId++;
      pendingDispatches.set(id, event);
      return { handle: { id }, ...event };
    },
  };
}
