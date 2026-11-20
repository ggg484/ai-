# Changelog

## 0.17.0

- An order paid on the Builda local mock payment panel (`Builda.iap.showPayPanel(saleId, ...)`, Builda SDK 0.26.5 or later) is allowed for the current player with `payId=saleId`, so the client payment → `doOrder` → `fulfill` loop runs locally with real product IDs. Scenario `mock_economy.orders` still take precedence; other undeclared order IDs keep `payId=orderId`.
- Fix: a successful `cloudEnqueue` is now saved without `cloudFlush`, as online. Before, queued writes were applied only when the Room polled a flush, so writes made just before an empty Room was reclaimed (default 1 second after the last player left), or in a Room that never flushed, were silently lost. Writes are applied right after the current callback and before shutdown; `cloudFlush` only confirms them. A rejected write is dropped alone instead of blocking every later write. `fulfill` writes still wait for the order to finish.
- Fix: `doOrder` no longer uses whichever player acted last in any Room of the process. A first-seen order belongs to the client of the running callback, and an order is delivered only while its owner is in that Room; outside client callbacks a first-seen order is attributed only in a one-player Room, otherwise it is rejected with a `room_mock_order_unattributed` warning.

## 0.16.0

- Run several Rooms at once (default 64, `--max-active-rooms`); each Room gets its own module state, Host, seats, tick and empty-Room reclaim.
- `--online-config builda.online.json` reads the project's matchKeys: Room-mode automatic placement, `lockRoom`/`releaseRoom` now stop and resume automatic matchmaking, private Rooms, waiting Tickets with heartbeat and cancel, and Pool/RankPool matchmaking: Rooms form from waiting Tickets with exact team sizes, RankPool score windows that widen with wait time and balanced teams, Bot fill after the configured delay, and allMembers Confirm with timeout requeue (local window at most 15 seconds).
- Pool/RankPool Rooms get the formation roster: team IDs are team indexes (`"0"`, `"1"`) like online; Scenario actors and bots only apply to Room-mode and private Rooms.
- Room errors use the online codes (`ROOM_FULL`, `ROOM_NOT_FOUND`, `ROOM_NOT_JOINABLE`, `ROOM_ROLE_BINDING_BUSY`, `MATCH_TICKET_STALE`, ...); one local identity holds one Seat at a time but may queue while still in a Room, and every Admission gets its own Ticket ID.
- Without `--online-config` existing single-Room projects keep their behavior, except that a locked Room no longer receives automatic placements.
- A Room closed by its own code, by a runtime failure or by empty-Room reclaim ends only that Room. A Pool/RankPool Room closed before every player arrived answers the waiting joins at once and ends its Tickets as `failed` / `room_lost`.
- As online, a Ticket turns `confirmed` only after the join was answered, so its `confirmed` push reaches a client that already holds the Room handle. After leaving a Room, joining it again with the old Ticket or handle fails with `ROOM_PRESENCE_STALE`; a new Admission is needed.

## 0.15.0

- Track @cysj/room 0.25.0; Add server-driven room creation and automatic member transfer with trusted origin metadata.

## 0.14.3

- Track @cysj/room 0.24.3; Doc comments and README for Player Data, Game Data and Cloud State are now in English; no API change.

## 0.14.2

- Track @cysj/room 0.24.2; A config table is asked from the Host at most once per tick; repeated reads in a tick reuse the answer.

## 0.14.1

- Track @cysj/room 0.24.1; Repeated reads of an unchanged config table cost no copy.

## 0.14.0

- Track @cysj/room 0.24.0; Add read-only dynamic config tables through the new builda:game-config@1.0.0 Host import; new Rooms need a Worker that provides it.

## 0.13.1

- Track @cysj/room 0.23.4; Explain traffic allowance errors and retire the fresh read recommendation.

## 0.13.0

- Track @cysj/room 0.23.3; Preserve published persistence and error guidance while integrating local resource diagnostics.

## 0.12.1

- Track @cysj/room 0.23.2; Save completed local Game Data, player data, and mock orders between restarts; roll back changes when saving fails.

## 0.11.1

- Track @cysj/room 0.23.1; Clarify Game Data error reporting and safe recovery guidance.

## 0.11.0

- Track @cysj/room 0.23.0; Explain Game Data limit errors and report persistent limits separately from timeouts.

## 0.10.3

- Track @cysj/room 0.22.3; Document game-wide Game Data objects, sorted indexes, and counters.

## 0.10.2

- Track @cysj/room 0.22.2; Clarify Room guidance and streamline local testing delivery.

## 0.10.1

- Track @cysj/room 0.22.1; Add asynchronous target Player Data and scheduling support; refine Room guidance.

## 0.7.0 - 2026-10-27

- Add nonfatal resource warnings and persistent AI-readable health diagnostics; use exact byte/count limits and 25% time-window headroom.

