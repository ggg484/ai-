import { readFileSync } from "node:fs";

const TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const MODES = new Set(["room", "pool", "rank_pool"]);
const MAX_ROOM_CAPACITY = 50;

/** Read a boolean with the same defaults the deploy tool applies; reject non-boolean values. */
function booleanField(entry, name, fallback, matchKey) {
  const value = entry[name];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`matchKeys.${matchKey}.${name} must be a boolean`);
  return value;
}

/** Read a positive integer field and fail with a stable configuration message. */
function positiveInteger(entry, name, label) {
  const value = entry[name];
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}.${name} must be a positive integer`);
  return value;
}

const DEFAULT_MAX_MATCH_SECONDS = 30 * 60;

/** Read an optional integer with a default; booleans and fractions are rejected. */
function integerField(entry, name, fallback, label) {
  const value = entry[name] ?? fallback;
  if (typeof value === "boolean" || !Number.isInteger(value)) throw new Error(`${label}.${name} must be an integer`);
  return value;
}

/** RankPool window stages: explicit stages or the deploy tool's bounded three-stage default. */
function rankStages(entry, mode, maxScoreDiff, maxMatchSeconds, label) {
  const value = entry.expansionStages;
  if (mode !== "rank_pool") {
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) throw new Error(`${label}: only rank_pool may configure expansionStages`);
    return [];
  }
  if (value === undefined || value === null) {
    const stages = [[0, Math.max(1, Math.floor(maxScoreDiff / 4))]];
    if (maxMatchSeconds > 2 && maxScoreDiff > stages.at(-1)[1] + 1) {
      stages.push([Math.max(1, Math.floor(maxMatchSeconds / 3)), Math.max(stages.at(-1)[1] + 1, Math.floor(maxScoreDiff / 2))]);
    }
    const finalWait = Math.floor(maxMatchSeconds * 2 / 3);
    if (maxScoreDiff > stages.at(-1)[1] && finalWait > stages.at(-1)[0]) stages.push([finalWait, maxScoreDiff]);
    else if (maxScoreDiff !== stages.at(-1)[1]) stages[stages.length - 1] = [stages.at(-1)[0], maxScoreDiff];
    return stages.map(([waitSeconds, scoreDiff]) => ({ waitSeconds, maxScoreDiff: scoreDiff }));
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new Error(`${label}.expansionStages must be an array with 1 to 16 entries`);
  const stages = value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${label}.expansionStages[${index}] must be an object`);
    const waitSeconds = integerField(item, "waitSeconds", -1, `${label}.expansionStages[${index}]`);
    const scoreDiff = integerField(item, "maxScoreDiff", -1, `${label}.expansionStages[${index}]`);
    if (waitSeconds < 0 || scoreDiff <= 0) throw new Error(`${label}.expansionStages[${index}] needs waitSeconds >= 0 and a positive maxScoreDiff`);
    return { waitSeconds, maxScoreDiff: scoreDiff };
  });
  if (stages[0].waitSeconds !== 0) throw new Error(`${label}: the first expansion-stage waitSeconds must be 0`);
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index - 1].waitSeconds >= stages[index].waitSeconds || stages[index - 1].maxScoreDiff >= stages[index].maxScoreDiff) {
      throw new Error(`${label}: expansion stage waitSeconds and maxScoreDiff must be strictly increasing`);
    }
  }
  if (stages.at(-1).maxScoreDiff !== maxScoreDiff) throw new Error(`${label}: the final expansion stage must reach maxScoreDiff`);
  if (stages.at(-1).waitSeconds >= maxMatchSeconds) throw new Error(`${label}: expansion stages must complete before maxMatchSeconds`);
  return stages;
}

