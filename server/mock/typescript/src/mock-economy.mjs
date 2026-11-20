/**
 * In-process Cloud State + fake order delivery for the local TypeScript Room Mock.
 * This is a local Host simulation for closed-loop verification, not production storage/ext-pay.
 */

function cloudError(code, message = code) {
  const error = new Error(message);
  error.payload = { tag: code };
  error.code = code;
  return error;
}

const MOCK_ORDER_PATTERN = /^mock_order\.([A-Za-z0-9_-]{1,64})\.[A-Za-z0-9_]+$/;

/** payId of a first-seen order: the saleId embedded by the Builda local client mock, else the orderId itself. */
export function mockOrderPayId(orderId) {
  const match = MOCK_ORDER_PATTERN.exec(String(orderId));
  return match ? match[1] : String(orderId);
}

/**
 * @param {{ orders?: Array<{ orderId: string, userId: string, payId: string }>}} [options]
 */
export function createMockEconomy(options = {}) {
  /** @type {Map<string, Map<string, { value: any, revision: bigint, schemaId: string, schemaVersion: number }>>} */
  const store = new Map();
  /** @type {Array<{ mutationId: string, roleId: string, key: string, orderHandle: bigint | null, apply: () => void }>} */
  let pending = [];
  // Like the platform, a queued ordinary write is applied in the background whether or not the Room ever flushes
  // or even still exists; cloudFlush only confirms it. fulfill writes wait for doOrderFinish so reward and order
  // completion are saved together.
  /** @type {Map<string, { mutationId: string, status: string, appliedGameVarsRevision?: bigint, appliedValueRevision?: bigint, reason?: string }>} */
  const outcomes = new Map();
  const MAX_OUTCOMES = 4096;
  let writeBackTimer = null;
  /** Order handle whose allowed callback is running; writes enqueued meanwhile are fulfill writes. */
  let openOrderHandle = null;
  /** @type {Map<bigint, { status: string, maxLocalSequence?: bigint, items?: any[], reason?: string }>} */
  const flushHandles = new Map();
  /** @type {Map<bigint, { status: string, roleId?: string, entries?: any[], reason?: string }>} */
  const snapshotHandles = new Map();
  /** @type {Map<bigint, { orderId: string, userId: string, payId?: string, phase: string }>} */
  const orderHandles = new Map();
  /** @type {Map<string, { userId: string, payId: string, completed: boolean }>} */
  const orders = new Map();
  let nextSequence = 1n;
  const targetRevisions = new Map();
  let nextHandle = 1n;
  let nextMutation = 1;
  let activeUserId = "";

  for (const [target, name] of [[store, "store"], [targetRevisions, "targetRevisions"], [orders, "orders"]]) {
    if (options.initial?.[name] instanceof Map) for (const [key, value] of options.initial[name]) target.set(key, value);
  }

  for (const entry of options.orders ?? []) {
    if (!entry?.orderId || !entry?.userId || !entry?.payId) continue;
    if (orders.has(String(entry.orderId))) continue;
    orders.set(String(entry.orderId), {
      userId: String(entry.userId),
      payId: String(entry.payId),
      completed: false,
    });
  }

  // A failed save must leave neither values nor a completed order in memory.
  function transaction(action) {
    if (!options.save) return action();
    const before = structuredClone({ store, targetRevisions, orders });
    const pendingBefore = pending.slice();
    try {
      const result = action();
      options.save();
      return result;
    } catch (error) {
      for (const [target, name] of [[store, "store"], [targetRevisions, "targetRevisions"], [orders, "orders"]]) {
        target.clear();
        for (const [key, value] of before[name]) target.set(key, value);
      }
      pending = pendingBefore;
      throw error;
    }
  }

  function roleMap(roleId) {
    let map = store.get(roleId);
    if (!map) {
      map = new Map();
      store.set(roleId, map);
    }
    return map;
  }

  function snapshotEntry(key, record) {
    return {
      key,
      state: "live",
      valueRevision: record.revision,
      schemaId: record.schemaId,
      schemaVersion: record.schemaVersion,
      value: record.value,
    };
  }

  function setActiveUserId(userId) {
    activeUserId = userId ? String(userId) : "";
  }

  function registerOrder(orderId, userId, payId) {
    orders.set(String(orderId), {
      userId: String(userId),
      payId: String(payId),
      completed: orders.get(String(orderId))?.completed ?? false,
    });
  }

  function resolveOrder(orderId, owner) {
    const existing = orders.get(orderId);
    if (existing) return existing;
    // DX default: a first-seen orderId belongs to the player the Room is serving. A Builda local-mock order id
    // (mock_order.<saleId>.<suffix>) yields payId=saleId; any other id yields payId=orderId.
    if (!owner) return null;
    const created = { userId: owner, payId: mockOrderPayId(orderId), completed: false };
    orders.set(orderId, created);
    return created;
  }

  function cloudEnqueueState(request) {
    const roleId = String(request.roleId ?? "");
    const key = String(request.key ?? "");
    const operation = request.operation;
    if (!roleId || !key) throw cloudError("schema-error", "roleId and key are required");
    if (key.startsWith("builda.")) {
      throw cloudError("schema-error", "platform cloud keys cannot be written by Guest");
    }
    const localSequence = nextSequence++;
    const mutationId = `mut-${nextMutation++}`;
    const schemaId = String(request.schemaId ?? "");
    const schemaVersion = Number(request.schemaVersion ?? 0);
    const orderHandle = openOrderHandle;
    pending.push({
      mutationId,
      roleId,
      key,
      orderHandle,
      apply() {
        const map = roleMap(roleId);
        if (operation === "set" && !request.value) throw cloudError("schema-error", "set requires a value");
        if (operation === "increment" && map.get(key) && map.get(key).value?.tag !== "int64-value") {
          throw cloudError("schema-error", "increment requires int64");
        }
        if (!["set", "increment", "delete"].includes(operation)) {
          throw cloudError("schema-error", `unsupported operation: ${operation}`);
        }
        const revision = (targetRevisions.get(JSON.stringify([roleId, key])) ?? map.get(key)?.revision ?? 0n) + 1n;
        targetRevisions.set(JSON.stringify([roleId, key]), revision);
        if (operation === "delete") {
          map.delete(key);
          return;
        }
        if (operation === "set") {
          map.set(key, {
            value: request.value,
            revision,
            schemaId,
            schemaVersion,
          });
          return;
        }
        if (operation === "increment") {
          const delta = request.delta ?? 0n;
          const current = map.get(key);
          const base = current?.value?.tag === "int64-value" ? current.value.val : 0n;
          map.set(key, {
            value: { tag: "int64-value", val: base + BigInt(delta) },
            revision,
            schemaId: current?.schemaId ?? schemaId,
            schemaVersion: current?.schemaVersion ?? schemaVersion,
          });
        }
      },
    });
    if (orderHandle === null) scheduleWriteBack(0);
    return {
      localSequence,
      mutationId,
      disposition: "buffered",
    };
  }

  function scheduleWriteBack(delayMs) {
    if (writeBackTimer) return;
    writeBackTimer = setTimeout(() => {
      writeBackTimer = null;
      writeBack();
    }, delayMs);
  }

  function recordOutcome(item) {
    outcomes.set(item.mutationId, item);
    while (outcomes.size > MAX_OUTCOMES) outcomes.delete(outcomes.keys().next().value);
  }

  /** Apply every queued ordinary write. A write the Host rejects is dropped alone; a failed save is retried. */
  function writeBack() {
    const batch = pending.filter((item) => item.orderHandle === null);
    if (batch.length === 0) return true;
    const results = [];
    try {
      transaction(() => {
        pending = pending.filter((item) => item.orderHandle !== null);
        for (const item of batch) {
          try {
            item.apply();
            results.push({ mutationId: item.mutationId, status: "applied", appliedGameVarsRevision: 0n, appliedValueRevision: 0n });
          } catch (error) {
            results.push({ mutationId: item.mutationId, status: "rejected", reason: error?.code ?? "rejected" });
          }
        }
      });
    } catch {
      scheduleWriteBack(1_000);
      return false;
    }
    for (const result of results) recordOutcome(result);
    return true;
  }

  /** Decode bit-pattern values exactly like the Worker Host before reusing the ordinary enqueue path. */
  function fromBitsValue(value) {
    if (value?.tag === "int64-bits") {
      return { tag: "int64-value", val: BigInt.asIntN(64, BigInt(value.val)) };
    }
    if (value?.tag === "float64-bits") {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, BigInt.asUintN(64, BigInt(value.val)));
      return { tag: "float64-value", val: view.getFloat64(0) };
    }
    return value;
  }

  function cloudEnqueueStateBits(request) {
    const { deltaBits, ...rest } = request;
    return cloudEnqueueState({
      ...rest,
      value: fromBitsValue(request.value),
      delta: deltaBits === undefined ? undefined : BigInt.asIntN(64, BigInt(deltaBits)),
    });
  }

  function applyPending() {
    const batch = pending;
    pending = [];
    for (const item of batch) item.apply();
    return batch.map((item) => ({ mutationId: item.mutationId, status: "applied", appliedGameVarsRevision: 0n, appliedValueRevision: 0n }));
  }

  function cloudReadCurrent(roleId, key) {
    const record = store.get(String(roleId))?.get(String(key));
    if (!record) return { tag: "not-found" };
    return { tag: "found", val: snapshotEntry(String(key), record) };
  }

  function cloudReadManyCurrent(roleId, keys) {
    return (keys ?? []).map((key) => cloudReadCurrent(roleId, key));
  }

  function cloudFlushBarrier(_deadlineMs) {
    const id = nextHandle++;
    // Covers the ordinary writes queued so far; the result is reported on the next poll.
    flushHandles.set(id, {
      status: "waiting",
      mutationIds: pending.filter((item) => item.orderHandle === null).map((item) => item.mutationId),
      maxLocalSequence: nextSequence - 1n,
    });
    return { id };
  }

  function cloudPollFlush(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = flushHandles.get(id);
    if (!record) return { tag: "failed", val: { reason: "unknown-handle", items: [] } };
    if (record.status === "waiting") {
      if (record.mutationIds.some((mutationId) => !outcomes.has(mutationId)) && !writeBack()) {
        return { tag: "pending" };
      }
      const items = record.mutationIds.map((mutationId) =>
        outcomes.get(mutationId) ?? { mutationId, status: "expired" });
      const rejected = items.find((item) => item.status !== "applied");
      const final = rejected
        ? { status: "failed", reason: rejected.reason ?? rejected.status, items: items.map(({ reason, ...item }) => item) }
        : { status: "applied", maxLocalSequence: items.length > 0 ? record.maxLocalSequence : 0n, items };
      flushHandles.set(id, final);
    }
    const done = flushHandles.get(id);
    if (done.status === "applied") {
      return {
        tag: "applied",
        val: { maxLocalSequence: done.maxLocalSequence, items: done.items },
      };
    }
    if (done.status === "failed") {
      return { tag: "failed", val: { reason: done.reason ?? "failed", items: done.items ?? [] } };
    }
    return { tag: "pending" };
  }

  function cloudGetSnapshot(roleId) {
    const id = nextHandle++;
    snapshotHandles.set(id, { status: "ready", roleId: String(roleId) });
    return { id };
  }

  function cloudPollSnapshot(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = snapshotHandles.get(id);
    if (!record) return { tag: "failed", val: { tag: "failed", val: "unknown-handle" } };
    if (record.status === "pending") return { tag: "pending" };
    const map = store.get(record.roleId) ?? new Map();
    const entries = [...map.entries()].map(([key, value]) => snapshotEntry(key, value));
    return {
      tag: "ready",
      val: { gameVarsRevision: nextSequence - 1n, entries },
    };
  }

  /** Standalone use (tests, no Room directory): the active user is both the caller and the only member. */
  const standaloneScope = {
    caller: () => activeUserId,
    members: () => (activeUserId ? [activeUserId] : []),
  };

  /**
   * Like online, an order is delivered in a Room only to its owner while that player belongs to the Room. A first-seen
   * order belongs to the client whose callback calls doOrder; outside client callbacks (onTick, async work) it can be
   * attributed only when the Room holds exactly one player.
   */
  function doOrderStart(orderId, _deadlineMs, scope = standaloneScope) {
    const id = nextHandle++;
    const key = String(orderId);
    const caller = scope.caller();
    const members = scope.members();
    const owner = caller || (members.length === 1 ? members[0] : "");
    const resolved = resolveOrder(key, owner);
    if (!resolved) {
      scope.warn?.(key);
      orderHandles.set(id, { orderId: key, phase: "rejected" });
      return { id };
    }
    if (resolved.userId !== caller && !members.includes(resolved.userId)) {
      orderHandles.set(id, { orderId: key, phase: "rejected" });
      return { id };
    }
    orderHandles.set(id, {
      orderId: key,
      userId: resolved.userId,
      payId: resolved.payId,
      phase: resolved.completed ? "completed" : "allowed",
    });
    return { id };
  }

  function doOrderPoll(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = orderHandles.get(id);
    if (!record) return { tag: "unavailable" };
    if (record.phase === "pending") return { tag: "pending" };
    if (record.phase === "rejected") return { tag: "rejected" };
    if (record.phase === "completed") return { tag: "completed" };
    if (record.phase === "allowed") {
      openOrderHandle = id;
      // The allowed callback and doOrderFinish run synchronously right after this poll.
      queueMicrotask(() => { if (openOrderHandle === id) openOrderHandle = null; });
      return {
        tag: "allowed",
        val: { orderId: record.orderId, payId: record.payId },
      };
    }
    if (record.phase === "finished") return { tag: "completed" };
    return { tag: "unavailable" };
  }

  function doOrderFinish(handle, _deadlineMs) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = orderHandles.get(id);
    if (!record || record.phase !== "allowed") {
      throw cloudError("not-ready", "order finish requires an allowed delivery window");
    }
    if (openOrderHandle === id) openOrderHandle = null;
    // Payment path: apply fulfill writes and complete the order in one save, without an explicit cloudFlush.
    transaction(() => {
      for (const result of applyPending()) recordOutcome(result);
      const order = orders.get(record.orderId);
      if (order) order.completed = true;
    });
    record.phase = "finished";
  }

  /** @param {{ caller: () => string, members: () => string[], warn?: (orderId: string) => void }} [scope] the Room these bindings serve */
  function hostBindings(scope) {
    return {
      cloudEnqueueState,
      cloudEnqueueStateBits,
      cloudReadCurrent,
      cloudReadManyCurrent,
      cloudFlushBarrier,
      cloudPollFlush,
      cloudGetSnapshot,
      cloudPollSnapshot,
      doOrderStart: (orderId, deadlineMs) => doOrderStart(orderId, deadlineMs, scope),
      doOrderPoll,
      doOrderFinish,
    };
  }

  return {
    snapshot() { return { store, targetRevisions, orders }; },
    playerDataAuthority: {
      isDirty(role) { return pending.some((p) => p.roleId === role); },
      read(role, key) {
        const record = store.get(role)?.get(key);
        let value = record?.value;
        if (value?.tag === "int64-value") value = { tag: "int64-bits", val: BigInt.asUintN(64, value.val) };
        if (value?.tag === "float64-value") { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, value.val); value = { tag: "float64-bits", val: b.getBigUint64(0) }; }
        return { value, valueRevision: targetRevisions.get(JSON.stringify([role, key])) ?? record?.revision ?? 0n, schemaId: record?.schemaId ?? "", schemaVersion: record?.schemaVersion ?? 0 };
      },
      write(role, key, next) {
        transaction(() => {
          targetRevisions.set(JSON.stringify([role, key]), next.valueRevision);
          if (next.value === undefined) roleMap(role).delete(key);
          else roleMap(role).set(key, { value: fromBitsValue(next.value), revision: next.valueRevision, schemaId: next.schemaId, schemaVersion: next.schemaVersion });
        });
      },
    },
    setActiveUserId,
    registerOrder,
    /** Apply queued ordinary writes now (shutdown); returns false when the save failed. */
    drainWrites() {
      if (writeBackTimer) { clearTimeout(writeBackTimer); writeBackTimer = null; }
      return writeBack();
    },
    hostBindings,
    /** Test helper: read applied cloud value. */
    debugRead(roleId, key) {
      return cloudReadCurrent(roleId, key);
    },
    /** Test helper: whether an order is completed. */
    debugOrderCompleted(orderId) {
      return orders.get(String(orderId))?.completed === true;
    },
  };
}
