/** Local API/CAS simulation. Does not simulate durable replay, permissions or production capacity. */
export function createPlayerDataStore(authority = {}, now = () => Date.now()) {
  const values = authority.values ?? new Map();
  const targets = new Map(), operations = new Map();
  let next = 1n;
  const clone = (v) => structuredClone(v);
  function sweep() { for (const [id, op] of operations) if (op.expires <= now()) operations.delete(id); }
  function target(id) { const t = targets.get(id); if (!t || t.closed) throw "closed"; return t; }
  function read(role, key) { return clone(authority.read?.(role, key) ?? values.get(JSON.stringify([role, key])) ?? { valueRevision: 0n, schemaId: "", schemaVersion: 0 }); }
  function done(code, id) { return { tag: "failed", val: { code, requestId: `local-player-data-${id}` } }; }
  function allocate(op) { sweep(); if (operations.size >= 64) throw "capacity-exceeded"; const id = next++; operations.set(id, { ...op, expires: now() + 60000 }); return { id }; }
  function validKey(key) { return typeof key === "string" && key.length > 0 && new TextEncoder().encode(key).length <= 128 && !key.startsWith("builda.") && !key.includes("\0"); }
  function validTimeout(n) { if (!Number.isInteger(n) || n < 1 || n > 30000) throw "invalid-argument"; }
  return {
    reset() { targets.clear(); operations.clear(); },
    playerDataOpen(role) { if (typeof role !== "string" || !/^[a-zA-Z0-9_:-]{1,128}$/.test(role) || role.includes("__")) throw "invalid-argument"; if ([...targets.values()].filter((t) => !t.closed).length >= 64 || targets.size >= 128) throw "capacity-exceeded"; const id = next++; targets.set(id, { role, closed: false }); return { id }; },
    playerDataStart(handle, key, kind, timeout) {
      const t = target(handle.id); validTimeout(timeout); if (!validKey(key) || !["read", "update"].includes(kind)) throw "invalid-argument";
      const current = read(t.role, key);
      return allocate({ target: handle.id, role: t.role, key, kind, current, generation: 1n, attempts: 0, deadline: now() + timeout, result: kind === "read" ? { tag: "read", val: current } : undefined });
    },
    playerDataPoll(handle) {
      sweep(); const op = operations.get(handle.id); if (!op) return done("expired", handle.id);
      if (op.result) return clone(op.result);
      if (targets.get(op.target)?.closed) return done("closed", handle.id);
      if (now() >= op.deadline) return done("deadline-exceeded", handle.id);
      return { tag: "needs-transform", val: { readGeneration: op.generation, current: clone(op.current) } };
    },
    playerDataPropose(handle, generation, proposal) {
      const op = operations.get(handle.id); if (!op || op.kind !== "update" || op.result || op.generation !== generation) throw "invalid-argument";
      target(op.target);
      if (now() >= op.deadline) { op.result = done("deadline-exceeded", handle.id); return; }
      if (proposal.tag === "callback-abort") { op.result = done("callback-failed", handle.id); return; }
      if (proposal.tag === "keep") { op.result = { tag: "written", val: { status: "unchanged", valueRevision: op.current.valueRevision } }; return; }
      if (authority.isDirty?.(op.role)) { op.result = done("busy", handle.id); return; }
      const current = read(op.role, op.key);
      if (current.valueRevision !== op.current.valueRevision) {
        if (op.attempts++ >= 3) op.result = done("version-conflict", handle.id);
        else { op.generation++; op.current = current; }
        return;
      }
      if (!["set", "delete"].includes(proposal.tag)) throw "invalid-argument";
      const next = { valueRevision: current.valueRevision + 1n, schemaId: "", schemaVersion: 0 };
      if (proposal.tag === "set") {
        Object.assign(next, clone(proposal.val));
        const v = next.value; const bytes = v.tag === "bytes-inline" ? v.val.data.byteLength : v.tag === "object-cbor" ? v.val.byteLength : v.tag === "string-value" ? new TextEncoder().encode(v.val).length : 8;
        if (bytes > 4 * 1024 * 1024) { op.result = done("value-too-large", handle.id); return; }
      }
      if (authority.write) authority.write(op.role, op.key, next); else { if (values.size >= 4096 && !values.has(JSON.stringify([op.role, op.key]))) { op.result = done("capacity-exceeded", handle.id); return; } values.set(JSON.stringify([op.role, op.key]), next); }
      op.result = { tag: "written", val: { status: "applied", valueRevision: next.valueRevision } };
    },
    playerDataCloseStart(handle, timeout) {
      const t = targets.get(handle.id); if (!t) throw "closed";
      t.closed = true; // Before deadline validation or operation allocation.
      validTimeout(timeout);
      for (const [id, op] of operations) if (op.target === handle.id && !op.result) op.result = done("closed", id);
      return allocate({ result: { tag: "closed", val: { tag: "closed" } } });
    },
    playerDataResume() { throw { code: "outcome-unknown", requestId: "", recoveryError: "unsupported-capability" }; },
    playerDataReleaseOperation(handle) { operations.delete(handle.id); },
    playerDataReleaseTarget(handle) { const t = targets.get(handle.id); if (t) t.closed = true; targets.delete(handle.id); },
    playerDataReleaseRecovery() {},
  };
}
