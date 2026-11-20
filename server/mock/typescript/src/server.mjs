import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { Script } from "node:vm";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { build } from "esbuild";
import { WebSocketServer } from "ws";

import { LIMITS, HostBudget, TrafficBudget, Diagnostics, ResourceError, checkSnapshot } from "./resources.mjs";

import { createPlayerDataStore } from "./player-data-store.mjs";
import { createGameDataStore } from "./game-data-store.mjs";
import { createPersistence } from "./persistence.mjs";
import { createGameLifecycleStore } from "./game-lifecycle-store.mjs";
import { createMockEconomy } from "./mock-economy.mjs";
import { loadMatchPolicies } from "./match-policy.mjs";
import { formMatch } from "./matchmaking.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LOCAL_LOG_MAX_EVENTS_PER_SECOND = LIMITS.room_logs.events_per_second;
const LOCAL_LOG_MAX_BYTES_PER_SECOND = LIMITS.room_logs.message_bytes_per_second;
const LOCAL_LOG_MAX_MESSAGE_BYTES = LIMITS.room_logs.message_bytes;
const TRUNCATED_SUFFIX = "...[truncated]";
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_TICKET_GRACE_MS = 15_000;
const DEFAULT_EMPTY_ROOM_GRACE_MS = 1_000;

/** Bound local user logs on UTF-8 boundaries so debug output does not flood the terminal. */
function boundedLocalLogMessage(value) {
  const bytes = encoder.encode(String(value));
  if (bytes.length <= LOCAL_LOG_MAX_MESSAGE_BYTES) return String(value);
  const suffix = encoder.encode(TRUNCATED_SUFFIX);
  let boundary = LOCAL_LOG_MAX_MESSAGE_BYTES - suffix.length;
  while (boundary > 0 && (bytes[boundary] & 0xc0) === 0x80) boundary -= 1;
  return `${decoder.decode(bytes.subarray(0, boundary))}${TRUNCATED_SUFFIX}`;
}

/** Create a bounded user Room logger that writes only to local stdout. */
export function createLocalRoomLogger(roomId, write = (line) => process.stdout.write(line), warn = () => {}) {
  let windowStartedAt = Date.now();
  let eventsInWindow = 0;
  let bytesInWindow = 0;
  return (requestedLevel, requestedMessage) => {
    const now = Date.now();
    if (now - windowStartedAt >= 1_000) {
      windowStartedAt = now;
      eventsInWindow = 0;
      bytesInWindow = 0;
    }
    const level = ["debug", "info", "warn", "error"].includes(requestedLevel) ? requestedLevel : "info";
    const roomLogMessage = boundedLocalLogMessage(requestedMessage);
    const eventBytes = encoder.encode(roomLogMessage).length;
    const requestedBytes = encoder.encode(String(requestedMessage)).length;
    if (requestedBytes > LOCAL_LOG_MAX_MESSAGE_BYTES) warn(new ResourceError("ROOM_LOG_LIMIT_EXCEEDED", "log_message_bytes", requestedBytes, LOCAL_LOG_MAX_MESSAGE_BYTES));
    if (eventsInWindow >= LOCAL_LOG_MAX_EVENTS_PER_SECOND || bytesInWindow + eventBytes > LOCAL_LOG_MAX_BYTES_PER_SECOND) {
      const countExceeded = eventsInWindow >= LOCAL_LOG_MAX_EVENTS_PER_SECOND;
      warn(new ResourceError("ROOM_LOG_LIMIT_EXCEEDED", countExceeded ? "log_events_per_second" : "log_bytes_per_second", countExceeded ? eventsInWindow + 1 : bytesInWindow + eventBytes, countExceeded ? LOCAL_LOG_MAX_EVENTS_PER_SECOND : LOCAL_LOG_MAX_BYTES_PER_SECOND));
      return;
    }
    eventsInWindow += 1;
    bytesInWindow += eventBytes;
    const message = level === "error"
      ? "User Room reported an error"
      : level === "warn"
        ? "User Room reported a warning"
        : level === "debug"
          ? "User Room local debug log"
          : "User Room local log";
    const errorCode = level === "error"
      ? "USER_ROOM_REPORTED_ERROR"
      : level === "warn"
        ? "USER_ROOM_REPORTED_WARNING"
        : undefined;
    write(`${JSON.stringify({ level, operation: "user_room_log", room_id: roomId, room_log_message: roomLogMessage, ...(errorCode ? { error_code: errorCode } : {}), message })}\n`);
  };
}

/** Bundle the user Room and public SDK in a temp directory and return an isolated module Node can load. */
export async function loadRoomModule(entry, sdkDirectory, sourceRootDirectory = dirname(entry)) {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "builda-room-mock-"));
  const output = resolve(temporaryDirectory, "room.mjs");
  const sourceRoot = resolve(sourceRootDirectory);
  const sdkRoot = resolve(sdkDirectory, "src");
  const inside = (path, root) => {
    const value = relative(root, path);
    return value === "" || (!value.startsWith("..") && !isAbsolute(value));
  };
  if (!inside(resolve(entry), sourceRoot)) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("Room entry must be inside the Room source root");
  }
  const buildOptions = {
    stdin: {
      contents: `export { default as RoomType } from ${JSON.stringify(entry)}; export { Client, configureRoomHost } from ${JSON.stringify(resolve(sdkRoot, "index.ts"))};`,
      resolveDir: sourceRoot,
      sourcefile: "builda-room-mock-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    target: "node22",
    plugins: [{
      name: "builda-room-public-imports",
      setup(context) {
        context.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point") return undefined;
          if (args.path === "@cysj/room") return { path: resolve(sdkRoot, "index.ts") };
          if (!args.path.startsWith(".") && !isAbsolute(args.path)) {
            return { errors: [{ text: `Local Mock cannot import non-public packages: ${args.path}` }] };
          }
          const candidate = resolve(args.resolveDir, args.path);
          if (!inside(candidate, sourceRoot) && !inside(candidate, sdkRoot)) {
            return { errors: [{ text: `Module path crosses the Room or SDK boundary: ${args.path}` }] };
          }
          return { path: candidate };
        });
      },
    }],
  };
  try {
    await build({ ...buildOptions, outfile: output, format: "esm" });
    const moduleUrl = pathToFileURL(output).href;
    const module = await import(`${moduleUrl}?v=${Date.now()}`);
    let instantiate;
    try {
      // Each Room gets fresh module state like a separate online WASM instance; a closure is collectable after dispose.
      const script = await build({ ...buildOptions, format: "iife", globalName: "__buildaRoomModule", write: false, logLevel: "silent" });
      const factory = new Script(`(function () {\n${script.outputFiles[0].text}\nreturn __buildaRoomModule;\n})`, { filename: "builda-room-mock-instance.js" }).runInThisContext();
      instantiate = () => factory();
    } catch {
      // Top-level await cannot be wrapped; such Rooms share one SDK instance, as older Mocks did.
      process.stderr.write(`${JSON.stringify({ level: "warn", operation: "room_mock_shared_module", message: "Room source uses top-level await; concurrent local Rooms share module state" })}\n`);
      instantiate = () => module;
    }
    return { ...module, instantiate, cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

/** Read and normalize the user-editable local Scenario. */
async function loadScenario(path) {
  const value = path ? JSON.parse(await readFile(path, "utf8")) : {};
  const room = value.room ?? {};
  return {
    room: {
      roomId: room.room_id ?? "local-room",
      roomName: room.room_name ?? "local-room",
      tickRate: Number(room.tick_rate ?? 20),
      maxPlayers: Number(room.max_players ?? 8),
      schemaVersion: 1,
      entryKind: room.entry_kind ?? "direct",
      gameId: room.game_id ?? "local-game",
      serverReleaseId: "local-mock",
      activityId: room.activity_id ?? "local-activity",
      activityRevision: 1n,
      matchId: "local-match",
      matchKey: room.match_key ?? "local",
      matchMode: room.match_mode ?? "room",
      roomRoute: room.room_route ?? "default",
      roomType: room.room_type ?? "default",
      artifactId: "local-source",
      roster: [
        ...(value.actors ?? []).map((actor, index) => ({
          seatId: actor.seat_id ?? `seat-${index + 1}`,
          teamId: actor.team_id ?? "team-1",
          occupantKind: "human",
          userId: actor.player_id ?? `player-${index + 1}`,
        })),
        ...(value.bots ?? []).map((bot, index) => ({
          seatId: bot.seat_id ?? `bot-seat-${index + 1}`,
          teamId: bot.team_id ?? "team-bot",
          occupantKind: "bot",
          botId: bot.bot_id ?? `bot-${index + 1}`,
        })),
      ],
      launchContextJson: JSON.stringify(value.launch_context ?? {}),
    },
    mockEconomy: value.mock_economy ?? {},
    mockManagedQueues: value.mock_managed_queues ?? {},
    mockConfigTables: value.mock_config_tables ?? {},
  };
}

/** Recursively merge JSON objects, consistent with the client state-patch contract. */
function mergePatch(target, patch) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) result[key] = mergePatch(result[key], value);
  return result;
}

