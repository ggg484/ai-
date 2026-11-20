import { randomBytes } from "node:crypto";
const textDecoder = new TextDecoder();
// Build-time suspension switch. Keep false in shipped source; Scenario cannot enable queues.
const GAME_DATA_MESSAGE_QUEUE_ENABLED = false;
const GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON = "game_data_message_queue_disabled";

const LIMITS = {
  nsMaxBytes: 128n,
  keyMaxBytes: 512n,
  memberMaxBytes: 2048n,
  objectJsonMaxBytes: 262144n,
  objectMaxDepth: 32n,
  batchReadMax: 20n,
  batchResponseMaxBytes: 1048576n,
  pageDefault: 50n,
  pageMax: 100n,
  queueMessageJsonMaxBytes: 16384n,
  receiveMax: 20n,
  messageTtlDefaultMs: 3600000n,
  messageTtlMaxMs: 604800000n,
  visibilityDefaultMs: 30000n,
  visibilityMaxMs: 300000n,
  waitTimeoutMaxMs: 10000n,
  cursorTtlMs: 900000n,
  idempotencyWindowMs: 900000n,
  transportMaxBytes: 2097152n,
};

/** Local Game Data store. It is not production storage, durability, or recovery. */
export function createGameDataStore(now, managedConfiguration = {}, capabilities = { limits: { dedupe_window_ms: 900000n, max_dedupe_entries: 64 } }, persistence = {}) {
  // Mock-only capabilities fixture; never infer first-send authority from an ID.
  const receipts = new Map();
  const recoveries = new Map();
  let dropNextResponse = false;
  let nextWriteFailure;
  let persistentWriteFailure;
  const objects = new Map();
  const counters = new Map();
  const scores = new Map();
  const queues = new Map();
  const manualQueueNamespaces = new Set();
  const idempotency = new Map();
  const operations = new Map();
  for (const [target, name] of [[objects, "objects"], [counters, "counters"], [scores, "scores"], [receipts, "receipts"]]) {
    if (persistence.initial?.[name] instanceof Map) for (const [key, value] of persistence.initial[name]) target.set(key, value);
  }
  const asyncCompletions = [];
  const pendingUpdateIds = new Set();
  let pendingUpdateIterator = pendingUpdateIds.values();
  let asyncRescan = false;
  if (managedConfiguration?.enabled !== undefined && typeof managedConfiguration.enabled !== "boolean") throw new Error("Mock managed queue enabled must be boolean");
  if (managedConfiguration?.namespaces !== undefined && !Array.isArray(managedConfiguration.namespaces)) throw new Error("Mock managed queue namespaces must be an array");
  if (managedConfiguration?.messages !== undefined && !Array.isArray(managedConfiguration.messages)) throw new Error("Mock managed queue messages must be an array");
  if (managedConfiguration && Object.keys(managedConfiguration).some((key) => !["enabled", "namespaces", "messages", "ensureDefinition"].includes(key))) throw new Error("Mock managed queue configuration contains an unknown field");
  const managedEnabled = managedConfiguration?.enabled === true;
  const configuredManagedNamespaces = Array.isArray(managedConfiguration?.namespaces) ? managedConfiguration.namespaces : [];
  const managedNamespaces = new Set(managedEnabled ? configuredManagedNamespaces : []);
  const managedDefinitions = new Map();
  const managedCandidates = new Map();
  const managedPendingEnsures = new Map();
  const managedEnsureRejected = new Set();
  const managedPending = new Map();
  const ensureDefinition = typeof managedConfiguration?.ensureDefinition === "function" ? managedConfiguration.ensureDefinition : undefined;
  let managedRegistrations = [];
  let nextManagedHandle = 1n;
  let asyncGeneration = 1n;
  let nextId = 1n;

  const ASYNC_SOURCE_GAME_DATA = 1;

  for (const namespace of configuredManagedNamespaces) {
    const bytes = typeof namespace === "string" ? new TextEncoder().encode(namespace).length : 0;
    if (bytes < 1 || bytes > 128 || namespace.includes("\0")) throw new Error("Mock managed queue namespaces must be 1..128 UTF-8 bytes without NUL");
  }
  if (new Set(configuredManagedNamespaces).size !== configuredManagedNamespaces.length) throw new Error("Mock managed queue namespaces must be unique");

  for (const item of Array.isArray(managedConfiguration?.messages) ? managedConfiguration.messages : []) {
    if (!item || typeof item.namespace !== "string") throw new Error("Mock managed queue message namespace is required");
    const allowedFields = new Set(["namespace", "message_id", "payload", "payload_json_base64", "visible_until_millis"]);
    if (Object.keys(item).some((key) => !allowedFields.has(key))) throw new Error("Mock managed queue message contains an unknown field");
    if (!configuredManagedNamespaces.includes(item.namespace)) throw new Error("Mock managed queue message namespace must be listed in namespaces");
    if (typeof item.message_id !== "string" || item.message_id.length === 0) throw new Error("Mock managed queue message_id is required");
    const messageIdBytes = new TextEncoder().encode(item.message_id).length;
    if (messageIdBytes > 128 || item.message_id.includes("\0")) throw new Error("Mock managed queue message_id must be at most 128 UTF-8 bytes without NUL");
    const hasEncodedPayload = typeof item.payload_json_base64 === "string";
    const hasPayload = Object.hasOwn(item, "payload");
    if (hasEncodedPayload === hasPayload) throw new Error("Mock managed queue message requires exactly one of payload or payload_json_base64");
    if (item.payload_json_base64 !== undefined && (!hasEncodedPayload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.payload_json_base64))) throw new Error("Mock managed queue payload_json_base64 must be valid Base64");
    if (item.visible_until_millis !== undefined && (!Number.isSafeInteger(item.visible_until_millis) || item.visible_until_millis < 0)) throw new Error("Mock managed queue visible_until_millis must be a non-negative safe integer");
    const payloadJson = hasEncodedPayload
      ? new Uint8Array(Buffer.from(item.payload_json_base64, "base64"))
      : new TextEncoder().encode(JSON.stringify(item.payload));
    const queue = queues.get(item.namespace) ?? [];
    queue.push({ messageId: item.message_id, payloadJson, receipt: "", visibleUntil: 0n,
      expiresAt: 9223372036854775807n, managedVisibleUntil: BigInt(item.visible_until_millis ?? 0), managedClaimToken: 0n });
    queues.set(item.namespace, queue);
    if (!managedEnabled) manualQueueNamespaces.add(item.namespace);
  }

  function notifyAsync(id) {
    if (asyncCompletions.some((entry) => entry.operationId === id)) return;
    if (asyncCompletions.length >= 64) {
      asyncRescan = true;
      return;
    }
    asyncCompletions.push({ source: ASYNC_SOURCE_GAME_DATA, operationId: id });
  }

  function expireUpdate(id, operation) {
    if (operation.terminal) return;
    operation.terminal = fail("object-write", "timeout", "deadline_exceeded");
    pendingUpdateIds.delete(id);
    notifyAsync(id);
  }

  /** Bounded local deadline work at the shared async ingress; no per-operation timers. */
  function scanPendingUpdateDeadlines() {
    const budget = Math.min(16, pendingUpdateIds.size);
    let scanned = 0;
    while (scanned < budget) {
      let next = pendingUpdateIterator.next();
      if (next.done) {
        pendingUpdateIterator = pendingUpdateIds.values();
        next = pendingUpdateIterator.next();
        if (next.done) break;
      }
      const id = next.value;
      scanned += 1;
      const operation = operations.get(id);
      if (!operation || operation.tag !== "needs-transform" || operation.terminal) {
        pendingUpdateIds.delete(id);
      } else if (operation.deadlineAt <= BigInt(now())) {
        expireUpdate(id, operation);
      }
    }
  }

  function allocateId() {
    const id = nextId;
    nextId += 1n;
    return id;
  }

  function mutationId() {
    const random = randomBytes(16).toString("hex");
    return `m1.${now()}.${random}`;
  }

  function fail(kind, code, reason, extra = {}) {
    return { tag: "failed", error: { code, requestId: `local-${nextId}`, resultKind: kind, reason, ...extra } };
  }

  function bucket(map, ns) {
    if (!map.has(ns)) map.set(ns, new Map());
    return map.get(ns);
  }

  function writeKind(request) {
    if (/^objects-(create|set|compare-exchange)$/.test(request.tag)) return "object-write";
    if (request.tag === "objects-remove") return "object-remove";
    if (/^counters-(add|compare-exchange)$/.test(request.tag)) return "counter-write";
    if (request.tag === "counters-remove") return "counter-remove";
    if (request.tag === "sorted-set-score") return "sorted-write";
    if (request.tag === "sorted-remove") return "sorted-remove";
  }

  function windowMs() {
    try {
      const value = BigInt(capabilities?.limits?.dedupe_window_ms ?? 0);
      const count = capabilities?.limits?.max_dedupe_entries;
      return value >= 60000n && value <= 86400000n && Number.isInteger(count) && count > 0 && count <= 256 ? value : null;
    } catch { return null; }
  }

  function unknown(request, kind, recoveryId, recoveryError) {
    return fail(kind, "outcome-unknown", undefined, {
      mutationId: request.mutationId, recoveryId,
      recoveryError: recoveryError && { code: recoveryError.code, reason: recoveryError.reason },
    });
  }

  function apply(request, replay = false) {
    const kind = writeKind(request);
    if (!kind) return applyRaw(request);
    const window = windowMs();
    if (window === null) return fail(kind, "unavailable", "capabilities_unavailable");
    if (nextWriteFailure || persistentWriteFailure) {
      const error = nextWriteFailure ?? persistentWriteFailure;
      nextWriteFailure = undefined;
      return fail(kind, error.code, error.reason, { retryAfterMs: error.retryAfterMs, mutationId: request.mutationId });
    }
    const first = request.mutationId === undefined && !replay;
    request = structuredClone({ ...request, mutationId: request.mutationId ?? mutationId() });
    const match = /^m1\.(0|[1-9][0-9]*)\.[0-9a-f]{32}$/.exec(request.mutationId);
    if (!match) return fail(kind, "invalid-argument", "mutation_id");
    const issued = BigInt(match[1]);
    const current = BigInt(now());
    const error = (code) => fail(kind, code, undefined, { mutationId: request.mutationId });
    if (issued > current + 30000n) return fail(kind, "invalid-argument", "mutation_from_future", { mutationId: request.mutationId });
    if (issued <= current - window) return error("idempotency-expired");
    const resource = JSON.stringify([request.tag.split("-")[0], request.ns, request.tag.startsWith("sorted-") ? null : request.key]);
    const before = persistence.save ? structuredClone({ objects, counters, scores, receipts }) : undefined;
    const state = receipts.get(resource) ?? { entries: new Map(), watermark: -1n };
    receipts.set(resource, state);
    const normalized = { ...request, mutationId: undefined };
    if (request.tag === "counters-add") {
      normalized.min = request.min ?? "-9223372036854775808";
      normalized.max = request.max ?? "9223372036854775807";
    }
    const payload = JSON.stringify(normalized, Object.keys(normalized).sort());
    // Include byte arrays separately: the JSON property whitelist is only top-level.
    const fingerprint = payload + (request.valueJson ? Array.from(request.valueJson).join(",") : "");
    const prior = state.entries.get(request.mutationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return error("idempotency-mismatch");
      const result = structuredClone(prior.result);
      if (result.tag === "completed") result.value.replayed = true;
      return result;
    }
    if (!first && issued <= state.watermark) return error("idempotency-expired");
    const result = applyRaw(request);
    if (result.tag === "failed") result.error.mutationId = request.mutationId;
    state.entries.set(request.mutationId, { issued, fingerprint, result: structuredClone(result) });
    while (state.entries.size > capabilities.limits.max_dedupe_entries) {
      const oldest = state.entries.keys().next().value;
      const evicted = state.entries.get(oldest);
      state.watermark = evicted.issued > state.watermark ? evicted.issued : state.watermark;
      state.entries.delete(oldest);
    }
    try { persistence.save?.(); } catch (error) {
      for (const [target, name] of [[objects, "objects"], [counters, "counters"], [scores, "scores"], [receipts, "receipts"]]) {
        target.clear();
        for (const [key, value] of before[name]) target.set(key, value);
      }
      throw error;
    }
    if (dropNextResponse && !replay) {
      dropNextResponse = false;
      for (const [key, saved] of recoveries) if (current >= saved.expires) recoveries.delete(key);
      if (recoveries.size >= 64) return unknown(request, kind);
      const recoveryId = allocateId();
      const expires = current + 600000n < issued + window ? current + 600000n : issued + window;
      recoveries.set(recoveryId, { request, kind, expires });
      return unknown(request, kind, recoveryId);
    }
    return result;
  }

  function applyRaw(request) {
    if (!GAME_DATA_MESSAGE_QUEUE_ENABLED && ["queue-enqueue", "queue-receive", "queue-ack"].includes(request?.tag)) {
      return fail(request.tag, "unsupported-capability", GAME_DATA_MESSAGE_QUEUE_DISABLED_REASON,
        typeof request.mutationId === "string" ? { mutationId: request.mutationId } : {});
    }
    switch (request.tag) {
      case "capabilities":
        return { tag: "completed", value: { tag: "capabilities", apiMajor: 1, capabilityIds: GAME_DATA_MESSAGE_QUEUE_ENABLED ? ["objects_v1", "sorted_index_v1", "queue_v1", "counters_v1"] : ["objects_v1", "sorted_index_v1", "counters_v1"], limits: { ...LIMITS, idempotencyWindowMs: windowMs() ?? 0n } } };
      // The local store has no read cache; both fresh values read current state.
      case "objects-get":
        return readObject(request.ns, request.key);
      case "objects-get-many":
        return { tag: "completed", value: { tag: "object-batch", items: request.keys.map((key) => ({ tag: "ok", key, found: objectFound(request.ns, key) })) } };
      case "objects-create":
      case "objects-set":
      case "objects-compare-exchange":
        return writeObject(request);
      case "objects-remove":
        return removeObject(request);
      case "objects-list-keys":
        return listKeys(request);
      case "objects-update":
        return { tag: "needs-transform", readGeneration: 1n, read: objectFound(request.ns, request.key), attempts: request.maxAttempts, request };
      case "counters-get":
        return readCounter(request.ns, request.key);
      case "counters-add":
      case "counters-compare-exchange":
        return writeCounter(request);
      case "counters-remove":
        return removeCounter(request);
      case "sorted-set-score":
      case "sorted-get-score":
      case "sorted-remove":
      case "sorted-range":
      case "sorted-rank":
      case "sorted-count":
        return sorted(request);
      case "queue-enqueue":
      case "queue-receive":
      case "queue-ack":
        return queueOp(request);
      default:
        return fail("capabilities", "invalid-argument", "method");
    }
  }

  function objectFound(ns, key) {
    const record = bucket(objects, ns).get(key);
    if (!record || record.removed) return { found: false, stateToken: record?.stateToken ?? `missing:${ns}:${key}` };
    return { found: true, valueJson: record.valueJson, revision: record.revision, stateToken: record.stateToken };
  }

  function readObject(ns, key) {
    return { tag: "completed", value: { tag: "object-read", found: objectFound(ns, key) } };
  }

  function writeObject(request) {
    const id = request.mutationId ?? mutationId();
    const map = bucket(objects, request.ns);
    const current = map.get(request.key);
    if (request.tag === "objects-create" && current && !current.removed) {
      return fail("object-write", "conflict", "already_exists", { mutationId: id });
    }
    if (request.tag === "objects-compare-exchange" && (current?.stateToken ?? `missing:${request.ns}:${request.key}`) !== request.stateToken) {
      return fail("object-write", "conflict", undefined, { mutationId: id });
    }
    const revision = `r${id}`;
    const result = { revision, changed: true, replayed: false };
    map.set(request.key, { valueJson: request.valueJson, revision, stateToken: revision, removed: false });
    return { tag: "completed", value: { tag: "object-write", ...result } };
  }

  function removeObject(request) {
    const map = bucket(objects, request.ns);
    const current = map.get(request.key);
    const token = current?.stateToken ?? `missing:${request.ns}:${request.key}`;
    if (request.expectedRevision && request.expectedRevision !== current?.revision) return fail("object-remove", "conflict");
    const removed = Boolean(current && !current.removed);
    const revision = current?.revision ?? token;
    if (removed) map.set(request.key, { ...current, removed: true, stateToken: `${token}:tombstone` });
    return { tag: "completed", value: { tag: "object-remove", revision, changed: removed, replayed: false, removed } };
  }

  function listKeys(request) {
    const keys = [...bucket(objects, request.ns).entries()]
      .filter(([, record]) => !record.removed && (!request.prefix || record && true))
      .map(([key]) => key)
      .filter((key) => !request.prefix || key.startsWith(request.prefix))
      .sort();
    return { tag: "completed", value: { tag: "object-list-keys", keys, nextCursor: null } };
  }

  function readCounter(ns, key) {
    const record = bucket(counters, ns).get(key);
    if (!record || record.removed) {
      return { tag: "completed", value: { tag: "counter-read", found: false, stateToken: record?.stateToken ?? `missing:${ns}:${key}` } };
    }
    return { tag: "completed", value: { tag: "counter-read", found: true, value: record.value, revision: record.revision, stateToken: record.stateToken } };
  }

  function writeCounter(request) {
    const min = request.min === undefined ? -9223372036854775808n : BigInt(request.min);
    const max = request.max === undefined ? 9223372036854775807n : BigInt(request.max);
    const map = bucket(counters, request.ns);
    const current = map.get(request.key);
    const currentValue = current && !current.removed ? BigInt(current.value) : 0n;
    let next = currentValue;
    if (request.tag === "counters-add") next = currentValue + BigInt(request.delta);
    if (request.tag === "counters-compare-exchange") {
      const token = current?.stateToken ?? `missing:${request.ns}:${request.key}`;
      if (token !== request.stateToken) return fail("counter-write", "conflict");
      next = BigInt(request.value);
    }
    if (next < -9223372036854775808n || next > 9223372036854775807n) return fail("counter-write", "invalid-argument", "integer_overflow");
    if (next < min || next > max) return fail("counter-write", "invalid-argument", "value_out_of_range");
    const revision = `c${mutationId()}`;
    map.set(request.key, { value: next.toString(), revision, stateToken: revision, removed: false });
    const result = { tag: "counter-write", revision, changed: true, replayed: false, value: next.toString() };
    return { tag: "completed", value: result };
  }

  function removeCounter(request) {
    const map = bucket(counters, request.ns);
    const current = map.get(request.key);
    if (request.expectedRevision && request.expectedRevision !== current?.revision) return fail("counter-remove", "conflict");
    const removed = Boolean(current && !current.removed);
    const revision = current?.revision ?? `missing:${request.ns}:${request.key}`;
    if (removed) map.set(request.key, { ...current, removed: true });
    return { tag: "completed", value: { tag: "counter-remove", revision, changed: removed, replayed: false, removed } };
  }

  function sorted(request) {
    const map = bucket(scores, request.ns);
    if (request.tag === "sorted-set-score") {
      const changed = map.get(request.memberId) !== request.score;
      map.set(request.memberId, request.score);
      return { tag: "completed", value: { tag: "sorted-write", changed, replayed: false } };
    }
    if (request.tag === "sorted-get-score") {
      const score = map.get(request.memberId);
      return { tag: "completed", value: score === undefined ? { tag: "sorted-score", found: false } : { tag: "sorted-score", found: true, score } };
    }
    if (request.tag === "sorted-remove") {
      const removed = map.delete(request.memberId);
      return { tag: "completed", value: { tag: "sorted-remove", removed, replayed: false } };
    }
    if (request.tag === "sorted-count") return { tag: "completed", value: { tag: "sorted-count", count: BigInt(map.size) } };
    const entries = [...map.entries()].sort((left, right) => compareScore(left[1], left[0], right[1], right[0], request.order === "descending"));
    if (request.tag === "sorted-rank") {
      const index = entries.findIndex(([member]) => member === request.memberId);
      return { tag: "completed", value: index < 0 ? { tag: "sorted-rank", found: false } : { tag: "sorted-rank", found: true, rank: BigInt(index + 1) } };
    }
    const filtered = entries.filter(([, score]) => inRange(score, request.minScore, request.maxScore));
    return { tag: "completed", value: { tag: "sorted-page", items: filtered.map(([memberId, score]) => ({ memberId, score })), nextCursor: null } };
  }

  function queueOp(request) {
    const queue = queues.get(request.ns) ?? [];
    if ((request.tag === "queue-receive" || request.tag === "queue-ack") &&
        (managedDefinitions.has(request.ns) || (managedNamespaces.has(request.ns) && !manualQueueNamespaces.has(request.ns)))) {
      return fail(request.tag === "queue-receive" ? "queue-receive" : "queue-ack", "conflict", "managed_queue_required",
        request.mutationId ? { mutationId: request.mutationId } : {});
    }
    const existingManualQueue = manualQueueNamespaces.has(request.ns) && !managedDefinitions.has(request.ns);
    if (request.tag === "queue-enqueue" && managedNamespaces.has(request.ns) && !managedDefinitions.has(request.ns) && !existingManualQueue) {
      return fail("queue-enqueue", "conflict", "managed_queue_not_initialized",
        request.mutationId ? { mutationId: request.mutationId } : {});
    }
    queues.set(request.ns, queue);
    if (request.tag === "queue-enqueue") {
      const payloadFingerprint = `${Array.from(request.payloadJson).join(",")}|ttl:${request.messageTtlMs ?? LIMITS.messageTtlDefaultMs}`;
      const idemKey = request.mutationId ? `queue:queue-enqueue:${request.ns}:${request.mutationId}` : undefined;
      const prior = idemKey ? idempotency.get(idemKey) : undefined;
      if (prior) {
        if (prior.payload !== payloadFingerprint) return fail("queue-enqueue", "idempotency-mismatch");
        return { tag: "completed", value: { ...prior.result, replayed: true } };
      }
      const message = { messageId: mutationId(), payloadJson: request.payloadJson, receipt: "", visibleUntil: 0n, expiresAt: BigInt(now()) + (request.messageTtlMs ?? LIMITS.messageTtlDefaultMs), managedVisibleUntil: 0n, managedClaimToken: 0n };
      queue.push(message);
      if (!managedDefinitions.has(request.ns)) manualQueueNamespaces.add(request.ns);
      const result = { tag: "queue-enqueue", messageId: message.messageId, expiresAt: message.expiresAt, replayed: false };
      if (idemKey) idempotency.set(idemKey, { payload: payloadFingerprint, result });
      return { tag: "completed", value: result };
    }
    if (request.tag === "queue-ack") {
      manualQueueNamespaces.add(request.ns);
      const index = queue.findIndex((message) => message.receipt === request.receipt);
      if (index < 0) return fail("queue-ack", "stale-receipt");
      queue.splice(index, 1);
      return { tag: "completed", value: { tag: "queue-ack", replayed: false } };
    }
    manualQueueNamespaces.add(request.ns);
    const limit = request.limit ?? 1;
    const visibleUntil = BigInt(now()) + (request.visibilityTimeoutMs ?? LIMITS.visibilityDefaultMs);
    const messages = queue.filter((message) => !message.receipt).slice(0, limit).map((message) => {
      message.receipt = `receipt-${message.messageId}`;
      message.visibleUntil = visibleUntil;
      return message;
    });
    return { tag: "completed", value: { tag: "queue-receive", messages, replayed: false } };
  }

  function propose(id, generation, proposal) {
    const operation = operations.get(id);
    if (!operation || operation.tag !== "needs-transform") return { ok: false, error: "not-update" };
    if (operation.terminal) {
      if (generation !== operation.readGeneration) return { ok: false, error: "stale-generation" };
      if (operation.proposed === generation) return { ok: false, error: "duplicate-generation" };
      return operation.terminal.tag === "failed" && operation.terminal.error.code === "timeout"
        ? { ok: true }
        : { ok: false, error: "not-update" };
    }
    if (!operation.terminal && operation.deadlineAt <= BigInt(now())) {
      expireUpdate(id, operation);
      // The proposal did not commit. Return through the normal poll result so
      // the Guest observes the established `timeout` failure variant.
      return { ok: true };
    }
    if (generation !== operation.readGeneration) return { ok: false, error: "stale-generation" };
    if (operation.proposed === generation) return { ok: false, error: "duplicate-generation" };
    operation.proposed = generation;
    if (proposal.tag === "callback-abort") {
      operation.terminal = fail("object-write", "callback-failed");
      pendingUpdateIds.delete(id);
      notifyAsync(id);
      return { ok: true };
    }
    const token = operation.read.found ? operation.read.stateToken : operation.read.stateToken;
    const write = apply({
      tag: "objects-compare-exchange",
      ns: operation.request.ns,
      key: operation.request.key,
      stateToken: token,
      valueJson: proposal.valueJson,
    });
    if (write.tag === "failed" && write.error.code === "conflict" && generation < BigInt(operation.attempts)) {
      operation.readGeneration = generation + 1n;
      operation.read = objectFound(operation.request.ns, operation.request.key);
      operation.proposed = undefined;
      if (operation.deadlineAt <= BigInt(now())) expireUpdate(id, operation);
      else notifyAsync(id);
      return { ok: true };
    }
    operation.terminal = write;
    pendingUpdateIds.delete(id);
    notifyAsync(id);
    return { ok: true };
  }

  return {
    snapshot() { return { objects, counters, scores, receipts }; },
    reset() {
      objects.clear();
      counters.clear();
      scores.clear();
      queues.clear();
      manualQueueNamespaces.clear();
      idempotency.clear();
      receipts.clear();
      recoveries.clear();
      dropNextResponse = false;
      nextWriteFailure = undefined;
      persistentWriteFailure = undefined;
      operations.clear();
      pendingUpdateIds.clear();
      pendingUpdateIterator = pendingUpdateIds.values();
      asyncCompletions.length = 0;
      asyncRescan = false;
      asyncGeneration = 1n;
      managedDefinitions.clear();
      managedCandidates.clear();
      managedPendingEnsures.clear();
      managedEnsureRejected.clear();
      managedPending.clear();
      managedRegistrations = [];
    },
    gameDataStart(request, timeoutMs = 30_000) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return { ok: false, error: "invalid-deadline" };
      const id = allocateId();
      const outcome = apply(request);
      const operation = outcome.tag === "needs-transform"
        ? { ...outcome, id, deadlineAt: BigInt(now()) + BigInt(timeoutMs) }
        : { terminal: outcome };
      operations.set(id, operation);
      if (outcome.tag === "needs-transform") pendingUpdateIds.add(id);
      notifyAsync(id);
      return { ok: true, id };
    },
    gameDataPoll(handle) {
      const operation = operations.get(handle.id);
      if (!operation) return { tag: "expired" };
      if (operation.tag === "needs-transform" && !operation.terminal && operation.deadlineAt <= BigInt(now())) {
        expireUpdate(handle.id, operation);
      }
      if (operation.terminal) return operation.terminal;
      return { tag: "needs-transform", readGeneration: operation.readGeneration, read: operation.read };
    },
    asyncRuntimePoll(limit) {
      const capped = Math.min(Math.max(0, limit), 16);
      if (limit === 0) {
        return { generation: asyncGeneration, rescan: false, events: [] };
      }
      scanPendingUpdateDeadlines();
      const events = asyncCompletions.splice(0, capped);
      const rescan = asyncRescan;
      asyncRescan = false;
      return { generation: asyncGeneration, rescan, events };
    },
    gameDataRelease(handle) {
      operations.delete(handle.id);
      pendingUpdateIds.delete(handle.id);
    },
    // Local fixture only: lose one write response after recording its decision.
    dropNextWriteResponse() { dropNextResponse = true; },
    // Reports a pre-commit failure; this store does not simulate network backoff.
    failNextWrite(code, reason, retryAfterMs) {
      if (!["rate-limited", "unavailable"].includes(code)) throw new Error("Unsupported Mock write failure");
      nextWriteFailure = { code, reason, retryAfterMs };
    },
    // Local fixture: each write reaches the same terminal rejection; no network delay is simulated.
    failWritesUntilCleared(reason, retryAfterMs) {
      if (!["game_write_limit", "key_write_limit", "circuit_open", "replica_busy", "quota_wait_too_long", "quota_queue_full", "quota_deadline_short", "quota_replica_memory", "quota_shutdown"].includes(reason)) throw new Error("Unsupported Mock limit reason");
      persistentWriteFailure = { code: "rate-limited", reason, retryAfterMs };
    },
    clearWriteFailure() { persistentWriteFailure = undefined; },
    gameDataResume(handle, timeoutMs = 30000) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return { ok: false, error: "invalid-deadline" };
      const saved = recoveries.get(handle.id);
      if (!saved || BigInt(now()) >= saved.expires) {
        recoveries.delete(handle.id);
        return { ok: false, error: "recovery-expired" };
      }
      const result = apply(saved.request, true);
      const terminal = result.tag === "failed" && ["idempotency-expired", "unavailable", "rate-limited"].includes(result.error.code)
        ? unknown(saved.request, saved.kind, handle.id, result.error) : result;
      const id = allocateId();
      operations.set(id, { terminal });
      notifyAsync(id);
      return { ok: true, id };
    },
    gameDataReleaseRecovery(handle) { recoveries.delete(handle.id); },
    gameDataUpdatePropose(handle, generation, proposal) {
      return propose(handle.id, generation, proposal);
    },
    advanceManagedQueueEnsures() {
      if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return;
      for (const [namespace, candidate] of managedPendingEnsures) {
        managedPendingEnsures.delete(namespace);
        if (manualQueueNamespaces.has(namespace) && !managedDefinitions.has(namespace)) {
          managedCandidates.delete(namespace);
          managedEnsureRejected.add(namespace);
          continue;
        }
        const existing = managedDefinitions.get(namespace);
        const authority = ensureDefinition?.(namespace, { ...candidate }, existing && { ...existing }) ?? existing;
        if (authority && (authority.handlerId !== candidate.handlerId || authority.compatVersion !== candidate.compatVersion)) {
          managedDefinitions.set(namespace, { ...authority });
          managedCandidates.delete(namespace);
          managedEnsureRejected.add(namespace);
          continue;
        }
        managedDefinitions.set(namespace, { handlerId: candidate.handlerId, compatVersion: candidate.compatVersion });
        managedCandidates.delete(namespace);
        managedEnsureRejected.delete(namespace);
      }
    },
    managedQueueSyncRegistrations(entries) {
      if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) {
        return Array.isArray(entries) && entries.length === 0
          ? { ok: true }
          : { ok: false, error: "capability-unavailable" };
      }
      managedNamespaces.clear();
      if (managedEnabled) for (const namespace of Array.isArray(managedConfiguration?.namespaces) ? managedConfiguration.namespaces : []) managedNamespaces.add(namespace);
      if (!managedEnabled && entries.length === 0) { managedRegistrations = []; return { ok: true }; }
      if (!managedEnabled) return { ok: false, error: "capability-unavailable" };
      if (entries.length > 32) return { ok: false, error: "too-many-registrations" };
      const seen = new Set();
      for (const entry of entries) {
        const ns = typeof entry?.namespace === "string" ? entry.namespace : "";
        const handlerId = typeof entry?.handlerId === "string" ? entry.handlerId : "";
        if (new TextEncoder().encode(ns).length < 1 || new TextEncoder().encode(ns).length > 128 || ns.includes("\0")) return { ok: false, error: "invalid-namespace" };
        if (new TextEncoder().encode(handlerId).length < 1 || new TextEncoder().encode(handlerId).length > 128 || handlerId.includes("\0")) return { ok: false, error: "invalid-handler-id" };
        if (!Number.isInteger(entry.compatVersion) || entry.compatVersion <= 0 || entry.compatVersion > 0xffff_ffff) return { ok: false, error: "invalid-compat-version" };
        if (seen.has(ns)) return { ok: false, error: "duplicate-registration" };
        seen.add(ns);
        if (!managedNamespaces.has(ns)) return { ok: false, error: "capability-unavailable" };
        const existing = managedDefinitions.get(ns) ?? managedCandidates.get(ns);
        if (existing && (existing.handlerId !== handlerId || existing.compatVersion !== entry.compatVersion)) return { ok: false, error: "definition-conflict" };
      }
      const next = entries.map((entry) => ({ ...entry }));
      for (const entry of next) {
        const definition = managedDefinitions.get(entry.namespace);
        if (!definition) {
          const candidate = { handlerId: entry.handlerId, compatVersion: entry.compatVersion };
          managedCandidates.set(entry.namespace, candidate);
          managedPendingEnsures.set(entry.namespace, candidate);
          managedEnsureRejected.delete(entry.namespace);
        } else if (definition.handlerId === entry.handlerId && definition.compatVersion === entry.compatVersion) {
          managedEnsureRejected.delete(entry.namespace);
        }
      }
      managedRegistrations = next;
      return { ok: true };
    },
    managedQueueClaim(limit) {
      if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return { messages: [] };
      const messages = [];
      const nowMillis = BigInt(now());
      for (const [id, dispatch] of managedPending) {
        if (dispatch.visibleUntil > nowMillis) continue;
        managedPending.delete(id);
        if (dispatch.message.managedClaimToken === dispatch.token) dispatch.message.managedClaimToken = 0n;
      }
      const cap = Math.min(Math.max(0, limit), 16);
      for (const { namespace } of managedRegistrations) {
        if (messages.length >= cap || managedPending.size >= 32) break;
        if (managedPendingEnsures.has(namespace) || managedEnsureRejected.has(namespace)) continue;
        const definition = managedDefinitions.get(namespace);
        const registration = managedRegistrations.find((entry) => entry.namespace === namespace);
        if (!definition || !registration || definition.handlerId !== registration.handlerId || definition.compatVersion !== registration.compatVersion) continue;
        const message = queues.get(namespace)?.[0];
        if (!message || message.managedVisibleUntil > nowMillis || message.managedClaimToken !== 0n) continue;
        const id = nextManagedHandle++;
        const token = id;
        const visibleUntil = nowMillis + 30_000n;
        message.managedClaimToken = token;
        message.managedVisibleUntil = visibleUntil;
        managedPending.set(id, { namespace, message, token, visibleUntil });
        messages.push({ handle: { id }, namespace, messageId: message.messageId,
          payloadJson: new Uint8Array(message.payloadJson), visibleUntilMillis: visibleUntil });
      }
      return { messages };
    },
    managedQueueComplete(handle, report) {
      if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return { ok: false, error: "capability-unavailable" };
      const dispatch = managedPending.get(handle.id);
      if (!dispatch) return { ok: false, error: "handle-unknown" };
      managedPending.delete(handle.id);
      if (dispatch.visibleUntil <= BigInt(now())) {
        if (dispatch.message.managedClaimToken === dispatch.token) dispatch.message.managedClaimToken = 0n;
        return { ok: false, error: "handle-expired" };
      }
      if (dispatch.message.managedClaimToken !== dispatch.token) return { ok: false, error: "handle-expired" };
      dispatch.message.managedClaimToken = 0n;
      if (report.tag === "success") {
        const queue = queues.get(dispatch.namespace);
        const index = queue?.indexOf(dispatch.message) ?? -1;
        if (index >= 0) queue.splice(index, 1);
      }
      return { ok: true };
    },
    managedQueueReleaseDispatch(handle) {
      if (!GAME_DATA_MESSAGE_QUEUE_ENABLED) return;
      const dispatch = managedPending.get(handle.id);
      if (!dispatch) return;
      managedPending.delete(handle.id);
      if (dispatch.message.managedClaimToken === dispatch.token) dispatch.message.managedClaimToken = 0n;
    },
  };
}

function compareScore(leftScore, leftId, rightScore, rightId, descending) {
  const left = BigInt(leftScore);
  const right = BigInt(rightScore);
  const score = left < right ? -1 : left > right ? 1 : leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  return descending ? -score : score;
}

function inRange(score, min, max) {
  const value = BigInt(score);
  if (min !== undefined && value < BigInt(min)) return false;
  if (max !== undefined && value > BigInt(max)) return false;
  return true;
}
