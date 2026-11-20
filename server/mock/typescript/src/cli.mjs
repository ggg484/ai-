#!/usr/bin/env node
import { resolve } from "node:path";

import { loadRoomModule, startMockServer } from "./server.mjs";

/** Read unambiguous long options; unknown options fail immediately. */
function parseArguments(values) {
  const options = { host: "127.0.0.1", port: 7350, rooms: 1000, dataFile: resolve(".builda-online/mock-data/typescript.bin") };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--help" || name === "-h") return { help: true };
    const value = values[index + 1];
    if (!value || !name.startsWith("--")) throw new Error(`Invalid argument: ${name}`);
    index += 1;
    if (name === "--room") options.room = resolve(value);
    else if (name === "--sdk") options.sdk = resolve(value);
    else if (name === "--source-root") options.sourceRoot = resolve(value);
    else if (name === "--scenario") options.scenario = resolve(value);
    else if (name === "--data-file") options.dataFile = resolve(value);
    else if (name === "--host") options.host = value;
    else if (name === "--port") options.port = Number(value);
    else if (name === "--rooms") options.rooms = Number(value);
    else if (name === "--online-config") options.onlineConfig = resolve(value);
    else if (name === "--max-active-rooms") options.maxActiveRooms = Number(value);
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!Number.isInteger(options.rooms) || options.rooms < 1 || options.rooms > 1000) {
    throw new Error("--rooms must be an integer from 1 to 1000");
  }
  if (options.maxActiveRooms !== undefined && (!Number.isInteger(options.maxActiveRooms) || options.maxActiveRooms < 1 || options.maxActiveRooms > 256)) {
    throw new Error("--max-active-rooms must be an integer from 1 to 256");
  }
  return options;
}

/** Print CLI help that contains only user-facing local concepts. */
function printHelp() {
  process.stdout.write([
    "Builda Online TypeScript Room Mock",
    "",
    "Usage:",
    "  builda-room-mock --room <room.ts> --sdk <@cysj/room-directory> [--source-root <directory>] [--scenario <json>] [--online-config <builda.online.json>]",
    "",
    "Options:",
    "  --host <address>       Loopback addresses only; defaults to 127.0.0.1",
    "  --port <port>          Defaults to 7350",
    "  --source-root <dir>    Room source root; defaults to the room.ts directory",
    "  --scenario <file>      Synthetic roster, teams, bots, and Room startup parameters",
    "  --data-file <file>     Local saved data; defaults to .builda-online/mock-data/typescript.bin",
    "  --online-config <file> Project builda.online.json; enables per-matchKey Rooms, lists and private Rooms",
    "  --rooms <count>        Rooms created before restart is required; defaults to 1000",
    "  --max-active-rooms <n> Rooms that may run at the same time; defaults to 64",
  ].join("\n") + "\n");
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    if (!options.room || !options.sdk) throw new Error("--room and --sdk must be provided together");
    const module = await loadRoomModule(options.room, options.sdk, options.sourceRoot);
    await startMockServer({ ...options, module });
  }
} catch (error) {
  process.stderr.write(`[builda-room-mock] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
