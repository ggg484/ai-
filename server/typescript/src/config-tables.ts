import { currentRoomHost } from "./host.ts";
import type { JSONObject } from "./game-data.ts";

/** Result of reading a config table. `pending` means the table is loading: read
 * again on a later tick. `unavailable` is a failure, not an empty table. */
export type ConfigRead =
  | { status: "ready"; table: Readonly<JSONObject> }
  | { status: "pending" }
  | { status: "not-found" }
  | { status: "unavailable" };

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Read-only dynamic config tables, read by name. */
export class ConfigTables {
  // The Host resends content only when its hash changes, so an unchanged
  // table is neither copied nor parsed again.
  private readonly known = new Map<string, { hash: string; result: ConfigRead; tick: number }>();
  // A Host call costs microseconds in a JS Room, so a ready table is asked at
  // most once per tick. Until the adapter drives ticks, every read asks.
  private tick = 0;

  /** @internal Called by the platform adapter at the start of every tick. */
  nextTick(): void {
    this.tick++;
  }

  read(table: string): ConfigRead {
    const host = currentRoomHost();
    if (!host?.configRead) return { status: "unavailable" };
    const known = this.known.get(table);
    if (known && this.tick > 0 && known.tick === this.tick) return known.result;
    const result = host.configRead(table, known?.hash);
    if (result.tag === "unchanged") {
      if (!known) return { status: "unavailable" };
      known.tick = this.tick;
      return known.result;
    }
    if (result.tag !== "ready") {
      this.known.delete(table);
      return { status: result.tag };
    }
    const ready: ConfigRead = { status: "ready", table: freeze(JSON.parse(result.val.content) as JSONObject) };
    this.known.set(table, { hash: result.val.hash, result: ready, tick: this.tick });
    return ready;
  }
}
