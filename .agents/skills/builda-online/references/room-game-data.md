# Game Data

**Game Data** is stored per game and shared across Rooms. It is not Player Data, which is stored per player, and it does not use
`cloudEnqueue` / `cloudFlush`. The four client SDKs do not have this API. TypeScript uses `this.gameData` and Rust uses
`context.game_data()`. Once the Room language is chosen, write only the matching API.

This is an official SDK capability for Rooms. Choose objects, ordered indexes or counters to fit the game; success in the local Mock does not mean online acceptance has passed.

When you receive `unauthorized` or `forbidden`, stop retrying automatically, tell the user that authentication or access permission has not been confirmed, and let the platform confirm whether the current game is eligible; do not bypass permissions or ask the user for a token. If the original write result is still `outcome_unknown`, keep its original recovery material; a permission error does not prove that write failed.

All of these structures are taken from a namespace:

| Structure | TypeScript | Rust | Use |
| --- | --- | --- | --- |
| Objects | `objects(ns)` | `objects(ns)` | Read, write, conditionally update, delete and list keys of JSON objects |
| Ordered index | `sortedIndex(ns)` | `sorted_index(ns)` | Member scores, ranges, ranks and counts |
| Counters | `counters(ns)` | `counters(ns)` | Read, add/subtract, compare-and-swap and delete integers |

**GameData message queues (manual and managed consumption) are currently paused.** Queue operations return `GameDataError` at run time: the generic
snake_case `code` is `unsupported_capability` and `reason` is `game_data_message_queue_disabled`. This is a paused feature,
not a retryable capacity error; do not keep calling, retry automatically, or rewrite queue work as object polling. Objects, ordered indexes and counters are not affected by this pause.
When a queue operation fails, follow the [queue pause notes](room-managed-queues.md).

`capabilities()` reads the limits published by the current environment. The local Mock's limits only simulate this process and do not represent online capacity.

## Calling conventions

Synchronous methods return an `Operation` immediately; query its result with `poll` and call `release` when done. Synchronous methods themselves do not return a Promise.
Async methods use `*Async` / `*_async` and can be awaited in a managed async task; an async task may keep running between game ticks.

When you need `await`, wrap the async logic with `this.runAsync(async () => { ... })` on the **Room instance** (not the static
`Room.runAsync`), then call each structure's `*Async` / `resumeAsync` (`*_async` / `resume_async` in Rust).
Lifecycle hooks stay synchronous and must not return a Promise; the platform reports an error if one returns a thenable. Await a Promise / Future only while the current
Room is still valid; after the Room is destroyed or its generation changes, do not keep awaiting old Promises. On a Host without async-runtime,
`*Async` fails before sending the request, and synchronous `Operation`s remain available.

## Read freshness

Object `get` / `getMany` reads may be stale for up to the game’s configured cache `ttlMs` (contract maximum 30 seconds).
The platform decides how reads are cached. Design every read path for this delay.
Never use a read followed by an unconditional write to enforce correctness.
Use `compareExchange` / `compare_exchange` or `update`: conditional writes check authoritative state,
and every `update` read, including conflict retries, is authoritative.

To show a player their own change, use the value you just wrote or the confirmed write result instead of
reading it back. A read from another Room can return the earlier value until the cache expires.

Do not set `fresh`. The option stays in read options only for compatibility; it has no guaranteed effect and
cannot give you a newer value. Keep the default read:

- TypeScript: `objects.getAsync(key)` or `objects.getManyAsync(keys)`. Synchronous `get` / `getMany` return `Operation`.
- Rust: `objects.get_async(key, Default::default())` or `objects.get_many_async(&keys, Default::default())`.
  Synchronous names are `get` / `get_many`.
- Both languages accept a timeout in read options. The local Mock has no read cache; local tests do not
  demonstrate online cache timing or cross-Room visibility.

## Bounded batch reads

Do not sequentially `await` independent object reads in a per-item loop. Use `getMany` / `getManyAsync`
(Rust `get_many` / `get_many_async`) with at most `min(20, capabilities.limits.batchReadMax)` keys per batch
(Rust `batch_read_max`). Validate the advertised limit; do not guess a fallback when capabilities fail.
The Host cannot combine calls that you only start after the previous await finishes.