/** Encode a CYR1 Room binary frame carried over the local WebSocket tunnel. */
function encodeRoomFrame(type, sequence, payload) {
  const typeBytes = Buffer.from(type, "utf8");
  const bytes = 14 + typeBytes.length + payload.length;
  if (!typeBytes.length || typeBytes.length > 65535) throw new Error("Room message type length is invalid");
  const frame = Buffer.allocUnsafe(bytes);
  frame.write("CYR1", 0, "ascii");
  frame.writeUInt16BE(typeBytes.length, 4);
  frame.writeBigUInt64BE(BigInt(sequence), 6);
  typeBytes.copy(frame, 14);
  Buffer.from(payload).copy(frame, 14 + typeBytes.length);
  return frame;
}

/** Decode a CYR1 Room binary frame sent by a client. */
function decodeRoomFrame(frameBase64) {
  const frame = Buffer.from(frameBase64, "base64");
  if (frame.length < 14 || frame.toString("ascii", 0, 4) !== "CYR1") throw new Error("Room binary frame header is invalid");
  const typeLength = frame.readUInt16BE(4);
  const payloadOffset = 14 + typeLength;
  if (typeLength === 0 || payloadOffset > frame.length) throw new Error("Room binary frame length is invalid");
  return { type: frame.toString("utf8", 14, payloadOffset), sequence: frame.readBigUInt64BE(6), payload: new Uint8Array(frame.subarray(payloadOffset)) };
}

// Matches the real Host: the first read of a table is pending while it loads.
export function createConfigTables(tables) {
  const loaded = new Set();
  return {
    configRead(table, knownHash) {
      if (!Object.prototype.hasOwnProperty.call(tables, table)) return { tag: "not-found" };
      if (!loaded.has(table)) {
        loaded.add(table);
        return { tag: "pending" };
      }
      const content = JSON.stringify(tables[table]);
      const hash = createHash("sha256").update(content).digest("hex");
      return knownHash === hash ? { tag: "unchanged" } : { tag: "ready", val: { hash, content } };
    },
  };
}

const ERROR_INVALID_MESSAGE = 1002;
const ERROR_UPSTREAM = 2002;
const DEFAULT_MAX_ACTIVE_ROOMS = 64;
// Clients wait at most 20 seconds for a local Room join response, so the local Confirm window stays below it.
const LOCAL_CONFIRM_WINDOW_CAP_MS = 15_000;
const MAX_SAFE_RANK_SCORE = Number.MAX_SAFE_INTEGER;
const PRIVATE_CREATE_REPLAY_LIMIT = 256;
const TERMINAL_TICKET_STATUSES = new Set(["cancelled", "timeout", "party_timeout", "confirm_timeout", "failed"]);
// A confirmed Ticket has handed its player to the Room, so only these states stop the player from starting another Admission.
const BLOCKING_TICKET_STATUSES = new Set(["waiting", "matched", "room_ready"]);
const SEAT_STATUS = { reserved: "reserved", pending: "connected_pending", online: "online", offline: "offline_grace" };

/**
 * Start a local Mock that binds only to the loopback address.
 * It keeps a local Room directory: several Rooms may run at once, each with its own Room instance, state, seats and
 * empty-Room reclaim. Matchmaking stays a deterministic local placement, not the online algorithm.
 */
