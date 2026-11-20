# Builda Online TypeScript Room Mock

This is an open-source, single-process local Mock that runs a local Room directory. It loads the user's TypeScript Room source directly and provides synthetic players, lifecycle, state, message forwarding, several concurrent Rooms and private Rooms, so multiple local clients can be tested against each other.

It does not run Builda Online's production services, and does not simulate the online matchmaking algorithm, Party, invites, real authentication, WebRTC/TURN, distributed recovery, capacity, or security isolation. Those capabilities must be verified online.
It executes Room source with the permissions of the current operating-system user, so only run your own or reviewed code; the local Mock is not a sandbox for untrusted code.

## Player data and payment fulfillment

This Mock provides local player data and fake order fulfillment, so `cloudEnqueue` / `cloudFlush` / `doOrder` / `fulfill` can be tested locally.
This is not production storage, real ext-pay, slot-reservation keys, or security isolation; final online verification must still be done in the App / the official Host.

- Regular writes: as online, a successful `cloudEnqueue` is saved without `cloudFlush`, even if the Room closes right after (for example writes made in `onLeave` / `onDispose` before an empty Room is reclaimed). The Mock applies queued writes right after the current callback, so `cloudRead*` in the same callback does not see them yet. Call `cloudFlush` and wait for `applied` only when you need to confirm the batch; a write the Host rejects (for example `increment` on a non-int64 value) is dropped alone and the flush that covers it reports `failed` with `schema-error`.
- Payment: `doOrder` yields an `OrderDeliveryResult` on a later tick; inside the `allowed` callback use only `fulfill(writes)`, and do not call `cloudEnqueue` / `cloudFlush` again.
- Calling `doOrder` again with the same `orderId` yields `already_delivered` (Host poll reports `completed`) and never grants items twice.
- An order paid on the Builda local mock payment panel (`Builda.iap.showPayPanel(saleId, { grantBy: "room" })`, requires Builda SDK 0.26.5 or later) is allowed for the current player with `payId=saleId`, so the full loop of client payment → `doOrder` → `fulfill` runs locally with your real product IDs. Keep treating `orderId` as opaque in game code.
- A Scenario can declare `mock_economy.orders`: `[{ "orderId", "userId", "payId" }]`. Any other undeclared `orderId` of the current player defaults to `payId=orderId`.
- Orders follow online ownership: a first-seen order belongs to the client whose callback calls `doOrder` (message, join, reconnect, leave, disconnect), and an order is delivered only while its owner holds a Seat in that Room or is that client. Outside client callbacks (`onTick`, async work) a first-seen order can be attributed only in a one-player Room; otherwise it is `rejected` with a `room_mock_order_unattributed` warning, so call `doOrder` from the message handler that received the `orderId`. Completed orders are shared by every Room of the Mock process, so replaying an order in another Room gives `already_delivered`.
- Guests still must not write keys with the `builda.` prefix.

`/config` carries `simulates_cloud_state=true` and `simulates_ext_pay=true`, indicating local simulation, not proof of online capability.

```bash
builda-room-mock \
  --room src/room.ts \
  --source-root . \
  --sdk node_modules/@cysj/room \
  --scenario builda.room.local.json
```

After startup the Mock stays idle, and the first local Admission creates a Room. When the last human Seat of a Room ends (active leave, the 15-second reconnect grace of an abnormal disconnect, or an unused 15-second reservation), the Mock destroys that Room after a 1-second empty-Room grace; Bots do not keep a Room alive, and other Rooms keep running. A user Room calling `disconnect` remains the normal way to end a match earlier.

A single process creates up to 1000 Rooms in total. Use `--rooms N` to lower the limit; `N` must be `1..1000`, and the process must be explicitly restarted after the limit is reached.

## Rooms, matchKeys and Admission

The Mock keeps a local Room directory. Several Rooms can run at the same time (default 64, `--max-active-rooms <n>` from 1 to 256); each Room evaluates its own copy of the Room module, so module-level variables, Host, state, Seats, tick and empty-Room reclaim are per Room, like separate online instances. One local identity holds at most one Seat at a time, but it may queue while still in a Room: Room-mode Tickets are placed only after the old Room is left, Pool/RankPool Tickets can reach RoomReady meanwhile, and entering the new Room before leaving the old one fails with `ROOM_ROLE_BINDING_BUSY`. Every Admission gets its own Ticket ID.

Pass the project config to get per-matchKey behavior:

```bash
builda-room-mock --room src/room.ts --sdk node_modules/@cysj/room \
  --scenario builda.room.local.json --online-config builda.online.json
```

With `--online-config`, every request must name a declared `matchKey`, and the request type must match its `mode`:

- Room mode: automatic matchmaking fills the fullest released public Room of the same `matchKey`, then creates one when `createPublicRoom` allows it; otherwise the Ticket stays `waiting` (heartbeat and cancel work, 120-second local deadline) and is placed when a Room releases or frees a Seat. `lockRoom()`/`releaseRoom()` stop or resume automatic matchmaking into the Room.
- Private Rooms: create-and-enter works when `privateRoomsEnabled` is true; other players enter with the shared Room ID, and private Rooms never receive automatic matchmaking.
- Pool/RankPool: waiting Tickets of the same `matchKey` form a Room once `teamCount × teamSize` players are available, oldest first. RankPool takes `rank_score` (default 0), only groups scores within the current `expansionStages` window (it widens with the oldest wait) and balances team averages. With `botPolicy.enabled`, Bots fill the Room after `defaultFillAfterSeconds` within `minimumHumanPlayers` and `maximumBotRatio`. The roster comes from this formation: team IDs are team indexes (`"0"`, `"1"`, ...) like online, and Bots are roster seats without a user. Scenario actors and bots only apply to Room-mode and private Rooms.
- Confirm (allMembers): a player who enters a formed Room is `connected_pending` and receives `match_connection_pending`; the Room sees no `onJoin` and the join does not complete until every human has arrived, then all of them join at once. If the deadline passes first, absent players' Tickets end as `confirm_timeout`, arrived players go back to `waiting` with their original queue age (a new round), and the Room is discarded. The local deadline is `min(confirmTimeoutSeconds, 15 s)` because client SDKs wait at most 20 seconds for a local join.
- Waiting Tickets end as `timeout` after the matchmaking deadline (30 minutes by default). Party Tickets (`party_id`, `member_rank_scores`) are not simulated.
- Errors use the online codes, for example `ROOM_FULL`, `ROOM_NOT_FOUND`, `ROOM_ROLE_BINDING_BUSY`, `ROOM_ADMISSION_MODE_FORBIDDEN`, `MATCH_ACTIVITY_NOT_FOUND`, `MATCH_TICKET_STALE`.

Without `--online-config`, any `matchKey` maps to one Room-mode policy built from the Scenario (`max_players`), so existing single-Room tests keep working. Room IDs are opaque: the first Room keeps the Scenario `room_id`, concurrent Rooms get a suffixed ID. Scenario Bots count toward every Room's capacity.

`GET /health` lists `rooms` with each Room's ID, matchKey, access kind, admission state and occupancy; `/config` lists the loaded `match_keys`.

By default it only listens on `127.0.0.1:7350`. Clients use `local:<player-id>` as the local synthetic identity.
`--source-root` is the source root the Room entry is allowed to import from, defaulting to the entry file's directory; if the entry needs to import sibling directories,
set it to the Room source root of the user's choice; the source directory does not need to be named `server/`.

The user Room's `log` writes structured debug events to local stdout, limited the same way as online to 2 KiB per entry, 20 entries per Room per second, and
16 KiB of body text, with any excess silently dropped. Online, the same SDK entry writes to separate bounded diagnostic storage rather than platform structured logs; authors can use
the Builda Online Diagnostics Skill to query logs by Room ID, retained for up to 7 days.

When the user Room calls `disconnect(reason)`, the Mock, like online, sends
`reason=game_completed`, `error_code=ROOM_CLOSED`, and `message=Room closed normally`; this is a normal terminal state and does not additionally trigger
the client's global error event.

## Local resource warnings

Resource observations are enabled by default in `warn` mode. Host command counts, callback output bytes, complete frame size, and serialized checkpoint bytes use the public limits. Host output per second and 1s/5s user/room traffic windows have 25% local headroom. Broadcast traffic counts actual recipients. Exceeding these thresholds records a warning; it does not close the Room, discard gameplay commands, or drop gameplay traffic.

Read `GET /health` after every test: `resource_diagnostics.has_warnings` and `warnings` contain each resource, observation count, peak, online limit, and local warning threshold. JSON warnings also appear on stderr with operation `room_mock_resource_warning`, at most once per resource/window per second. Reports persist across Room generations; after fixing an issue, restart and rerun for a fresh report. AI acceptance must inspect this report instead of waiting for a popup or crash. `/config` exposes `resource_policy: "warn"` and `timed_quota_headroom: 1.25`.

Active Rooms run a checkpoint measurement every five seconds. This does not persist or restore state; attempted gameplay Host commands from that probe are ignored and warned. CPU/fuel and WASM memory are not simulated. Existing log truncation/rate limiting, malformed-protocol rejection, and the separate 16 MiB local transport safety ceiling remain. Arbitrary user-code exceptions, infinite loops, or OS memory exhaustion are outside this warning policy. Passing locally is not proof of online capacity.

## Target Player Data

The local Mock supports the new same-game target Player Data API, typed CloudValue reads,
tombstone revisions, conditional Set/Delete/Keep and synchronous close admission.
It does not validate real accounts, permissions, production capacity, durable unknown-write
recovery or live sharing between Mock processes. Unknown writes require the online runtime for acceptance.

## Saved local data

The CLI saves completed Game Data writes, player data and completed mock orders to `.builda-online/mock-data/typescript.bin` under the current working directory. Restart from the same directory to continue. Data is tied to the Scenario game ID; use `--data-file <file>` to choose a separate file for another game. Stop the Mock before deleting the file to start over. Keep it out of version control and use one Mock process per file.

Connections, Room state, pending writes and recovery handles are not restored. The Rust Mock uses a separate local data directory. This convenience does not simulate production durability or prove recovery after interruption.

The programmatic `startMockServer` entry only saves data when its `dataFile` option is supplied.