Sequential awaits are still appropriate for pagination, backpressure **between batches**, and operations
that depend on an earlier read or write. `Promise.all` is only for an explicitly bounded set of independent
calls; it is not a substitute for `getMany`, and an unbounded `Promise.all(items.map(...))` is not batching.
Never make dependent reads/writes concurrent merely to reduce calls.

This TypeScript helper reads **one bounded page**. Call it from an existing Room `runAsync` task, then
validate each present object's business schema before displaying it. `memberId` is the object key here.
It preserves input positions, including duplicate keys; it does not filter results before pairing them.

```typescript
import type { GameData, JSONObject } from "@cysj/room";

type ListingRow =
  | { key: string; score: number; status: "present"; value: JSONObject }
  | { key: string; score: number; status: "missing" }
  | { key: string; score: number; status: "error"; code: string; requestId: string; reason?: string };

async function readMarketPage(data: GameData, cursor?: string) {
  const { limits } = await data.capabilitiesAsync();
  if (!Number.isInteger(limits.batchReadMax) || limits.batchReadMax < 1 ||
      !Number.isInteger(limits.pageMax) || limits.pageMax < 1) {
    throw new Error("Invalid Game Data read limits");
  }
  const batchSize = Math.min(20, limits.batchReadMax);
  const pageSize = Math.min(60, limits.pageMax); // Game-owned per-refresh entry budget.
  const page = await data.sortedIndex("market").rangeAsync({
    order: "descending", limit: pageSize, ...(cursor ? { cursor } : {}),
  });
  if (page.items.length > pageSize) throw new Error("Index page exceeds read budget");
  const objects = data.objects("market-listings");
  const rows: ListingRow[] = [];
  for (let offset = 0; offset < page.items.length; offset += batchSize) {
    const entries = page.items.slice(offset, offset + batchSize);
    const keys = entries.map((entry) => entry.memberId);
    const results = await objects.getManyAsync(keys); // One await per bounded batch, not per item.
    if (results.length !== keys.length) throw new Error("Incomplete object batch");
    for (let position = 0; position < entries.length; position += 1) {
      const { memberId: key, score } = entries[position];
      const item = results[position];
      if (item.key !== key) throw new Error("Object batch position mismatch");
      if ("error" in item) {
        rows.push({ key, score, status: "error", ...item.error });
      } else if (!item.result.found) {
        rows.push({ key, score, status: "missing" });
      } else {
        rows.push({ key, score, status: "present", value: item.result.value });
      }
    }
  }
  return { rows, nextCursor: page.nextCursor };
}
```

For 60 entries and a batch limit of 20, this performs one capabilities call, one index call and three
object calls. An empty page performs no object call. Bound refresh frequency as well as page size;
do not automatically drain every remaining page during one refresh. A whole-call rejection propagates
instead of returning an empty market. Per-item errors retain their code/request ID for a bounded retry
or visible partial-result state; `missing` means no live object was observed, not an empty listing.
Skip unavailable entries in the display while retaining their distinct status. A stale index entry whose
object is missing is expected during two-step writes; it must not crash the page or appear purchasable.
Do not delete an index entry merely because one reader observed missing; it may race with a writer.

Rust uses the same page and batch budgets: `capabilities_async`, `sorted_index(...).range_async`, then
`objects(...).get_many_async` on nonempty slices. Pair each `BatchItem` by input position and match
`BatchItem::Error`, `BatchItem::Ok` with `ObjectRead::Missing`, and `ObjectRead::Found` separately.
Do not collect only successful items and then zip them with the original keys. Start async work as follows;
the single count below illustrates task admission, not a pattern to repeat per listing.

Rust example (start it inside a synchronous hook such as `on_create` / `on_tick`; do not capture `context`, and do not move the Future across threads):

```rust
let data = context.game_data();
let admitted = cysj_room_sdk::spawn_local(async move {
    match data.sorted_index("board").count_async(Default::default()).await {
        Ok(count) => {
            // Use count (write into business state you already own, not &mut context)
        }
        Err(error) => {
            // Handle by error.code / recovery_handle
        }
    }
});
if !admitted {
    // The task slots are full or async-runtime is unavailable
}
```

Synchronous conditional updates still use `objects(...).update(key, (current) => nextObject)`: the callback must be a **synchronous pure function**
that returns the next JSON object; it cannot return a Promise. When you need `await`, use `updateAsync` / `update_async` and await it inside
`runAsync` / `spawn_local` as well; do not fall back to mixing `update` + `poll` just to get a synchronous callback.