export async function startMockServer(options) {
  if (!["127.0.0.1", "::1", "localhost"].includes(options.host)) {
    throw new Error("Room Mock may only bind to a loopback address");
  }
  const scenario = await loadScenario(options.scenario);
  if (!Number.isInteger(scenario.room.maxPlayers) || scenario.room.maxPlayers < 1 || scenario.room.maxPlayers > LIMITS.configuration.players_per_room) throw new Error("Scenario max_players must be from 1 to 50");
  const matching = loadMatchPolicies(options.onlineConfig, scenario.room);
  const botCount = scenario.room.roster.filter((seat) => seat.occupantKind === "bot").length;
  for (const policy of matching.policies.values()) {
    if (policy.mode === "room" && botCount >= policy.capacity) throw new Error(`Scenario bots leave no human seat in matchKey ${policy.matchKey}`);
  }
  const persistence = createPersistence(options.dataFile, scenario.room.gameId);
  const saved = persistence.load();
  let economy, gameData;
  const save = () => persistence.save({ economy: economy.snapshot(), gameData: gameData.snapshot() });
  economy = createMockEconomy({
    orders: scenario.mockEconomy?.orders ?? [],
    initial: saved?.economy,
    save,
  });
  gameData = createGameDataStore(() => callbackUnixTimeMillis, scenario.mockManagedQueues, undefined, { initial: saved?.gameData, save });
  const moduleSource = options.module;
  if (typeof moduleSource?.RoomType !== "function") throw new Error("Room module must default-export defineRoom(RoomClass)");
  // Modules built without per-Room isolation (top-level await) share one SDK instance, as older Mocks did.
  const instantiateRoomModule = typeof moduleSource.instantiate === "function" ? moduleSource.instantiate : () => moduleSource;
  const sessions = new Map();
  const rooms = new Map();
  const tickets = new Map();
  // Every Admission gets its own Ticket ID like online; earlier Tickets of a player stay readable (bounded).
  const ticketsById = new Map();
  const ticketSequences = new Map();
  const TICKET_HISTORY_LIMIT = 1024;
  const privateCreates = new Map();
  const roomLimit = options.rooms ?? 1_000;
  const maxActiveRooms = options.maxActiveRooms ?? DEFAULT_MAX_ACTIVE_ROOMS;
  const reconnectGraceMs = options.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
  const ticketGraceMs = options.ticketGraceMs ?? DEFAULT_TICKET_GRACE_MS;
  const emptyRoomGraceMs = options.emptyRoomGraceMs ?? DEFAULT_EMPTY_ROOM_GRACE_MS;
  if (!Number.isInteger(roomLimit) || roomLimit < 1 || roomLimit > 1000) {
    throw new Error("rooms must be an integer from 1 to 1000");
  }
  if (!Number.isInteger(maxActiveRooms) || maxActiveRooms < 1 || maxActiveRooms > 256) {
    throw new Error("maxActiveRooms must be an integer from 1 to 256");
  }
  for (const [name, value] of Object.entries({ reconnectGraceMs, ticketGraceMs, emptyRoomGraceMs })) {
    if (!Number.isInteger(value) || value < 1 || value > 60_000) throw new Error(`${name} must be an integer from 1 to 60000`);
  }
  const diagnostics = new Diagnostics();
  const warn = (error) => diagnostics.record(error);
  const frameWarning = (bytes) => { if (bytes > LIMITS.room_runtime.message_frame_bytes) warn(new ResourceError("ROOM_RESOURCE_BUDGET_EXCEEDED", "message_frame_bytes", bytes, LIMITS.room_runtime.message_frame_bytes)); };
  let lastResourceError = null;
  let roomsStarted = 0;
  let latestGeneration = 0;
  let callbackUnixTimeMillis = 0n;
  let lastUnixTimeMillis = 0n;
  const prepareRoomCallback = () => {
    const sampled = BigInt(Date.now());
    if (sampled > lastUnixTimeMillis) lastUnixTimeMillis = sampled;
    callbackUnixTimeMillis = lastUnixTimeMillis;
  };
  const sendControl = (socket, type, payload, requestId = "") => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, payload, request_id: requestId }));
  };
  const roomError = (socket, requestId, errorCode, message) => sendControl(socket, "error", { code: ERROR_UPSTREAM, error_code: errorCode, message }, requestId);
  const invalid = (socket, requestId, message, errorCode) => sendControl(socket, "error", { code: ERROR_INVALID_MESSAGE, ...(errorCode ? { error_code: errorCode } : {}), message }, requestId);
  const limitError = (socket, requestId, reason) => sendControl(socket, "error", {
    code: 17,
    message: reason === "active"
      ? "Local active Room limit reached; leave a Room or increase --max-active-rooms"
      : "Local Room limit reached; restart the Mock or increase --rooms",
  }, requestId);
  const exempt = (type) => ["room_closed", "room_traffic_limited", "host_command", "__cysj_transport_pong"].includes(type);
  const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value));
  const decode = (bytes) => JSON.parse(decoder.decode(bytes));

  /** Count Scenario bots toward capacity because online Bots occupy Seats too. */
  const occupied = (room) => room.seats.size + room.botCount;
  const available = (room) => Math.max(0, room.policy.capacity - occupied(room));
  const onlineSeats = (room) => [...room.seats.values()].filter((seat) => seat.status === SEAT_STATUS.online);
  const onlineSessions = (room) => onlineSeats(room).map((seat) => sessions.get(seat.sessionId)).filter(Boolean);
  const sessionOf = (playerId) => [...sessions.values()].find((session) => session.playerId === playerId);
  // A player may hold a reserved Seat from a new assignment while still in the old Room; the occupied Seat comes first.
  const seatRoomOf = (playerId) => {
    const holding = [...rooms.values()].filter((room) => room.seats.has(playerId));
    return holding.find((room) => room.seats.get(playerId).status !== SEAT_STATUS.reserved) ?? holding[0];
  };
  /** The Room where the player is connected, waiting to connect or inside the reconnect window, other than `except`. */
  const occupiedRoomOf = (playerId, except) => [...rooms.values()].find((room) => room !== except && room.seats.has(playerId) && room.seats.get(playerId).status !== SEAT_STATUS.reserved);
  const queueName = (room) => room.policy.legacy ? scenario.room.matchKey : room.policy.matchKey;

  /** Encode one Room envelope over the local WebSocket tunnel; the Room ID is the local match_id. */
  function rawEnvelope(room, socket, channel, type, payload) {
    sendControl(socket, "local_room_message", {
      room_id: room.roomId, match_id: room.roomId, channel: channel.replaceAll("-", "_"),
      frame_base64: encodeRoomFrame(type, 0, payload).toString("base64"),
    });
  }
  function trafficAllowed(room, session, direction, bytes) {
    const event = room.traffic.check(session.playerId, direction, bytes, onlineSeats(room).length, room.policy.capacity);
    frameWarning(bytes);
    if (event) warn(event);
    return true;
  }
  function sendMany(room, targets, channel, type, payload) {
    const bytes = encodeRoomFrame(type, 0, payload).length;
    frameWarning(bytes);
    const results = exempt(type) ? targets.map(() => null) : room.traffic.egress(targets.map((s) => [s.playerId, bytes]), onlineSeats(room).length, room.policy.capacity);
    targets.forEach((session, index) => {
      const event = results[index];
      if (event) warn(event);
      rawEnvelope(room, session.socket, channel, type, payload);
    });
  }
  function pushEnvelope(room, session, channel, type, payload) {
    const bytes = encodeRoomFrame(type, 0, payload).length;
    if (exempt(type) || trafficAllowed(room, session, "downstream", bytes)) rawEnvelope(room, session.socket, channel, type, payload);
  }

  /** Remove the player's Ticket when its Seat ends, so a later Admission starts a fresh Ticket. */
  function dropTicketFor(playerId, roomId) {
    const record = tickets.get(playerId);
    if (record && (roomId === undefined || record.roomId === roomId)) tickets.delete(playerId);
  }

  /** Detach a Room from the directory and release every Seat, Ticket and session binding it owned. */
  function detachRoom(room) {
    if (room.confirm) {
      // Closed before every human arrived: end the formed Tickets and answer the joins still waiting.
      const confirm = room.confirm;
      room.confirm = null;
      for (const playerId of room.seats.keys()) {
        const record = tickets.get(playerId);
        if (record?.roomId === room.roomId) updateTicket(record, { status: "failed", terminalReason: "room_lost", room: undefined });
      }
      for (const arrival of confirm.pending.values()) {
        const session = sessions.get(arrival.sessionId);
        if (session) roomError(session.socket, arrival.requestId, "ROOM_NOT_FOUND", "Local Room closed while waiting for other players");
      }
    }
    room.closed = true;
    rooms.delete(room.roomId);
    for (const playerId of room.seats.keys()) dropTicketFor(playerId, room.roomId);
    room.seats.clear();
    for (const session of sessions.values()) if (session.roomId === room.roomId) session.roomId = null;
    room.instance = undefined;
    room.state = null;
  }

  function failRoom(room, error) {
    room.lastResourceError = { error_code: error.code ?? "ROOM_RUNTIME_ERROR", resource: error.resource ?? "callback", used: error.used, limit: error.limit };
    lastResourceError = room.lastResourceError;
    process.stderr.write(`${JSON.stringify({ level: "error", operation: "room_mock_resource_limit", room_id: room.roomId, ...lastResourceError })}\n`);
    for (const session of onlineSessions(room)) {
      rawEnvelope(room, session.socket, "control-reliable", "room_closed", Buffer.from(JSON.stringify({ ...room.lastResourceError, reason: "runtime_error", message: "Local Room resource validation failed" })));
    }
    room.pending = null;
    detachRoom(room);
  }

  function invoke(room, callback) {
    room.budget.begin(); prepareRoomCallback(); room.pending = [];
    try {
      const result = callback();
      const commands = room.pending; room.pending = null;
      for (const command of commands) { if (room.closed) break; command(); }
      return result;
    } catch (error) { room.pending = null; if (!room.closed) failRoom(room, error); throw error; }
  }

  /** Run a scheduler-driven user callback and swallow failures already reported by failRoom. */
  function safely(room, callback, callerId = "") {
    if (room.closed || !room.instance) return;
    // doOrder attributes a first-seen order to the client of the running callback, never to an earlier one.
    const previousCaller = room.caller;
    room.caller = callerId;
    try { callback(room.instance); } catch { /* Reported by invoke. */ } finally { room.caller = previousCaller ?? ""; }
  }

  /** End a Room the author closed; clients see a normal terminal state rather than an error. */
  function closeRoomByAuthor(room) {
    if (room.closed) return;
    for (const session of onlineSessions(room)) pushEnvelope(room, session, "control-reliable", "room_closed", encodeJson({
      reason: "game_completed",
      error_code: "ROOM_CLOSED",
      message: "Room closed normally",
    }));
    const instance = room.instance;
    room.closed = true;
    instance.discardGameDataGeneration();
    instance.invokeSyncUserHook("onDispose", () => instance.onDispose("completed"));
    detachRoom(room);
  }

  /** Destroy a Room the scheduler deems empty, without pretending the author completed it. */
  function reapEmptyRoom(room) {
    if (room.closed || !room.instance) return;
    const instance = room.instance;
    prepareRoomCallback();
    instance.discardGameDataGeneration();
    try { instance.invokeSyncUserHook("onDispose", () => instance.onDispose("shutdown")); } catch { /* Reported by invoke. */ }
    detachRoom(room);
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_room_dispose", room_id: room.roomId, room_generation: room.generation, reason: "empty_room" })}\n`);
  }

  /** Apply lock/release to discovery only where the platform allows it: public Room-mode Rooms. */
  function setAdmission(room, state) {
    if (room.closed) return;
    if (room.accessKind !== "public" || room.policy.mode !== "room") {
      process.stdout.write(`${JSON.stringify({ level: "warn", operation: "room_mock_admission_ignored", room_id: room.roomId, requested: state, message: "lockRoom/releaseRoom only affects public Room-mode Rooms" })}\n`);
      return;
    }
    room.admission = state;
    if (state === "released") admitWaitingTickets();
  }

  /** Build the Host a single Room instance sees; every output is scoped to that Room's Seats. */
  function createHost(room) {
    const host = {
      log(level, message) {
        room.logger(level, message);
      },
      broadcast(channel, messageType, payload) {
        sendMany(room, onlineSessions(room), channel, messageType, payload);
      },
      send(channel, clientId, messageType, payload) {
        const session = sessions.get(clientId);
        if (session && session.roomId === room.roomId) pushEnvelope(room, session, channel, messageType, payload);
      },
      sendToUser(channel, userId, messageType, payload) {
        sendMany(room, onlineSessions(room).filter((s) => s.playerId === userId), channel, messageType, payload);
      },
      setState(payload) {
        room.state = decode(payload);
        sendMany(room, onlineSessions(room), "control-reliable", "state", payload);
      },
      patchState(payload) {
        room.state = mergePatch(room.state, decode(payload));
        sendMany(room, onlineSessions(room), "control-reliable", "state_patch", payload);
      },
      lockRoom() {
        for (const session of onlineSessions(room)) pushEnvelope(room, session, "control-reliable", "host_command", encodeJson({ kind: "lock_room" }));
        setAdmission(room, "locked");
      },
      releaseRoom() {
        for (const session of onlineSessions(room)) pushEnvelope(room, session, "control-reliable", "host_command", encodeJson({ kind: "release_room" }));
        setAdmission(room, "released");
      },
      closeRoom(_reason) {
        closeRoomByAuthor(room);
      },
      randomU64() {
        room.randomState ^= room.randomState << 13n;
        room.randomState ^= room.randomState >> 7n;
        room.randomState ^= room.randomState << 17n;
        return BigInt.asUintN(64, room.randomState);
      },
      unixTimeMillis() {
        return callbackUnixTimeMillis;
      },
      ...economy.hostBindings({
        caller: () => room.caller,
        members: () => [...room.seats.keys()],
        warn: (orderId) => process.stdout.write(`${JSON.stringify({ level: "warn", operation: "room_mock_order_unattributed", room_id: room.roomId, order_id: orderId, hint: "doOrder for a first-seen order outside a client callback in a Room with several players; call it from the message handler or declare the order in mock_economy.orders" })}\n`),
      }),
      ...gameData,
      ...room.playerData,
      ...room.gameLifecycle,
    };
    const bufferedHost = { ...host };
    const partsFor = {
      broadcast: (a) => [a[1], a[2]], send: (a) => [a[1], a[2], a[3]], sendToUser: (a) => [a[1], a[2], a[3]],
      setState: (a) => [a[0]], patchState: (a) => [a[0]], closeRoom: (a) => [a[0]], lockRoom: () => [], releaseRoom: () => [],
    };
    for (const [name, parts] of Object.entries(partsFor)) bufferedHost[name] = (...input) => {
      const args = input;
      if (room.checkpointing) {
        warn(new ResourceError("ROOM_STATE_INVALID", "checkpoint_host_commands", 1, 0));
        return; // A diagnostic checkpoint must not mutate gameplay.
      }
      room.budget.charge(parts(args));
      if (["broadcast", "send", "sendToUser"].includes(name)) frameWarning(14 + Buffer.byteLength(args.at(-2)) + args.at(-1).length);
      if (["setState", "patchState"].includes(name)) frameWarning(14 + (name === "setState" ? 5 : 11) + args[0].length);
      // Promise continuations are legitimate async Room work between lifecycle callbacks.
      if (room.pending === null) {
        if (room.closed || !room.instance) return;
        return invoke(room, () => bufferedHost[name](...args));
      }
      const copied = args.map((value) => value instanceof Uint8Array ? new Uint8Array(value) : value);
      room.pending.push(() => host[name](...copied));
    };
    return bufferedHost;
  }

  /** Pick a Room ID: keep the Scenario ID while free so single-Room projects see the same ID as before. */
  function nextRoomId(generation) {
    const base = scenario.room.roomId;
    return rooms.has(base) ? `${base}-${generation}` : base;
  }

  /** Build the Room roster for a local formation: humans and Bots per team, team IDs are team indexes like online. */
  function formationRoster(formation, generation) {
    return formation.teams.flatMap((team, teamIndex) => [
      ...team.playerIds.map((playerId) => ({ seatId: `seat-${playerId}`, teamId: String(teamIndex), occupantKind: "human", userId: playerId })),
      ...Array.from({ length: team.botCount }, (_, botIndex) => {
        const botId = `bot-${generation}-${teamIndex}-${botIndex + 1}`;
        return { seatId: `bot-seat-${botId}`, teamId: String(teamIndex), occupantKind: "bot", botId };
      }),
    ]);
  }

  /** Create a Room on demand for one matchKey and run onCreate; returns { room } or { error }. */
  function createRoom(policy, accessKind, formation = null) {
    if (roomsStarted >= roomLimit) return { error: "total" };
    if (rooms.size >= maxActiveRooms) return { error: "active" };
    const exports = instantiateRoomModule();
    const { RoomType, Client, configureRoomHost } = exports;
    roomsStarted += 1;
    latestGeneration += 1;
    const generation = latestGeneration;
    const roomId = nextRoomId(generation);
    const room = {
      roomId,
      generation,
      policy,
      accessKind,
      // Online Pool/RankPool Rooms are always locked and receive their whole roster from one formation.
      admission: policy.mode === "room" && accessKind === "public" ? "released" : "locked",
      botCount: formation ? formation.teams.reduce((sum, team) => sum + team.botCount, 0) : botCount,
      confirm: null,
      seats: new Map(),
      // Players who actively left; like online, they need a new Seat (Ticket) before entering again.
      leftPlayers: new Set(),
      caller: "",
      Client,
      state: null,
      closed: false,
      instance: undefined,
      pending: null,
      checkpointing: false,
      emptySince: null,
      lastCheckpoint: performance.now(),
      lastResourceError: null,
      budget: new HostBudget(undefined, warn),
      traffic: new TrafficBudget(),
      randomState: BigInt.asUintN(64, 0x9e3779b97f4a7c15n + BigInt(roomsStarted - 1)),
      createdAtMillis: Date.now(),
      revision: 1,
      logger: createLocalRoomLogger(roomId, undefined, warn),
      playerData: createPlayerDataStore(economy.playerDataAuthority),
      gameLifecycle: createGameLifecycleStore(() => callbackUnixTimeMillis),
      context: {
        ...scenario.room,
        roomId,
        roomName: policy.legacy ? scenario.room.roomName : roomId,
        tickRate: matching.tickRate,
        maxPlayers: policy.capacity,
        entryKind: accessKind === "private" ? "private" : policy.legacy ? scenario.room.entryKind : policy.mode === "room" ? "direct" : "matchmaking",
        matchKey: policy.legacy ? scenario.room.matchKey : policy.matchKey,
        matchMode: policy.legacy ? scenario.room.matchMode : policy.mode,
        ...(formation ? { roster: formationRoster(formation, generation), entryKind: "matchmaking" } : {}),
      },
    };
    configureRoomHost(createHost(room));
    const instance = new RoomType();
    room.instance = new Proxy(instance, { get(target, key) {
      const value = target[key];
      if (!["onCreate", "onJoin", "onReconnect", "onDisconnect", "onLeave", "onTick", "onDispose", "dispatchMessage", "driveGameData", "driveGameLifecycle", "driveAsync"].includes(key) || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return (...args) => invoke(room, () => {
        const result = value.apply(target, args);
        if (["onJoin", "onReconnect", "onTick", "dispatchMessage"].includes(key)) { target.driveOrderCallbacks(); target.driveCloudCallbacks(); }
        return result;
      });
    } });
    rooms.set(roomId, room);
    room.instance.context = room.context;
    prepareRoomCallback();
    room.instance.discardGameDataGeneration();
    try { room.instance.invokeSyncUserHook("onCreate", () => room.instance.onCreate(room.context)); } catch { /* Reported by invoke. */ }
    if (room.closed) return { error: "failed" };
    const lifecycleLoad = room.instance.loadGameRegistrations();
    if (!lifecycleLoad.ok) room.logger("warn", `game registration sync deferred: ${lifecycleLoad.error}`);
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_room_start", room_id: roomId, room_generation: generation, match_key: queueName(room), access_kind: accessKind })}\n`);
    return { room };
  }

  /** Reserve a Seat; the Seat counts toward capacity until the reservation, the player or the Room ends. */
  function reserveSeat(room, playerId) {
    room.leftPlayers.delete(playerId);
    room.seats.set(playerId, {
      playerId,
      seatId: `seat-${playerId}`,
      status: SEAT_STATUS.reserved,
      presenceEpoch: 0n,
      sessionId: "",
      reservedUntil: Date.now() + ticketGraceMs,
      deadlineAt: 0,
      everJoined: false,
    });
    room.emptySince = null;
    room.revision += 1;
  }

  /** Remove a Seat and the Ticket that pointed at it. */
  function removeSeat(room, playerId) {
    room.seats.delete(playerId);
    room.revision += 1;
    dropTicketFor(playerId, room.roomId);
    for (const session of sessions.values()) if (session.playerId === playerId && session.roomId === room.roomId) session.roomId = null;
  }

  function clientFor(room, seat) {
    return new room.Client(seat.sessionId, seat.playerId, seat.playerId, seat.seatId, seat.presenceEpoch);
  }

  /** Public Rooms that automatic Room-mode matchmaking may fill; fullest first keeps players together. */
  function bestPublicRoom(policy) {
    return [...rooms.values()]
      .filter((room) => !room.closed && room.policy === policy && room.accessKind === "public" && room.admission === "released" && available(room) > 0)
      .sort((left, right) => occupied(right) - occupied(left) || left.generation - right.generation)[0];
  }


  /** Public RoomDirectory projection; Worker routing and credentials never appear locally either. */
  function seatPayload(room, seat) {
    return {
      seat_id: seat.seatId,
      role_id: seat.playerId,
      team_index: Number(room.context.roster?.find((entry) => entry.userId === seat.playerId)?.teamId ?? 0) || 0,
      status: seat.status,
      presence_epoch: Number(seat.presenceEpoch),
    };
  }
  function directory(room) {
    const policy = room.policy;
    return {
      room_id: room.roomId,
      room_generation: room.generation,
      phase: room.closed ? "closed" : policy.mode === "room" || room.accessKind === "private" ? "open" : room.confirm ? "preparing" : "running",
      admission_state: room.admission,
      access_kind: room.accessKind,
      activity: {
        activity_id: scenario.room.activityId,
        game_id: scenario.room.gameId,
        queue_name: queueName(room),
        revision: 1,
        mode: policy.mode,
        room_player_num: policy.capacity,
        team_player_nums: Array.from({ length: policy.teamCount }, () => policy.teamSize),
        tick_rate: matching.tickRate,
        room_policy: {
          public_matchmaking: policy.publicMatchmaking,
          create_public_room: policy.createPublicRoom,
          private_rooms_enabled: policy.privateRoomsEnabled,
        },
      },
      capacity: policy.capacity,
      occupied: onlineSeats(room).length,
      occupied_seats: occupied(room),
      available_seats: available(room),
      seats: Object.fromEntries([...room.seats.values()].map((seat) => [seat.seatId, seatPayload(room, seat)])),
      created_at_millis: room.createdAtMillis,
      revision: room.revision,
      activity_revision: 1,
      room_revision: room.revision,
      transport: "local",
    };
  }
  function publicSummary(room) {
    return {
      room_id: room.roomId,
      room_generation: room.generation,
      phase: "open",
      admission_state: room.admission,
      capacity: room.policy.capacity,
      occupied_seats: occupied(room),
      available_seats: available(room),
      created_at_millis: room.createdAtMillis,
    };
  }

  /** Build the Ticket snapshot the client SDKs already understand. */
  function ticketPayload(record) {
    const { playerId, room } = record;
    const seat = room?.seats.get(playerId);
    return {
      ticket_id: record.ticketId,
      ticket_version: record.version,
      match_key: record.matchKey,
      mode: record.mode,
      status: record.status,
      activity_id: scenario.room.activityId,
      created_at_millis: record.createdAtMillis,
      match_deadline_at_millis: record.deadlineAt,
      ...(record.score !== undefined ? { rank_score: record.score } : {}),
      ...(record.terminalReason ? { terminal_reason: record.terminalReason } : {}),
      ...(room?.confirm && record.status === "room_ready" ? { confirm_deadline_at_millis: room.confirm.deadlineAt } : {}),
      ...(room && !TERMINAL_TICKET_STATUSES.has(record.status) && record.status !== "waiting" ? {
        assignment: {
          assignment_id: record.round > 1 ? `local-assignment-${playerId}-${record.round}` : `local-assignment-${playerId}`,
          transport: "local",
          match_id: "local-match",
          round_id: record.round > 1 ? `local-round-${record.round}` : "local-round",
          room_id: room.roomId,
          room_generation: room.generation,
          generation: room.generation,
          presence_epoch: Number(seat?.presenceEpoch ?? 0n),
        },
      } : {}),
    };
  }
  function updateTicket(record, changes) {
    Object.assign(record, changes, { version: record.version + 1 });
    record.roomId = record.room?.roomId;
    const session = sessionOf(record.playerId);
    if (session) sendControl(session.socket, "match_ticket_updated", ticketPayload(record));
  }

  /** Retry waiting Tickets: Room-mode placement after Rooms release or empty, Pool/RankPool formation otherwise. */
  function admitWaitingTickets() {
    for (const record of tickets.values()) {
      if (record.status !== "waiting") continue;
      if (Date.now() >= record.deadlineAt) { updateTicket(record, { status: "timeout", terminalReason: "match_deadline", room: undefined }); continue; }
      if (seatRoomOf(record.playerId) || (matching.strict && record.policy.mode !== "room")) continue;
      let room = bestPublicRoom(record.policy);
      if (!room && record.allowCreate && record.policy.createPublicRoom) room = createRoom(record.policy, "public").room;
      if (!room) continue;
      reserveSeat(room, record.playerId);
      updateTicket(record, { status: "room_ready", room });
    }
    for (const policy of matching.policies.values()) if (matching.strict && policy.mode !== "room") formPoolRooms(policy);
  }

  /** Form as many Pool/RankPool Rooms as the waiting Tickets allow; each Room then waits for every human (allMembers Confirm). */
  function formPoolRooms(policy) {
    for (;;) {
      // Players may wait for a Pool Room while still in another Room; they must leave it before entering the new one.
      const waiting = [...tickets.values()].filter((record) => record.policy === policy && record.status === "waiting");
      const formation = formMatch(policy, waiting.map((record) => ({ playerId: record.playerId, createdAtMillis: record.createdAtMillis, score: record.score ?? 0 })), Date.now());
      if (!formation) return;
      const created = createRoom(policy, "public", formation);
      if (!created.room) return;
      const room = created.room;
      const deadlineAt = Date.now() + Math.min(policy.confirmTimeoutSeconds * 1000, LOCAL_CONFIRM_WINDOW_CAP_MS);
      room.confirm = { deadlineAt, pending: new Map() };
      for (const team of formation.teams) {
        for (const playerId of team.playerIds) {
          reserveSeat(room, playerId);
          room.seats.get(playerId).reservedUntil = Number.POSITIVE_INFINITY;
        }
      }
      for (const team of formation.teams) for (const playerId of team.playerIds) updateTicket(tickets.get(playerId), { status: "room_ready", room });
      process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_match_formed", room_id: room.roomId, match_key: policy.matchKey, humans: room.seats.size, bots: room.botCount, confirm_deadline_at_millis: deadlineAt })}\n`);
    }
  }

  /** Every human arrived: hand the whole roster to the Room at once, then answer the waiting joins. */
  function commitRoom(room) {
    const pending = [...room.confirm.pending.entries()].sort((left, right) => left[1].arrivedAt - right[1].arrivedAt);
    room.confirm = null;
    for (const [playerId] of pending) {
      const seat = room.seats.get(playerId);
      if (!seat || room.closed) continue;
      seat.status = SEAT_STATUS.online;
      seat.everJoined = true;
      prepareRoomCallback();
      const client = clientFor(room, seat);
      safely(room, (instance) => instance.onJoin(client), playerId);
    }
    for (const [playerId, arrival] of pending) {
      const session = sessions.get(arrival.sessionId);
      if (!session) continue;
      if (room.closed) { roomError(session.socket, arrival.requestId, "ROOM_NOT_FOUND", "Local Room closed while joining"); continue; }
      answerJoined(room, session, arrival.requestId);
    }
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_match_committed", room_id: room.roomId, humans: pending.length })}\n`);
  }

  /** Confirm deadline passed: absent players' Tickets end, arrived players go back to the queue with their original age. */
  function rollbackRoom(room) {
    for (const seat of room.seats.values()) {
      const record = tickets.get(seat.playerId);
      const arrival = room.confirm.pending.get(seat.playerId);
      if (arrival) {
        const session = sessions.get(arrival.sessionId);
        if (record) updateTicket(record, { status: "waiting", room: undefined, round: record.round + 1 });
        if (session) {
          session.roomId = null;
          roomError(session.socket, arrival.requestId, "MATCH_ASSIGNMENT_STALE", "Confirm timed out; the Ticket returned to the queue");
        }
      } else if (record) {
        updateTicket(record, { status: "confirm_timeout", terminalReason: "confirm_deadline", room: undefined });
      }
    }
    room.confirm = null;
    const instance = room.instance;
    prepareRoomCallback();
    instance.discardGameDataGeneration();
    try { instance.invokeSyncUserHook("onDispose", () => instance.onDispose("shutdown")); } catch { /* Reported by invoke. */ }
    detachRoom(room);
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_room_dispose", room_id: room.roomId, room_generation: room.generation, reason: "confirm_timeout" })}\n`);
  }

  /** A pending arrival that disconnects or leaves before commit no longer counts as arrived. */
  function withdrawArrival(room, playerId) {
    const seat = room.seats.get(playerId);
    if (!room.confirm || seat?.status !== SEAT_STATUS.pending) return false;
    room.confirm.pending.delete(playerId);
    seat.status = SEAT_STATUS.reserved;
    seat.sessionId = "";
    return true;
  }

  /** Advance reservations, reconnect windows, empty-Room grace and waiting Tickets for every Room. */
  function sweepRooms(now = Date.now()) {
    for (const room of [...rooms.values()]) {
      if (room.confirm) {
        if (now >= room.confirm.deadlineAt) rollbackRoom(room);
        continue;
      }
      for (const seat of [...room.seats.values()]) {
        if (room.closed) break;
        if (seat.status === SEAT_STATUS.reserved && seat.reservedUntil <= now) removeSeat(room, seat.playerId);
        else if (seat.status === SEAT_STATUS.offline && seat.deadlineAt <= now) {
          const client = clientFor(room, seat);
          removeSeat(room, seat.playerId);
          prepareRoomCallback();
          safely(room, (instance) => instance.onLeave(client, "reconnect_timeout"), seat.playerId);
        }
      }
      if (room.closed) continue;
      if (room.seats.size > 0) { room.emptySince = null; continue; }
      if (room.emptySince === null) { room.emptySince = now; continue; }
      if (now - room.emptySince >= emptyRoomGraceMs) reapEmptyRoom(room);
    }
    admitWaitingTickets();
  }

  const httpServer = createServer((request, response) => {
    const body = request.url === "/health" ? {
      status: "ok", last_resource_error: lastResourceError, resource_diagnostics: diagnostics.report(), implementation: "typescript-room-mock", room_runtime: "language_mock", transport: "local_mock_websocket",
      lifecycle: rooms.size > 0 ? "active" : "idle", active_rooms: rooms.size, room_generation: latestGeneration, remaining_rooms: roomLimit - roomsStarted, connected_clients: sessions.size,
      rooms: [...rooms.values()].map((room) => ({ room_id: room.roomId, room_generation: room.generation, match_key: queueName(room), mode: room.policy.mode, access_kind: room.accessKind, admission_state: room.admission, capacity: room.policy.capacity, occupied_seats: occupied(room), online_players: onlineSeats(room).length, bots: room.botCount, confirming: Boolean(room.confirm) })),
      waiting_tickets: [...tickets.values()].filter((record) => record.status === "waiting").length,
    } : request.url === "/config" ? {
      environment: "local", mode: "room_mock", resource_limits: LIMITS, resource_policy: "warn", timed_quota_headroom: 1.25, enforces_host_budgets: false, observes_host_budgets: true, checks_checkpoint_payload: true, enforces_network_quotas: false, observes_network_quotas: true, simulates_wasm_memory: false, simulates_cpu_fuel: false, implementation: "typescript-room-mock", room_id: scenario.room.roomId, game_id: scenario.room.gameId, executes_room_source: true, builds_wasm: false, room_runtime: "language_mock", transport: "local_mock_websocket", uses_webrtc: false, simulates_real_auth: false, simulates_matchmaking: false, simulates_party: false, simulates_lobby: false, simulates_invites: false, provides_security_isolation: false, simulates_cloud_state: true, simulates_ext_pay: true, lazy_room_initialization: true, automatic_empty_room_reaping: true, reconnect_grace_ms: reconnectGraceMs, ticket_grace_ms: ticketGraceMs, empty_room_grace_ms: emptyRoomGraceMs, max_sequential_rooms: roomLimit,
      simulates_room_directory: true, simulates_private_rooms: true, max_concurrent_rooms: maxActiveRooms, online_config_loaded: matching.strict,
      simulates_pool_formation: matching.strict, simulates_confirm: matching.strict, simulates_bot_fill: matching.strict, confirm_window_cap_ms: LOCAL_CONFIRM_WINDOW_CAP_MS,
      match_keys: [...matching.policies.values()].map((policy) => ({ match_key: policy.matchKey, mode: policy.mode, capacity: policy.capacity, public_matchmaking: policy.publicMatchmaking, create_public_room: policy.createPublicRoom, private_rooms_enabled: policy.privateRoomsEnabled })),
    } : null;
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  });
  const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 16 * 1024 * 1024 });
  websocketServer.on("connection", (socket) => {
    const sessionId = `local-session-${crypto.randomUUID()}`;
    const session = { socket, sessionId, playerId: "", roomId: null };
    sessions.set(sessionId, session);
    socket.on("message", (data) => {
      let request;
      try {
        request = JSON.parse(data.toString());
        handleRequest(request, session);
      } catch (error) {
        sendControl(socket, "error", { code: 3, error_code: error.code, message: error instanceof Error ? error.message : String(error) }, request?.request_id ?? "");
      }
    });
    socket.on("close", () => {
      const room = session.roomId ? rooms.get(session.roomId) : undefined;
      const seat = room?.seats.get(session.playerId);
      if (room && seat?.sessionId === sessionId) withdrawArrival(room, session.playerId);
      if (room && seat?.status === SEAT_STATUS.online && seat.sessionId === sessionId) {
        seat.status = SEAT_STATUS.offline;
        seat.deadlineAt = Date.now() + reconnectGraceMs;
        prepareRoomCallback();
        safely(room, (instance) => instance.onDisconnect(clientFor(room, seat), "control_disconnected", BigInt(seat.deadlineAt)), seat.playerId);
      }
      sessions.delete(sessionId);
      sweepRooms();
    });
  });

  /** Room-mode and legacy Admission: Room ID direct join, automatic placement, or a waiting Ticket. */
  function admitRoomMode(session, policy, payload, requestId) {
    const targetRoomId = String(payload.target_room_id ?? "");
    if (targetRoomId) {
      const room = rooms.get(targetRoomId);
      if (!room || room.closed) return { error: () => roomError(session.socket, requestId, "ROOM_NOT_FOUND", "Room does not exist") };
      if (!(room.accessKind === "private" || room.policy.mode === "room")) return { error: () => roomError(session.socket, requestId, "ROOM_NOT_JOINABLE", "Room does not accept Room ID admission") };
      if (room.policy !== policy) return { error: () => roomError(session.socket, requestId, "ROOM_ADMISSION_INVALID", "Room belongs to a different matchKey") };
      if (available(room) === 0) return { error: () => roomError(session.socket, requestId, "ROOM_FULL", "Room is full") };
      return { room };
    }
    if (!policy.publicMatchmaking) return { error: () => invalid(session.socket, requestId, "Match Activity does not enable public matchmaking") };
    let room = bestPublicRoom(policy);
    if (!room && payload.allow_create !== false && policy.createPublicRoom) {
      const created = createRoom(policy, "public");
      if (created.error === "total" || created.error === "active") return { error: () => limitError(session.socket, requestId, created.error) };
      room = created.room;
    }
    return { room };
  }

  function admit(session, type, payload, requestId) {
    const socket = session.socket;
    const mode = type.slice("match_join_".length);
    const requestedKey = String(payload.match_key ?? "");
    const policy = matching.resolve(requestedKey);
    if (!policy) return invalid(socket, requestId, `Match Activity does not exist: ${requestedKey}`, "MATCH_ACTIVITY_NOT_FOUND");
    if (matching.strict && policy.mode !== mode) return invalid(socket, requestId, `matchKey ${policy.matchKey} uses ${policy.mode} mode`, "ROOM_ADMISSION_MODE_FORBIDDEN");
    const existing = tickets.get(session.playerId);
    const idempotencyKey = String(payload.idempotency_key ?? "");
    const sameAdmission = existing && existing.policy === policy && existing.mode === mode;
    // Replays of the same Admission return the existing Ticket instead of creating a second one.
    if (sameAdmission && idempotencyKey && existing.idempotencyKey === idempotencyKey) return sendControl(socket, "match_ticket", ticketPayload(existing), requestId);
    if (existing && BLOCKING_TICKET_STATUSES.has(existing.status)) {
      if (sameAdmission) return sendControl(socket, "match_ticket", ticketPayload(existing), requestId);
      return roomError(socket, requestId, "MATCH_ROLE_BUSY", "The player already has an active Ticket");
    }
    // A player still in a Room may queue; Room-mode placement waits until that Room is left.
    const seated = Boolean(seatRoomOf(session.playerId));
    let room;
    if (seated && (mode === "room" || !matching.strict)) {
      if (payload.target_room_id) return roomError(socket, requestId, "ROOM_ROLE_BINDING_BUSY", "Leave the current Room before joining another Room by ID");
      if (!policy.publicMatchmaking) return invalid(socket, requestId, "Match Activity does not enable public matchmaking");
    } else if (mode === "room" || !matching.strict) {
      const placement = admitRoomMode(session, policy, payload, requestId);
      if (placement.error) return placement.error();
      room = placement.room;
    } else {
      if (payload.party_id !== undefined || payload.member_rank_scores !== undefined) return sendControl(socket, "error", { code: 18, message: "LOCAL_PLATFORM_API_NOT_SIMULATED: the local Mock does not simulate Party, Lobby or invites" }, requestId);
      if (payload.rank_score !== undefined && (!Number.isInteger(payload.rank_score) || payload.rank_score < 0 || payload.rank_score > MAX_SAFE_RANK_SCORE)) return invalid(socket, requestId, "rank_score must be an integer from 0 to 9007199254740991");
    }
    if (room?.closed) return roomError(socket, requestId, "ROOM_INTERNAL", "Room failed during creation");
    if (room) reserveSeat(room, session.playerId);
    const record = {
      playerId: session.playerId,
      policy,
      mode,
      matchKey: policy.legacy ? (requestedKey || policy.matchKey) : policy.matchKey,
      status: room ? "room_ready" : "waiting",
      room,
      roomId: room?.roomId,
      version: 1,
      allowCreate: payload.allow_create !== false,
      createdAtMillis: Date.now(),
      deadlineAt: Date.now() + policy.maxMatchSeconds * 1000,
      round: 1,
      idempotencyKey,
      ...(mode === "rank_pool" ? { score: payload.rank_score ?? 0 } : {}),
    };
    const sequence = (ticketSequences.get(session.playerId) ?? 0) + 1;
    ticketSequences.set(session.playerId, sequence);
    record.ticketId = sequence === 1 ? `local-ticket-${session.playerId}` : `local-ticket-${session.playerId}-${sequence}`;
    tickets.set(session.playerId, record);
    if (ticketsById.size >= TICKET_HISTORY_LIMIT) ticketsById.delete(ticketsById.keys().next().value);
    ticketsById.set(record.ticketId, record);
    sendControl(socket, "match_ticket_updated", ticketPayload(record));
    if (matching.strict && mode !== "room") formPoolRooms(policy);
    return sendControl(socket, "match_ticket", ticketPayload(record), requestId);
  }

  /** Find the caller's Ticket by public ID. */
  function ownTicket(session, payload) {
    const record = ticketsById.get(String(payload.ticket_id ?? ""));
    return record?.playerId === session.playerId ? record : undefined;
  }

  function createPrivateRoom(session, payload, requestId) {
    const socket = session.socket;
    const key = String(payload.idempotency_key ?? "");
    const policy = matching.resolve(String(payload.match_key ?? ""));
    if (!key.trim() || key.length > 128 || !policy) return invalid(socket, requestId, "Private Room parameters are invalid");
    if (!policy.privateRoomsEnabled) return invalid(socket, requestId, "Match Activity does not enable private Rooms");
    const replayKey = `${session.playerId.length}:${session.playerId}:${key}`;
    const replay = privateCreates.get(replayKey);
    const replayRoom = replay ? rooms.get(replay) : undefined;
    const replaySeat = replayRoom?.seats.get(session.playerId);
    if (replayRoom && replaySeat) return sendControl(socket, "room_private_created", { room: directory(replayRoom), creator_seat: seatPayload(replayRoom, replaySeat) }, requestId);
    const existing = tickets.get(session.playerId);
    if (seatRoomOf(session.playerId) || (existing && BLOCKING_TICKET_STATUSES.has(existing.status))) return roomError(socket, requestId, "ROOM_ROLE_BINDING_BUSY", "The player already holds a Seat or an active Ticket");
    const created = createRoom(policy, "private");
    if (created.error === "total" || created.error === "active") return limitError(socket, requestId, created.error);
    if (!created.room) return roomError(socket, requestId, "ROOM_INTERNAL", "Room failed during creation");
    const room = created.room;
    reserveSeat(room, session.playerId);
    if (privateCreates.size >= PRIVATE_CREATE_REPLAY_LIMIT) privateCreates.delete(privateCreates.keys().next().value);
    privateCreates.set(replayKey, room.roomId);
    return sendControl(socket, "room_private_created", { room: directory(room), creator_seat: seatPayload(room, room.seats.get(session.playerId)) }, requestId);
  }

  /** Resolve the Room a local transport message targets; older clients without IDs use their current Room. */
  function targetRoom(session, payload, field) {
    const roomId = String(payload[field] ?? payload.room_id ?? payload.match_id ?? "");
    if (roomId) return rooms.get(roomId);
    return session.roomId ? rooms.get(session.roomId) : seatRoomOf(session.playerId);
  }

  function joinLocalRoom(session, payload, requestId) {
    const socket = session.socket;
    let room = targetRoom(session, payload, "room_id");
    if (!room && !payload.room_id && !matching.strict) {
      // Older local flows join without a Ticket; keep placing them into the shared public Room.
      const placement = admitRoomMode(session, matching.resolve(""), {}, requestId);
      if (placement.error) return placement.error();
      room = placement.room;
    }
    if (!room || room.closed) return roomError(socket, requestId, "ROOM_NOT_FOUND", "Local Room does not exist; join a Room first");
    // One Seat at a time: leave the old Room (and wait for success) before entering a new one.
    if (occupiedRoomOf(session.playerId, room)) return roomError(socket, requestId, "ROOM_ROLE_BINDING_BUSY", "Leave the current Room before entering another Room");
    let seat = room.seats.get(session.playerId);
    if (!seat) {
      const other = seatRoomOf(session.playerId);
      if (other) return roomError(socket, requestId, "ROOM_ROLE_BINDING_BUSY", "The player already holds a Seat in another Room");
      // An old Ticket or handle cannot bring a player back after an active leave; online rejects it too.
      if (payload.room_id && room.leftPlayers.has(session.playerId)) return roomError(socket, requestId, "ROOM_PRESENCE_STALE", "The player left this Room; a new Ticket is required to enter it again");
      if (!(room.accessKind === "private" || room.policy.mode === "room")) return roomError(socket, requestId, "ROOM_NOT_JOINABLE", "Room does not accept Room ID admission");
      if (available(room) === 0) return roomError(socket, requestId, "ROOM_FULL", "Room is full");
      reserveSeat(room, session.playerId);
      seat = room.seats.get(session.playerId);
    }
    if (room.confirm) {
      // allMembers Confirm: the arrival is ConnectedPending; the Room sees nobody until every human has arrived.
      if (seat.status === SEAT_STATUS.pending && seat.sessionId !== session.sessionId) withdrawArrival(room, session.playerId);
      seat.status = SEAT_STATUS.pending;
      seat.sessionId = session.sessionId;
      session.roomId = room.roomId;
      const previous = room.confirm.pending.get(session.playerId);
      room.confirm.pending.set(session.playerId, { sessionId: session.sessionId, requestId, arrivedAt: previous?.arrivedAt ?? performance.now() });
      rawEnvelope(room, socket, "control-reliable", "match_connection_pending", encodeJson({ room_id: room.roomId, confirm_deadline_at_millis: room.confirm.deadlineAt }));
      if ([...room.seats.values()].every((value) => value.status === SEAT_STATUS.pending)) commitRoom(room);
      return undefined;
    }
    if (!(seat.status === SEAT_STATUS.online && seat.sessionId === session.sessionId)) {
      const reconnecting = seat.everJoined;
      if (reconnecting) seat.presenceEpoch += 1n;
      seat.status = SEAT_STATUS.online;
      seat.sessionId = session.sessionId;
      seat.everJoined = true;
      session.roomId = room.roomId;
      room.emptySince = null;
      room.revision += 1;
      prepareRoomCallback();
      const client = clientFor(room, seat);
      safely(room, (instance) => reconnecting ? instance.onReconnect(client) : instance.onJoin(client), session.playerId);
      if (room.closed) return roomError(socket, requestId, "ROOM_NOT_FOUND", "Local Room closed while joining");
    }
    return answerJoined(room, session, requestId);
  }

  /**
   * Send the current state, answer the local join, then confirm the Ticket.
   * Online the `confirmed` push arrives after the join, when the client already holds the Room handle.
   */
  function answerJoined(room, session, requestId) {
    const seat = room.seats.get(session.playerId);
    session.roomId = room.roomId;
    const record = tickets.get(session.playerId);
    if (room.state !== null) pushEnvelope(room, session, "control-reliable", "state", new TextEncoder().encode(JSON.stringify(room.state)));
    const answer = sendControl(session.socket, "local_room_joined", {
      match_id: "local-match",
      room_id: room.roomId,
      generation: room.generation,
      session_id: session.sessionId,
      presence_epoch: Number(seat?.presenceEpoch ?? 0n),
      presences: onlineSessions(room).map((value) => ({ user_id: value.playerId, session_id: value.sessionId, username: value.playerId, status: "online" })),
      transport: "local",
    }, requestId);
    if (record?.roomId === room.roomId && record.status === "room_ready") updateTicket(record, { status: "confirmed" });
    return answer;
  }

  /** Handle the local control protocol the client SDKs already speak. */
  function handleRequest(request, session) {
    const socket = session.socket;
    const type = request.type;
    const payload = request.payload ?? {};
    const requestId = request.request_id ?? "";
    if (type === "ping") return sendControl(socket, "pong", {}, requestId);
    if (type === "auth") {
      const token = String(payload.token ?? "");
      const playerId = token.startsWith("local:") ? token.slice("local:".length) : "";
      if (!playerId || payload.game_id !== scenario.room.gameId) return sendControl(socket, "error", { code: 16, message: "Local identity or game_id is invalid" }, requestId);
      if ([...sessions.values()].some((value) => value !== session && value.playerId === playerId)) return sendControl(socket, "error", { code: 16, message: "The same local identity is already online" }, requestId);
      session.playerId = playerId;
      return sendControl(socket, "auth", { user_id: playerId, session_id: session.sessionId, game_id: scenario.room.gameId, online_compatibility_revision: 1, expires_at_unix_seconds: 0, environment: "local" }, requestId);
    }
    if (!session.playerId) return sendControl(socket, "error", { code: 16, message: "Local authentication is required" }, requestId);
    if (["match_join_room", "match_join_pool", "match_join_rank_pool"].includes(type)) return admit(session, type, payload, requestId);
    if (type === "match_ticket_get" || type === "match_ticket_heartbeat") {
      const record = ownTicket(session, payload);
      if (!record) return sendControl(socket, "error", { code: 17, message: "Local Ticket does not exist" }, requestId);
      const seat = record.room?.seats.get(session.playerId);
      if (type === "match_ticket_heartbeat" && seat?.status === SEAT_STATUS.reserved) seat.reservedUntil = Date.now() + ticketGraceMs;
      return sendControl(socket, "match_ticket", ticketPayload(record), requestId);
    }
    if (type === "match_ticket_cancel") {
      const record = ownTicket(session, payload);
      if (!record) return sendControl(socket, "error", { code: 17, message: "Local Ticket does not exist" }, requestId);
      const version = payload.ticket_version === undefined ? record.version : Number(payload.ticket_version);
      if (record.status === "cancelled" && version === record.version) return sendControl(socket, "match_ticket", ticketPayload(record), requestId);
      if (version !== record.version) return roomError(socket, requestId, "MATCH_TICKET_STALE", "Ticket version is stale");
      if (record.status !== "waiting") return roomError(socket, requestId, "MATCH_ASSIGNMENT_STALE", "Ticket has entered formation or a terminal state");
      updateTicket(record, { status: "cancelled", terminalReason: "client_cancelled", room: undefined });
      return sendControl(socket, "match_ticket", ticketPayload(record), requestId);
    }
    if (type === "room_get") {
      const room = targetRoom(session, payload, "room_id");
      if (!room) return roomError(socket, requestId, "ROOM_NOT_FOUND", "Room does not exist or belongs to a different game");
      return sendControl(socket, "room", directory(room), requestId);
    }
    if (type === "room_list") {
      const policy = matching.resolve(String(payload.match_key ?? ""));
      if (!policy) return invalid(socket, requestId, "Match Activity does not exist", "MATCH_ACTIVITY_NOT_FOUND");
      if (policy.mode !== "room" || !policy.publicMatchmaking) return invalid(socket, requestId, "Match Activity does not enable public Rooms");
      const limit = Math.min(100, Math.max(1, Number.isInteger(payload.limit) ? payload.limit : 20));
      const listed = [...rooms.values()]
        .filter((room) => !room.closed && room.policy === policy && room.accessKind === "public" && room.admission === "released" && available(room) > 0)
        .sort((left, right) => left.generation - right.generation)
        .slice(0, limit)
        .map(publicSummary);
      return sendControl(socket, "room_list", { rooms: listed }, requestId);
    }
    if (type === "room_private_create") return createPrivateRoom(session, payload, requestId);
    if (type === "room_credential") {
      const room = targetRoom(session, payload, "room_id");
      const seat = room?.seats.get(session.playerId);
      if (!room || !seat) return roomError(socket, requestId, "ROOM_SEAT_NOT_COMMITTED", "The player has no Seat in this Room");
      if (seat.status === SEAT_STATUS.reserved) seat.reservedUntil = Date.now() + ticketGraceMs;
      return sendControl(socket, "room_credential", { credential: { room_id: room.roomId, room_generation: room.generation, seat_id: seat.seatId, role_id: session.playerId, session_id: session.sessionId, expires_at_millis: Date.now() + ticketGraceMs, presence_epoch: Number(seat.presenceEpoch), transport: "local" }, transport: "local" }, requestId);
    }
    if (type === "local_room_join") return joinLocalRoom(session, payload, requestId);
    if (type === "local_room_data") {
      const envelope = decodeRoomFrame(String(payload.frame_base64 ?? ""));
      const room = targetRoom(session, payload, "match_id");
      const seat = room?.seats.get(session.playerId);
      if (!room || seat?.status !== SEAT_STATUS.online || seat.sessionId !== session.sessionId) return sendControl(socket, "error", { code: 17, message: "Current player has not joined the local Room" }, requestId);
      if (envelope.type === "__cysj_transport_ping") pushEnvelope(room, session, "control-reliable", "__cysj_transport_pong", envelope.payload);
      else if (trafficAllowed(room, session, "upstream", 14 + Buffer.byteLength(envelope.type) + envelope.payload.length)) {
        prepareRoomCallback();
        safely(room, (instance) => instance.dispatchMessage(clientFor(room, seat), String(envelope.type ?? ""), envelope.payload), session.playerId);
      }
      return sendControl(socket, "local_room_data_sent", { room_id: room.roomId }, requestId);
    }
    if (type === "local_room_leave") {
      const room = targetRoom(session, payload, "match_id");
      if (room?.confirm) {
        // Leaving before every human arrived only withdraws this arrival; the Confirm deadline decides the Ticket.
        withdrawArrival(room, session.playerId);
        if (session.roomId === room.roomId) session.roomId = null;
        return sendControl(socket, "local_room_left", { room_id: room.roomId }, requestId);
      }
      const seat = room?.seats.get(session.playerId);
      if (room && seat && (seat.status !== SEAT_STATUS.online || seat.sessionId === session.sessionId)) {
        const client = clientFor(room, seat);
        removeSeat(room, session.playerId);
        room.leftPlayers.add(session.playerId);
        if (seat.everJoined) {
          prepareRoomCallback();
          safely(room, (instance) => instance.onLeave(client, "client_leave"), session.playerId);
        }
      }
      if (room && session.roomId === room.roomId) session.roomId = null;
      sweepRooms();
      return sendControl(socket, "local_room_left", { room_id: room?.roomId ?? String(payload.match_id ?? "") }, requestId);
    }
    if (type.startsWith("party_") || type.startsWith("lobby_") || type.startsWith("room_invite_")) return sendControl(socket, "error", { code: 18, message: "LOCAL_PLATFORM_API_NOT_SIMULATED: the local Mock does not simulate Party, Lobby or invites" }, requestId);
    return sendControl(socket, "error", { code: 3, message: `Room Mock does not support message: ${type}` }, requestId);
  }

  const tickDeltaMs = Math.round(1000 / matching.tickRate);
  const interval = setInterval(() => {
    try {
      if (rooms.size > 0) gameData.advanceManagedQueueEnsures();
      for (const room of [...rooms.values()]) {
        safely(room, (instance) => {
          instance.driveGameData();
          instance.driveGameLifecycle();
          instance.invokeSyncUserHook("onTick", () => instance.onTick(tickDeltaMs));
        });
      }
      sweepRooms();
      for (const room of rooms.values()) {
        if (room.closed || !room.instance || performance.now() - room.lastCheckpoint < 5000) continue;
        room.lastCheckpoint = performance.now();
        room.checkpointing = true;
        prepareRoomCallback();
        try { checkSnapshot(room.instance.onCheckpoint("periodic")); }
        catch (error) { warn(error instanceof ResourceError ? error : new ResourceError("ROOM_STATE_INVALID", "checkpoint_callback", 1, 0)); }
        finally { room.checkpointing = false; }
      }
    } catch { /* User callback failure is reported by invoke. */ }
  }, tickDeltaMs);
  await new Promise((resolvePromise, reject) => httpServer.listen(options.port, options.host, (error) => error ? reject(error) : resolvePromise()));
  const boundPort = httpServer.address().port;
  process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_start", diagnostics_url: `http://${options.host === "::1" ? "[::1]" : options.host}:${boundPort}/health`, resource_policy: "warn", room_id: scenario.room.roomId, bind: `${options.host}:${boundPort}`, room_runtime: "language_mock", transport: "local_mock_websocket", match_keys: [...matching.policies.keys()], max_concurrent_rooms: maxActiveRooms })}\n`);
  const close = async () => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    clearInterval(interval);
    for (const room of [...rooms.values()]) {
      const instance = room.instance;
      if (!instance) continue;
      prepareRoomCallback();
      try {
        instance.discardGameDataGeneration();
        instance.invokeSyncUserHook("onDispose", () => instance.onDispose("shutdown"));
      } catch { /* Shutdown continues for the remaining Rooms. */ }
      detachRoom(room);
    }
    // Writes queued by onDispose are kept, as the platform keeps them after a Room ends.
    economy.drainWrites();
    websocketServer.close();
    await new Promise((resolvePromise) => httpServer.close(resolvePromise));
    await options.module.cleanup();
  };
  const stop = () => close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { close, port: boundPort };
}
