# Game Minute-Period Events

The platform stores and schedules rounds, the handler processes events the platform dispatches, and the SDK drives the handler automatically. Treat a timer as a refresh trigger by default; derive business-critical rounds from authoritative time and persisted business records, and never treat each timed dispatch as a reward grant.

## Registration and backlog

- Register `period`, a stable `key`, `catchUp` and `kind` explicitly in `configureGameLifecycle` (TypeScript) or
  `configure_game_lifecycle` (Rust). The SDK shares
  `loadGameLifecycleRegistrations` / `load_game_lifecycle_registrations` between create and restore; do not register in both places.
- The identity is `(period, key)` within one game, and the full identity is `(game, period, key)`; Rooms do not own separate ledgers.
  `key` is 1–128 UTF-8 bytes. Periods of 1, 2, 5 and 10 minutes are supported; the TypeScript period is
  `minute-1` / `minute-2` / `minute-5` / `minute-10`, and the Rust period is `Minute1` / `Minute2` / `Minute5` / `Minute10`.
- The default recommendation is `refresh` + `latest`, which allows older refresh rounds to be merged. Choose `settlement` + `each` only when every round must be processed and the backlog is small.
  A long `each` backlog currently advances about 100 events every 10 minutes, and some requests may be rejected meanwhile. Completed rounds are not scheduled again, but the business handler must still deduplicate.
  Do not use an `each` timer to grant rewards to players.
  `each` keeps the backlog round by round. Bounded catch-up only limits how much runs in one pass; an exhausted budget does not mean rounds are dropped, and a settlement backlog must not be collapsed into the latest round.
- Each Room has at most 32 registrations; shared async notifications hold at most 64 items, and at most 16 dispatches are claimed per tick.
  Neither a business failure nor insufficient capacity in a pass counts as a successful settlement.

## Completion, failure and recovery

An event's `scheduledAtMillis` / `scheduled_at_millis` is the UTC milliseconds of the **original round**; never replace it with the current time on retry.
`eventId` / `event_id` stays stable across retries of the same round. Make processing idempotent on the event identity plus the business entity; exactly-once is not promised.

The **Promise / Future returned by the handler must cover all of the business work**. The SDK starts and awaits it automatically; do not wrap it in `runAsync` /
`spawn_local` again, and never start a background task and return success early. In TypeScript, throwing or rejecting means failure; Rust returns
`Result<(), GameLifecycleHandlerError>`, where only `Ok(())` means success; a business failure or an unresolved unknown must return `Err`.
Keep synchronous registration and Room hooks synchronous.

After the SDK reports a result, the platform accepting the local report does not mean the network confirmation has completed; the platform handles lost and unknown confirmations.
This does not replace unknown-outcome recovery for **business writes**: when a write returns `outcome_unknown` and a recovery handle is provided, resume the original request following that write API's rules; do not start a separate non-idempotent write to "make up" for it. When recovery is still unknown, there is no handle, or the handle has expired, the handler
must fail, and a later retry checks against the persisted business records. A handle is only usable within the current Room generation and must not be saved into a migration snapshot.

For player rewards, conditionally update the reward and its marker within the same Player Data key when the player logs in or claims.
Do not iterate over all players in a timer to grant rewards; there are no atomic transactions across keys or players.

## Default example: latest refresh

```typescript
reg.register(
  { period: "minute-1", key: "season-check", catchUp: "latest", kind: "refresh" },
  async () => { await checkSeason(); },
);
```

`checkSeason` is a bounded business check the game implements itself; it is not an SDK method. The Rust equivalent registers
`GameLifecycleCatchUp::Latest` and `GameLifecycleKind::Refresh`; the handler awaits all Futures before returning its result.