`poll` has only three states: still running, completed and expired. Running does not mean failed. Polling after `release` always reports expired,
which does not prove the write did not happen.

Counters are int64: pass a `bigint` in TypeScript and an `i64` in Rust, never a fraction. Scores are safe integers in the range
±(2^53−1). Object values are JSON objects; keys are sorted by UTF-8 and `-0` is written as `0`. Do not submit JSON numbers beyond the safe integer range,
circular references, keys containing NUL, or `undefined` / functions.

Very frequently written counters may be briefly merged by the platform: the total stays accurate, but reads may lag briefly, and the `value` returned by an unbounded `add`
may only be an estimate. Do not use that return value to issue unique numbers or check thresholds; when you need an exact result, use `add` with `min` / `max`,
or `compareExchange` / `compare_exchange`.

To supply your own idempotency ID, use `m1.<decimal milliseconds>.<32 lowercase hex characters>`. When omitted, the runtime assigns one. Do not build IDs yourself from Room random numbers.

The timeout defaults to 5 seconds and can be set explicitly from 1 to 30000 milliseconds.

## Object and index updates are not atomic

`objects.set` followed by `sortedIndex.setScore`, and `objects.remove` followed by `sortedIndex.remove`,
are **two independent writes**, not a transaction. The first can succeed while the second fails. Readers
must tolerate index/object disagreement as above; recheck the authoritative object before a purchase.

Use a game-owned durable repair intent (listing ID, desired business revision/state and unfinished phase),
and serialize changes to the same listing. A short convergence algorithm is:

```text
publish intent: confirm object.set → confirm index.setScore → mark intent complete
delete intent:  confirm object.remove → confirm index.remove → mark intent complete
on a retryable failure: keep the unfinished phase; retry it later with bounded backoff
before repair: verify the intent is still the current desired revision; never apply an older edit
```

The arrows are sequential confirmation points, not atomic commits. Keep the intent until both writes
are confirmed so a crash between them can be repaired, including after object removal. Do not blindly
restart the completed first step or run both writes with `Promise.all`. For `outcome_unknown`, resume the
**original** write with its recovery handle; an expired/missing handle is not proof of failure and is not
permission to repeat a reward under a new ID. If no result can be recovered, reconcile the current desired
state under the same serialized ownership before resuming repair; this converges state, not a claim that
a historical write ran exactly once. Cross-Room writers need a shared ownership/conditional-write design,
not a process-local lock. Replaying `setScore` from an old intent can overwrite a newer score.

## Updates and unknown outcomes

`objects.update` runs your function after the runtime provides the current read, and the function returns the next JSON object. An ordinary conflict takes one fresh read and runs the function again, up to 8 times (configurable from 1 to 8). The function must not make any other Game Data call; doing so returns `busy` / `callback_reentrancy` while the original update keeps running. If the function throws or returns a non-object, this compare-and-swap is not committed.

When the result is `outcome_unknown` and the error carries a recovery handle, call `resume` / `resumeAsync` with it to continue the same operation; without a handle, stop retrying automatically and report that the result is unknown. Do not start a new write to "make up" for it.
A conflict during `resume` is final; the update function is not rerun. While the material is still available, if the query hits busy, an invalid timeout, an unavailable Host or a Host refusal to start,
the result is still `outcome_unknown`, the reason is in `recoveryError`, and the original recovery handle is kept; this does not mean the write failed. When the material has been released,
is not on this server, or the Host judges it expired, the result is still `outcome_unknown` with `recoveryError.code = recovery_expired`, and no handle is attached.
A recovery handle is likewise valid only within the current Room generation and must not be put into a migration snapshot for the next session.

An observed completion result may expire; expiry only means the result is no longer kept, not that the write did not happen. Recovery material and operation results are kept separately;
an expired result does not revoke a recovery handle already obtained. Call `release` promptly after you use a result.

Public error codes are `snake_case`, for example `invalid_argument`, `conflict`, `outcome_unknown`, `busy`, `unavailable`,
`timeout` and `capacity_exceeded`.

### Rate limits and readable error messages