## 0.6.18

- Ship resource limits 1.1.0 with a 2,000,000,000 fuel hard limit per online lifecycle callback. Include the online bandwidth limits of 20 KB/s upstream and 80 KB/s downstream averaged over 5 seconds, with twice those amounts allowed in 1-second bursts. The local source Mock does not enforce WASM fuel or online bandwidth quotas.

## 0.6.17

- Track @cysj/room 0.14.11; code comments, the README and the changelog are now in English; no API or behavior changes.

## 0.6.16

- Track @cysj/room 0.14.10; Cloud State writes use the bit-pattern host channel so negative int64, float64 and increment deltas no longer trap the Room

## 0.6.15

- Track @cysj/room 0.14.9; docs: package README title changed to Player Data

## 0.6.14

- Track @cysj/room 0.14.8; docs: developer docs consistently say player data, keeping function names such as cloudEnqueue

## 0.6.13

- Track @cysj/room 0.14.7; docs: enqueue means queued, flush waits until applied takes effect

## 0.6.12

- Track @cysj/room 0.14.6; docs: flush waits for Host APPLIED, which does not mean the storage write-back has completed

## 0.6.11

- Track @cysj/room 0.14.5; docs: enqueue hands data to the Host for background saving, and flush is only used to confirm APPLIED

## 0.6.10

- Track @cysj/room 0.14.4; align the Room payment public surface with the local Mock Cloud/fake payment simulation

## Unreleased

- Add in-process Cloud State and fake order delivery Host bindings for local closed-loop checks (`doOrder` / `fulfill` / `cloudFlush`).
- Drive order and cloud callbacks on tick and after room messages.
- Document Scenario `mock_economy.orders`; keep platform `builda.` keys rejected.

## 0.6.9

- Track @cysj/room 0.14.3; fix jco ComponentError enum payload mapping to schema-error

## 0.6.8

- Track @cysj/room 0.14.2; unify CloudStateError as kebab-case, classify ABI exceptions as guest-abi; doOrder compatibly extends outcome

## 0.6.7

- Track @cysj/room 0.14.1; fix CloudValueV1 to use WIT kebab-case tags so online jco no longer rejects int64Value

## 0.6.6

- Track @cysj/room 0.14.0; add the TypeScript Room cloud variable public API

## 0.6.5

- Track @cysj/room 0.13.0; sync the two doOrder interfaces and the minimal trusted order fields.

## 0.6.4

- Track @cysj/room 0.12.0; add secure doOrder order delivery and trusted product context

## 0.6.3

- Track @cysj/room 0.11.1; complete the Host capability for targeted sends to users and the compatibility gate

## 0.6.2

- Track @cysj/room 0.11.0; add an API for sending binary messages targeted by User ID.

## 0.6.1

- Track @cysj/room 0.10.0; add a trusted unixTimeMillis API that never goes backwards across callbacks and recovery

## 0.6.0

- Start the first Room lazily on local Admission and automatically reap it after Ticket, reconnect, and empty-room grace periods expire.
- Keep one concurrent Room while allowing up to 1000 sequential Room generations by default.

## 0.5.0

- Upgrade `ws` to 8.21.0 to resolve published high-severity advisories.
- Add bounded `--rooms N` sequential Room runs so repeated local scenarios do not require restarting the Mock process.

## 0.4.4

- Track @cysj/room 0.9.1; the local Mock aligns any author-initiated close to the ROOM_CLOSED normal terminal state

## 0.4.3

- Track @cysj/room 0.9.0; add public encodeJson/decodeJson APIs that reuse a module-level UTF-8 encoder/decoder.

## 0.4.2

- Pin `@cysj/room` 0.8.1 in the package, keeping the Mock consistent with the delivered Room SDK version.

## 0.4.1

- Local `log` now matches online at 2 KiB per entry, 20 entries per Room per second, and 16 KiB of body text, avoiding passing locally but being truncated online.

## 0.4.0

- The local Room WebSocket tunnel now carries complete `CYR1` frames via `frame_base64`.
- Room handlers, broadcasts, and targeted sends keep opaque bytes end to end and no longer parse gameplay payloads.

## 0.3.0

- The user Room's `log` is only output by the local Mock, uniformly limited to 4 KiB per entry, 20 entries per Room per second, and 64 KiB.
- Local logs normalize levels and use stable `operation/error_code/room_id/room_log_message` fields.

## 0.2.0

- Complete the local authentication, Ticket Assignment, and confirmation flow shared by the three client SDKs.
- Decode the client binary JSON envelope so the public send entry points of H5, Godot, and Unity can all drive Room messages directly.

## 0.1.0

- First open-source TypeScript Room Mock, executing user Room source directly.
- Provides a single Room, synthetic identities, Scenario, state, messages, tick, and loopback WebSocket integration testing.
