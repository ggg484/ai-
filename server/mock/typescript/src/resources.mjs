import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

// Source checkout and installed project overlays have different contract roots.
function readLimits() {
  for (const path of ["../../../contracts/resource-limits.json", "../../../../contracts/resource-limits.json"]) {
    try { return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // pnpm nests file dependencies; the installer-owned contracts remain at the project root.
  for (let root = dirname(fileURLToPath(import.meta.url)); root !== parse(root).root; root = dirname(root)) {
    try { return JSON.parse(readFileSync(join(root, "contracts", "resource-limits.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  throw new Error("Room resource limits contract is missing; reinstall the Mock");
}
export const LIMITS = readLimits();
export class ResourceError extends Error {
  constructor(code, resource, used, limit) {
    super(`${code}: ${resource} ${used} > ${limit}`);
    Object.assign(this, { code, resource, used, limit });
  }
}
const size = (value) => typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;

/** Observe Host output without interrupting gameplay. Time-based quotas get 25% headroom. */
export class HostBudget {
  constructor(now = () => performance.now(), warn = () => {}) {
    this.warn = warn; this.now = now; this.windowStart = now(); this.windowBytes = 0;
    this.begin();
  }
  begin() { this.commands = 0; this.bytes = 0; }
  charge(parts = []) {
    const runtime = LIMITS.room_runtime;
    const bytes = parts.reduce((sum, part) => sum + size(part), 0);
    if (this.now() - this.windowStart >= 1000) {
      this.windowStart = this.now(); this.windowBytes = 0;
    }
    for (const [code, resource, used, limit] of [
      ["ROOM_RESOURCE_BUDGET_EXCEEDED", "host_output_per_callback", this.bytes + bytes, runtime.host_output_bytes_per_callback],
      ["ROOM_RESOURCE_BUDGET_EXCEEDED", "host_output_per_second", this.windowBytes + bytes, runtime.host_output_bytes_per_second * 1.25],
      ["ROOM_COMMAND_LIMIT_EXCEEDED", "host_commands_per_callback", this.commands + 1, runtime.host_commands_per_callback],
    ]) {
      if (used > limit) this.warn(new ResourceError(code, resource, used, limit));
    }
    this.commands++; this.bytes += bytes; this.windowBytes += bytes;
  }
}

/** Validate serialized Room state, without claiming WASM memory or recovery coverage. */
export function checkSnapshot(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1 || snapshot.schemaVersion > LIMITS.configuration.snapshot_schema_version) {
    throw new ResourceError("ROOM_STATE_INVALID", "checkpoint_schema", snapshot?.schemaVersion ?? 0, LIMITS.configuration.snapshot_schema_version);
  }
  if (!(snapshot.data instanceof Uint8Array)) throw new Error("Checkpoint data must be Uint8Array");
  if (snapshot.data.byteLength > LIMITS.room_runtime.checkpoint_bytes) {
    throw new ResourceError("ROOM_RESOURCE_BUDGET_EXCEEDED", "checkpoint_bytes", snapshot.data.byteLength, LIMITS.room_runtime.checkpoint_bytes);
  }
}

/** Public 1s/5s traffic windows, including the conservative 100ms edge bucket. */
class Window {
  constructor() { this.buckets = new Array(51).fill(0); this.index = 0; this.start = undefined; }
  rotate(now) {
    if (this.start === undefined || now - this.start >= 5100) {
      this.buckets.fill(0); this.index = 0; this.start = now; return;
    }
    const steps = Math.max(0, Math.floor((now - this.start) / 100));
    for (let i = 0; i < steps; i++) { this.index = (this.index + 1) % 51; this.buckets[this.index] = 0; }
    this.start += steps * 100;
  }
  check(now, bytes, rate) {
    this.rotate(now);
    const short = Array.from({ length: 11 }, (_, i) => this.buckets[(this.index + 51 - i) % 51]).reduce((a, b) => a + b, 0);
    const long = this.buckets.reduce((a, b) => a + b, 0);
    return short + bytes > rate * 2 ? { used: short, limit: rate * 2, window: 1000 }
      : long + bytes > rate * 5 ? { used: long, limit: rate * 5, window: 5000 } : null;
  }
  add(bytes) { this.buckets[this.index] += bytes; }
}

export class TrafficBudget {
  constructor(now = () => performance.now()) { this.now = now; this.windows = new Map(); this.notices = new Map(); }
  window(key, now) {
    // Bound idle identities while preserving all active 5-second windows.
    for (const [k, entry] of this.windows) if (now - entry.last > 6000) this.windows.delete(k);
    let entry = this.windows.get(key);
    if (!entry) { entry = { value: new Window(), last: now }; this.windows.set(key, entry); }
    entry.last = now; return entry.value;
  }
  egress(recipients, activeUsers, maxPlayers) {
    const now = this.now(), rate = LIMITS.room_network.downstream_bytes_per_second * 1.25, effective = Math.max(1, Math.min(activeUsers + 1, maxPlayers));
    const room = this.window(JSON.stringify([null, "downstream"]), now);
    const total = recipients.reduce((sum, [, bytes]) => sum + bytes, 0);
    const roomFailure = room.check(now, total, rate * effective);
    room.add(total);
    return recipients.map(([user, bytes]) => {
      const personal = this.window(JSON.stringify([user, "downstream"]), now);
      const userFailure = personal.check(now, bytes, rate);
      personal.add(bytes);
      const failure = userFailure ?? roomFailure;
      if (!failure) return null;
      return { error_code: "ROOM_BANDWIDTH_LIMIT_EXCEEDED", scope: userFailure ? "user" : "room", direction: "downstream", action: "warning", observed_bytes: failure.used, attempted_bytes: userFailure ? bytes : total, limit_bytes: failure.limit, window_millis: failure.window };
    });
  }
  check(user, direction, bytes, activeUsers, maxPlayers) {
    const now = this.now(), rate = LIMITS.room_network[`${direction}_bytes_per_second`] * 1.25;
    const effective = Math.max(1, Math.min(activeUsers + 1, maxPlayers));
    const personal = this.window(JSON.stringify([user, direction]), now);
    const room = this.window(JSON.stringify([null, direction]), now);
    const userFailure = personal.check(now, bytes, rate);
    const roomFailure = room.check(now, bytes, rate * effective);
    const failure = userFailure ?? roomFailure;
    personal.add(bytes); room.add(bytes);
    if (!failure) return null;
    const scope = userFailure ? "user" : "room", key = JSON.stringify([scope === "user" ? user : null, scope, direction]);
    for (const [k, time] of this.notices) if (now - time >= 6000) this.notices.delete(k);
    const notify = !this.notices.has(key) || now - this.notices.get(key) >= 1000;
    if (notify) this.notices.set(key, now);
    return { error_code: "ROOM_BANDWIDTH_LIMIT_EXCEEDED", scope, direction, action: "warning", observed_bytes: failure.used, attempted_bytes: bytes, limit_bytes: failure.limit, window_millis: failure.window, effective_users: effective, limit_bytes_per_second: failure.limit / (failure.window / 1000), notify };
  }
}

/** Bounded, payload-free diagnostics persist for the lifetime of this Mock process. */
export class Diagnostics {
  constructor(now = () => Date.now(), write = (value) => process.stderr.write(`${JSON.stringify(value)}\n`)) {
    this.now = now; this.write = write; this.entries = new Map();
  }
  record(error) {
    const resource = error.resource ?? `bandwidth_${error.scope}_${error.direction}`;
    const used = error.used ?? error.observed_bytes + error.attempted_bytes;
    const threshold = error.limit ?? error.limit_bytes;
    const timed = resource === "host_output_per_second" || resource.startsWith("bandwidth_");
    const key = `${resource}:${error.window_millis ?? 0}`;
    const now = this.now();
    const entry = this.entries.get(key) ?? { resource, error_code: error.code ?? error.error_code, count: 0, peak: 0, online_limit: threshold / (timed ? 1.25 : 1), warning_threshold: threshold, window_millis: error.window_millis ?? null, first_seen_ms: now, last_print_ms: -Infinity };
    entry.count++; entry.peak = Math.max(entry.peak, used); entry.last_seen_ms = now;
    if (this.entries.size < 64 || this.entries.has(key)) this.entries.set(key, entry);
    if (now - entry.last_print_ms >= 1000) {
      entry.last_print_ms = now;
      this.write({ level: "warn", operation: "room_mock_resource_warning", mode: "warn", ...this.publicEntry(entry) });
    }
  }
  publicEntry({ last_print_ms, ...entry }) { return entry; }
  report() { return { mode: "warn", has_warnings: this.entries.size > 0, warnings: [...this.entries.values()].map((entry) => this.publicEntry(entry)) }; }
}