Show developers the `code`, `reason`, a readable message and, when present, the retry wait time. The TypeScript `message` field is optional; when it is missing use `gameDataErrorMessage(error.code, error.reason)`; in Rust use `error.message()` or `Display`. Branch business logic on `code` / `reason` and never parse the message text. Use a generic message for unknown reasons.

| Error code | reason | Meaning and handling |
| --- | --- | --- |
| `rate_limited` | `game_write_limit` | Writes for the current game exceed the limit; write less often. |
| `rate_limited` | `key_write_limit` | Writes to the same key exceed the limit; spread or merge writes. A whole ordered index counts as one key. |
| `rate_limited` | `circuit_open` | After repeated service failures, Game Data requests for this game are temporarily stopped. |
| `rate_limited` | `replica_busy` | The service is temporarily busy. |
| `rate_limited` | `quota_wait_too_long` | The current game's read/write traffic exceeds its quota; read and write less data or less often. |
| `rate_limited` | `quota_queue_full` | Too many requests of the current game are waiting for quota; limit concurrent calls. |
| `rate_limited` | `quota_deadline_short` | The time left for this call is too short to wait for quota; allow a longer timeout or reduce traffic. |
| `rate_limited` | `quota_replica_memory` | The service is temporarily busy. |
| `rate_limited` | `quota_shutdown` | The service cannot accept this request right now. |
| `rate_limited` | `attempt_budget_exhausted` | Rate limiting lasted until the platform's retries were used up; retry later with bounded backoff, or reduce traffic. |
| `forbidden` | `game_data_blocked` | The platform has stopped Game Data for this game; contact the platform. |

For a `rate_limited` result that definitely did not execute, wait at least `retryAfterMs` (`retry_after_ms` in Rust) when it is provided, then retry a limited number of times with backoff; use bounded backoff when there is no hint as well. When retrying a known request, keep the original request identity and arguments, and reuse the original `mutationId` / `mutation_id` if you supplied one explicitly. This rate limit does not prove that an earlier write with that ID did not happen; when an earlier result is unknown, do not change the ID and run the same business action again. For `outcome_unknown`, resume the original request if there is a handle; otherwise stop retrying automatically and report that the result is unknown.

A real timeout can still return `timeout`. Exhausted rate-limit retries may return `rate_limited` instead of the earlier `timeout`; code that only checked `timeout` should handle `rate_limited` too.

### Traffic quota and hot spots

The quota is counted for the whole game, not per Room, and both reads and writes count; even if one Room's code looks infrequent, all Rooms together can exceed the quota.
Requests may be slowed briefly before they are rejected. First reduce the data per read or write, merge duplicate reads and write less often; do not offset rate limits with more retries.

All members of an ordered index share one write limit, so switching members does not spread writes. Submit a leaderboard only when a score actually improves, and merge in the Room before submitting periodically;
when you really need more write volume, use different namespaces per season or partition. Ordered-index member counts and the size of a single structure have platform limits that are not in
`capabilities()`; when exceeded, handle `capacity_exceeded`, and do not assume a board can grow without limit.

### Common scenarios

| Scenario | Recommendation |
| --- | --- |
| Global settings, event state | Store them in objects; accept a short delay, and read on Room entry or on a periodic refresh instead of every tick. |
| Leaderboards | Submit only when a score improves; read just the top page instead of the whole board; switch namespaces per season or partition. |
| Server-wide counts | Use counter `add` instead of read-then-write; read periodically for display and do not rely on the value `add` returns. |
| Limited stock, flash sales, reward claims | Use `update` or `compareExchange` and give players a clear result on failure; do not decide whether stock remains from a read. |
| Markets, listings | Use objects plus an ordered index; after paging, batch-read with `getMany` and handle mismatches between the two as described above. |
| Shared state such as guilds or teams | Split into separate keys per guild or team and keep objects small; do not put all data into one object. |
| Many Rooms doing the same thing | Calls from all Rooms add up; prefer player actions as triggers, use the timer for scheduled work, and do not poll from every Room. |

## The local Mock does not replace online

When started with the local Mock command, confirmed Game Data is saved by default so local testing can continue after a restart; see the matching Mock README for where it is saved and how to clear it. Connections, Room state, unfinished operations and recovery handles are not restored. Local files do not prove online persistence or unknown-write recovery, and a read after a restart alone cannot prove whether a past write succeeded or failed.


