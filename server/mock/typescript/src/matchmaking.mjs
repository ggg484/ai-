import { rankScoreDiffAt } from "./match-policy.mjs";

const BOT_RATIO_TOLERANCE = 1e-12;
const MAX_CANDIDATES = 256;

/**
 * Local Pool/RankPool formation for single-player Tickets.
 * Deterministic and bounded, following the public rules: oldest Tickets first, exact team capacity, RankPool score
 * windows that widen with the oldest wait, and Bot fill after the configured delay. It is not the online algorithm.
 *
 * @param {object} policy frozen matchKey policy
 * @param {{ playerId: string, createdAtMillis: number, score: number }[]} tickets waiting Tickets of this matchKey
 * @param {number} now current Unix millis
 * @returns {{ teams: { playerIds: string[], botCount: number }[], botScore: number | null } | null}
 */
export function formMatch(policy, tickets, now) {
  if (tickets.length === 0) return null;
  const order = [...tickets]
    .sort((left, right) => left.createdAtMillis - right.createdAtMillis || (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0))
    .slice(0, MAX_CANDIDATES);
  const capacities = Array.from({ length: policy.teamCount }, () => policy.teamSize);
  const capacity = policy.capacity;
  const waited = now - order[0].createdAtMillis;
  const window = policy.mode === "rank_pool" ? rankScoreDiffAt(policy, waited) : null;
  const full = pickPlayers(order, capacity, window);
  if (full) return { teams: assignTeams(policy, full, capacities), botScore: null };
  const bots = policy.botPolicy;
  if (!bots?.enabled || bots.defaultFillAfterSeconds === null || waited < bots.defaultFillAfterSeconds * 1000) return null;
  let maximumBots = 0;
  for (let count = 1; count < capacity; count += 1) {
    if (count / capacity <= bots.maximumBotRatio + BOT_RATIO_TOLERANCE) maximumBots = count;
  }
  if (maximumBots === 0) return null;
  for (let humans = capacity - 1; humans >= Math.max(bots.minimumHumanPlayers, capacity - maximumBots); humans -= 1) {
    const selected = pickPlayers(order, humans, window);
    if (!selected) continue;
    const teams = assignTeams(policy, selected, capacities);
    const average = Math.round(selected.reduce((sum, ticket) => sum + ticket.score, 0) / selected.length);
    return { teams, botScore: policy.mode === "rank_pool" ? average : null };
  }
  return null;
}

/** Choose `count` Tickets, preferring older ones, whose score spread fits the window (null = no window). */
function pickPlayers(order, count, window) {
  if (count <= 0 || order.length < count) return null;
  for (let anchor = 0; anchor + count <= order.length; anchor += 1) {
    const chosen = [order[anchor]];
    const failed = new Set();
    if (extend(order, anchor + 1, count - 1, order[anchor].score, order[anchor].score, window, chosen, failed)) return chosen;
  }
  return null;
}

/** Include-first depth search with a failure memo, so older Tickets are kept whenever a full set still exists. */
function extend(order, position, need, minimum, maximum, window, chosen, failed) {
  if (need === 0) return true;
  if (order.length - position < need) return false;
  const key = `${position}:${need}:${minimum}:${maximum}`;
  if (failed.has(key)) return false;
  const ticket = order[position];
  const nextMinimum = Math.min(minimum, ticket.score);
  const nextMaximum = Math.max(maximum, ticket.score);
  if (window === null || nextMaximum - nextMinimum <= window) {
    chosen.push(ticket);
    if (extend(order, position + 1, need - 1, nextMinimum, nextMaximum, window, chosen, failed)) return true;
    chosen.pop();
  }
  if (extend(order, position + 1, need, minimum, maximum, window, chosen, failed)) return true;
  failed.add(key);
  return false;
}

/** Pool keeps arrival order team by team; RankPool balances team average scores. Bots fill what humans leave. */
function assignTeams(policy, selected, capacities) {
  const teams = capacities.map(() => ({ playerIds: [], scores: [] }));
  const place = (ticket, index) => { teams[index].playerIds.push(ticket.playerId); teams[index].scores.push(ticket.score); };
  if (policy.mode === "rank_pool" && selected.length === capacities.reduce((sum, size) => sum + size, 0)) {
    // Highest score first into the team with the lowest average so far; ties keep the lower team index.
    const byScore = [...selected].sort((left, right) => right.score - left.score || (left.playerId < right.playerId ? -1 : 1));
    for (const ticket of byScore) {
      let best = -1;
      for (let index = 0; index < teams.length; index += 1) {
        if (teams[index].playerIds.length >= capacities[index]) continue;
        const average = teams[index].scores.length ? teams[index].scores.reduce((sum, value) => sum + value, 0) / teams[index].scores.length : -Infinity;
        const bestAverage = best < 0 ? Infinity : teams[best].scores.length ? teams[best].scores.reduce((sum, value) => sum + value, 0) / teams[best].scores.length : -Infinity;
        if (best < 0 || average < bestAverage) best = index;
      }
      place(ticket, best);
    }
  } else {
    for (const ticket of selected) {
      const index = teams.findIndex((team, teamIndex) => team.playerIds.length < capacities[teamIndex]);
      place(ticket, index);
    }
  }
  return teams.map((team, index) => ({ playerIds: team.playerIds, botCount: capacities[index] - team.playerIds.length }));
}