/** Bot fill policy with the deploy tool's validation. */
function botPolicy(value, capacity, label) {
  if (value === undefined || value === null) return { enabled: false, defaultFillAfterSeconds: null, minimumHumanPlayers: 1, maximumBotRatio: 0 };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}.botPolicy must be an object`);
  const enabled = value.enabled ?? false;
  if (typeof enabled !== "boolean") throw new Error(`${label}.botPolicy.enabled must be a boolean`);
  const defaultFill = value.defaultFillAfterSeconds ?? null;
  if (defaultFill !== null && (!Number.isInteger(defaultFill) || defaultFill < 0)) throw new Error(`${label}.botPolicy.defaultFillAfterSeconds must be a non-negative integer or null`);
  const minimumFill = integerField(value, "minimumFillAfterSeconds", 0, `${label}.botPolicy`);
  const maximumFill = integerField(value, "maximumFillAfterSeconds", 0, `${label}.botPolicy`);
  const minimumHumanPlayers = integerField(value, "minimumHumanPlayers", 1, `${label}.botPolicy`);
  const maximumBotRatio = value.maximumBotRatio ?? 0;
  if (typeof maximumBotRatio !== "number") throw new Error(`${label}.botPolicy.maximumBotRatio must be a number`);
  if (enabled) {
    if (defaultFill === null) throw new Error(`${label}.botPolicy.defaultFillAfterSeconds is required when botPolicy.enabled is true`);
    if (minimumFill < 0 || minimumFill > maximumFill || defaultFill < minimumFill || defaultFill > maximumFill) throw new Error(`${label}.botPolicy fill-delay range is invalid`);
    if (minimumHumanPlayers <= 0 || minimumHumanPlayers >= capacity) throw new Error(`${label}.botPolicy.minimumHumanPlayers exceeds Room capacity`);
    if (!(1 / capacity <= maximumBotRatio && maximumBotRatio < 1)) throw new Error(`${label}.botPolicy.maximumBotRatio must allow at least one bot and be less than 1`);
  } else if (defaultFill !== null) {
    throw new Error(`${label}.botPolicy.defaultFillAfterSeconds cannot be set when botPolicy is disabled`);
  }
  return { enabled, defaultFillAfterSeconds: defaultFill, minimumHumanPlayers, maximumBotRatio };
}

/** Freeze the local view of one matchKey; only fields the local Room directory and local matchmaking use are kept. */
function matchPolicy(matchKey, entry) {
  if (!TOKEN.test(matchKey)) throw new Error(`Invalid matchKey: ${matchKey}`);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`matchKeys.${matchKey} must be an object`);
  const label = `matchKeys.${matchKey}`;
  const mode = entry.mode;
  if (!MODES.has(mode)) throw new Error(`${label}.mode must be room, pool, or rank_pool`);
  const teamCount = positiveInteger(entry, "teamCount", label);
  const teamSize = positiveInteger(entry, "teamSize", label);
  const capacity = teamCount * teamSize;
  if (capacity > MAX_ROOM_CAPACITY) throw new Error(`${label} Room capacity must not exceed ${MAX_ROOM_CAPACITY} players`);
  const publicMatchmaking = booleanField(entry, "publicMatchmaking", true, matchKey);
  const createPublicRoom = booleanField(entry, "createPublicRoom", mode === "room", matchKey);
  const privateRoomsEnabled = booleanField(entry, "privateRoomsEnabled", false, matchKey);
  if (mode !== "room" && createPublicRoom) throw new Error(`${label}: only room mode may create public Rooms`);
  if (createPublicRoom && !publicMatchmaking) throw new Error(`${label}: createPublicRoom requires publicMatchmaking`);
  if (mode !== "room" && !publicMatchmaking) throw new Error(`${label}: pool and rank_pool require publicMatchmaking`);
  const maxScoreDiff = entry.maxScoreDiff ?? null;
  if (maxScoreDiff !== null && (!Number.isInteger(maxScoreDiff) || maxScoreDiff < 0)) throw new Error(`${label}.maxScoreDiff must be a non-negative integer`);
  if (mode === "rank_pool" && !maxScoreDiff) throw new Error(`${label}: rank_pool requires a positive integer maxScoreDiff`);
  if (mode !== "rank_pool" && maxScoreDiff !== null) throw new Error(`${label}: only rank_pool may configure maxScoreDiff`);
  const maxMatchSeconds = integerField(entry, "maxMatchSeconds", DEFAULT_MAX_MATCH_SECONDS, label);
  if (maxMatchSeconds <= 0 || maxMatchSeconds > 86_400) throw new Error(`${label}.maxMatchSeconds must be between 1 and 86400`);
  const expansionStages = rankStages(entry, mode, maxScoreDiff, maxMatchSeconds, label);
  let confirmTimeoutSeconds = null;
  if (mode === "room") {
    if (entry.confirmTimeoutSeconds !== undefined && entry.confirmTimeoutSeconds !== null) throw new Error(`${label}: room mode has no Confirm phase and cannot configure confirmTimeoutSeconds`);
  } else {
    confirmTimeoutSeconds = entry.confirmTimeoutSeconds ?? 30;
    if (!Number.isInteger(confirmTimeoutSeconds) || confirmTimeoutSeconds < 1 || confirmTimeoutSeconds > 60) throw new Error(`${label}: pool and rank_pool confirmTimeoutSeconds must be between 1 and 60`);
  }
  return Object.freeze({
    matchKey, mode, teamCount, teamSize, capacity, publicMatchmaking, createPublicRoom, privateRoomsEnabled, legacy: false,
    maxMatchSeconds, confirmTimeoutSeconds, maxScoreDiff, expansionStages, botPolicy: Object.freeze(botPolicy(entry.botPolicy, capacity, label)),
  });
}

/** The RankPool score window in effect after the oldest candidate has waited this long. */
export function rankScoreDiffAt(policy, waitedMillis) {
  const stage = [...policy.expansionStages].reverse().find((item) => item.waitSeconds * 1000 <= Math.max(0, waitedMillis));
  return stage?.maxScoreDiff ?? policy.maxScoreDiff ?? 0;
}

/**
 * Build the local matchKey table.
 * With a project config every request must name a declared matchKey. Without one, the Mock keeps the historical
 * behavior: any matchKey maps to a single Room-mode policy derived from the Scenario.
 */
export function loadMatchPolicies(onlineConfigPath, scenarioRoom) {
  if (!onlineConfigPath) {
    const policy = Object.freeze({
      matchKey: scenarioRoom.matchKey,
      mode: "room",
      teamCount: 1,
      teamSize: scenarioRoom.maxPlayers,
      capacity: scenarioRoom.maxPlayers,
      publicMatchmaking: true,
      createPublicRoom: true,
      privateRoomsEnabled: true,
      legacy: true,
      maxMatchSeconds: DEFAULT_MAX_MATCH_SECONDS,
      confirmTimeoutSeconds: null,
      maxScoreDiff: null,
      expansionStages: [],
      botPolicy: Object.freeze({ enabled: false, defaultFillAfterSeconds: null, minimumHumanPlayers: 1, maximumBotRatio: 0 }),
    });
    return { strict: false, tickRate: scenarioRoom.tickRate, policies: new Map([[policy.matchKey, policy]]), resolve: () => policy };
  }
  let value;
  try {
    value = JSON.parse(readFileSync(onlineConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read online config ${onlineConfigPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = value?.matchKeys;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0 || Object.keys(raw).length > 64) {
    throw new Error("builda.online.json matchKeys must be an object with 1 to 64 entries");
  }
  const tickRate = value.tickRate === undefined ? scenarioRoom.tickRate : value.tickRate;
  if (!Number.isInteger(tickRate) || tickRate < 1 || tickRate > 240) throw new Error("builda.online.json tickRate must be from 1 to 240");
  const policies = new Map(Object.keys(raw).sort().map((matchKey) => [matchKey, matchPolicy(matchKey, raw[matchKey])]));
  return { strict: true, tickRate, policies, resolve: (matchKey) => policies.get(String(matchKey ?? "")) };
}