# Game Data replay and time-based game rules

Game Data is shared by a game; Player Data belongs to a player. These recipes describe SDK behavior and
local validation, not proof that the target online environment has completed deployment acceptance.
The replay changes retain the Game Data call signatures. New builds also include independent
asynchronous scheduling; continuations can run between gameplay ticks. Game Data message queues remain unavailable.

## Replay, retries and unknown outcomes

The published ID validity window and receipt retention are different guarantees. Within the published
window, a bounded number of the most recent recorded decisions per resource can be replayed exactly,
including recorded rejections/conflicts. A resource is one object key, one counter key, or
one whole sorted index (all members share the receipts). Capabilities publish the validity window, not the retained count,
so do not assume a fixed count. On a busy sorted index, receipts can age out quickly; retry promptly. If the validity window is missing or invalid, writes can return
`unavailable`; reads can still continue.

A supplied `mutationId` / `mutation_id` retries a known request with the same method and arguments.
After receipt eviction, an explicit ID can return `idempotency_expired`; this does not prove that the
original effect did not occur. Never retry the same business effect under a different ID.

- A new Operation with an explicit old ID can return `idempotency_expired`, without a recovery handle.
  This only means this call cannot execute/replay it; it does **not** prove the historical write failed.
  Never change the ID to grant the same reward again.
- An Operation that was already unknown, including a resume, remains `outcome_unknown` when the receipt
  expires. Its `recoveryError.code` is `idempotency_expired`; the mutation ID and available original
  recovery handle remain unchanged. Resume does not rerun the transform or create a new mutation.
- Recovery materials use a frozen deadline: at most ten minutes from the first unknown and no later
  than the original ID's validity deadline. Refreshing capabilities or resuming cannot extend it.
  Unknown may have no handle when materials cannot be retained. Expired/released materials do not
  prove cancellation. Handles stay in the current Room generation.
- Counter overflow is `invalid_argument` with `reason=integer_overflow`; bounds violations use
  `reason=value_out_of_range`. `rate_limited` may include `retryAfterMs` (`retry_after_ms` in Rust).
  The Host handles bounded retries under the original deadline. `unavailable` with `commit_conflict`
  is also retried under the same mutation and can ultimately be unknown. Do not add a second business write.

TypeScript, inside the Room's `runAsync` task (handle only a bounded number of recovery attempts):

```typescript
try {
  await this.gameData.counters("world").addAsync("visits", 1n);
} catch (cause) {
  const error = cause as GameDataError<WriteResult & { value: bigint }>;
  if (error.code !== "outcome_unknown" || !error.recoveryHandle) throw cause;
  await this.gameData.resumeAsync(error.recoveryHandle);
}
```

Rust uses the same distinction: `error.code == "outcome_unknown"`, then
`data.resume_async(&handle, Default::default()).await`; never build a replacement mutation ID.
Both source Mocks save completed local data between restarts. They do not restore live operations or
prove online durability, transport retry behavior, quotas, or recovery after interruption.

## Timers are refresh triggers

Prefer `latest` with `kind: "refresh"`; this is the default recommendation (registration fields remain
explicit). Use `each` with `kind: "settlement"` only if every round must be visited and the backlog
stays small. A long `each` backlog currently advances about 100 events per ten minutes, with some
requests rejected. The lifecycle scheduler does not double-run completed rounds, but handler retry
and business idempotency still matter. Do not use an `each` timer to pay players.

```typescript
reg.register({ period: "minute-1", key: "season-check", catchUp: "latest", kind: "refresh" },
  async () => { await checkSeason(); }); // Game-owned bounded check; await all its work.
```

`checkSeason` is game code implementing the recipe below, not an SDK method. Rust registers
`GameLifecycleCatchUp::Latest` with `GameLifecycleKind::Refresh`. Keep synchronous Room hooks synchronous;
wait for the entire handler Future/Promise. A pending unknown write is not a successful handler.

The following short examples are **business algorithms**, not new SDK APIs. Implement each pure
single-key transform using TS `playerData.openAsync(roleId)` then `target.updateAsync(key, transform)`,
or Rust `open_async` then `update_async`. Decode/encode your existing CloudValue schema, preserve other
fields, use authoritative time captured before the transform, and close the target when done.

### 1. Daily tasks / reset

Store the day and task state in one Player Data key. On login or opening the task view:

```text
today = UTC day(authoritativeNow)
update dailyState: if lastResetDay >= today -> Keep
                   else -> Set({ ...state, lastResetDay: today, tasks: freshTasks })
```

Several offline days cause one reset, not one payout per missed day. Clock regression must not reset backwards.

### 2. Accumulating rewards

Store the balance and settlement timestamp together; settle on claim or view instead of emitting timer payments:

```text
update incomeState:
  elapsed = max(0, authoritativeNow - lastSettledAt)
  wholeUnits = floor(elapsed / unitDuration)
  Set({ ...state, balance: balance + wholeUnits * rate,
        lastSettledAt: lastSettledAt + wholeUnits * unitDuration })
```

Preserve fractional time, apply game caps and integer overflow checks, and initialize missing state at the
current time rather than granting income since epoch. Compute rates from authoritative game rules.

### 3. Seasons and rotations

```text
season = floor((authoritativeNow - seasonEpoch) / seasonDuration)
board = gameData.sortedIndex("season-" + season)
resultKey = "season-" + season + "-result"
```

Rust uses `sorted_index`. New seasons use new namespaces/keys; never mass-reset player data or the old board.

### 4. Global rounds that need one durable result

A `latest` timer checks time-derived missing rounds in bounded batches, continuing until all missing rounds
are covered. For each round, compute the deterministic result and use
TS `objects("rounds").createAsync("round-" + round + "-result", result)` or Rust `create_async`.
An existing object is reported by the SDK as `conflict` with `reason=already_exists`; this means that
result already exists, not that an arbitrary conflict is success. Resume unknown writes with the original handle.

```text
for each missing round in this bounded batch:
  create round-<id>-result with the entire authoritative round result
  already_exists -> result already recorded; verify/read it as needed
  unknown -> recover original write; stop batch if unresolved
  only after confirmation, advance lastDoneRound as a progress hint
```

The create of this one immutable result is the only atomic once-only effect. `lastDoneRound` cannot make
other writes atomic or guarantee exactly-once execution. Never send rewards or external fulfillment in the
timer. Players claim their effects using the next recipe. Retain result records for the full claim lifetime.

### 5. Season settlement and claims

Persist each player's authoritative best season score in Player Data, and submit the leaderboard score
from that stored best. `setScore` replaces the value: a delayed older write can overwrite a higher score.
Serialize score submissions per player/season and reconcile from the authoritative best; reading the best
alone does not make racing requests safe. Do not accept client-reported scores as authoritative.

Freeze the old season: route new scores to the new season and drain/reconcile all old-season submissions.
A one-minute delay alone does not prove no old write is in flight. Once frozen and at least one minute
past the end, a `latest` handler calculates cutoffs and creates `season-<id>-result`:

```text
count = oldBoard.countAsync()                   // Rust count_async
for each tier with inclusive target rank r:
  read descending pages via rangeAsync / range_async until rank r
  cutoff[tier] = score at r                    // define empty-board rules explicitly
create season-<id>-result = { count, cutoffs, topDisplay, finalized: true }
```

Use the actual `count`/`range` APIs, not invented `IndexCount`/`IndexRange` SDK methods. Observe pagination
and game capacity limits. The immutable result must contain everything needed for claims after the board
is unavailable. Existing result (`conflict` / `already_exists`) means finalized; do not overwrite it.
A player qualifies for a tier when their persisted season score is **greater than or equal to** its cutoff;
ties can increase the tier population beyond the nominal rank.

At the player's next session, read the immutable result and conditionally update **one Player Data key**
containing the score, reward balance and claim marker. Example pure transform:

```text
if season <= state.lastClaimedSeason: Keep
else:
  reward = tierReward(state.bestScoreBySeason[season], finalizedResult.cutoffs)
  Set({ ...state, coins: state.coins + reward, lastClaimedSeason: season })
```

For out-of-order claims use a claimed-season set in that same key instead of a monotonic marker. The
transform does no messages, external fulfillment, or other writes. On unknown, use Player Data's original
`resumeAsync(recoveryHandle)` / `resume_async`, never a second grant. All other writers must preserve the
marker. Atomicity covers only this key, not multiple keys, players, or external payments. Never write rewards
to every player at season end. Player Data deployment acceptance is still required; local examples do not
claim production availability.
