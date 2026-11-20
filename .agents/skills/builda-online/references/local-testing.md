# Local Room Mock Workflow

For performance-sensitive tasks, use the unified [performance requirements analysis](plan-gate.md#performance-requirements-and-language-choice); record separate functional and performance acceptance, with unmeasured targets still pending.
This is the required local acceptance gate for new or changed multiplayer behavior, including tasks phrased only as "make a multiplayer game". Run it proactively after implementation, before claiming completion or uploading changed gameplay. A separate user request to test is not required. Install only the open-source Mock for the current Room language: TypeScript uses `@cysj/room-mock`, Rust uses `cysj-room-mock`. Both run only the user's own Room source and do not need Docker, platform source, platform storage or scheduling components, Kubernetes, or online login.

For local verification, start only the current-language Room Mock locked by the manifest. TypeScript uses Node, Rust uses
Cargo; never read the platform repository, call remote build services, or upload source, and do not install the other Room language's toolchain as a workaround.
WASM build/check is a separate preflight, not a prerequisite for starting the local Mock. Do not manually restart the Mock for every match; use the same process to
verify automatic reclamation of empty Rooms and the new Room generation created by the next Admission.

Before starting local testing, there must already be a confirmed multiplayer plan, and the AI must have synced the project-root `builda.online.json`, the current-language Room source, and
the selected client. The confirmation must cover multiple `matchKey`s and each Match's public auto-matchmaking strategy. The Scenario extracts from these three the final Room inputs that can be expressed
locally; never use the Scenario to decide the gameplay for the user in reverse, and never
skip real server logic just because the Mock can start. When config, Room, and client are found to be inconsistent, fix the project files first, then test.

The Room source directory is decided by the user's project and is not required to be named `server/` or `room/`. The AI should keep the existing directory; a new project may choose
`server/` as the recommended directory, but do not force the user to move files because of an example path. The TypeScript Mock's `--room` points to the entry file, and
`--source-root` points to the source root that the Room entry may import from relatively; the entry must be inside the source root, imports must not go beyond that root, and must not import
third-party or platform-internal packages other than the public SDK. The Rust Mock runs from the Cargo Workspace the user chose, and the `local` binary may
live in any canonical package in that Workspace.

The local Mock keeps a local Room directory: several Rooms can run in one process at the same time (default 64), each with its own Room
instance, module state, Seats, tick and empty-Room reclaim. It is idle at startup, and the first local Admission creates a Room. Ticket reservations and
abnormal disconnects are each held for 15 seconds; once a Room has no human reservations, no one online, and no one in a reconnect grace period, it is destroyed after a further 1-second empty-Room grace while other Rooms keep running, and Bots do not keep a
Room alive. The next Admission creates a new Room generation, so the AI does not need to manually restart the process for each match. The Mock provides synthetic identities,
Scenario/Roster/teams/bots, the `create/join/message/tick/disconnect/reconnect/leave/dispose` lifecycle, state, messages, and
a loopback WebSocket. Clients use `local:<player-id>`; one identity holds at most one Seat at a time.

Always start the Mock with `--online-config builda.online.json` so it applies the project's `matchKeys`:

- Room mode: automatic matchmaking fills the fullest released public Room of the same `matchKey`, then creates a new one when `createPublicRoom` allows it, otherwise the Ticket waits and can be cancelled. `lockRoom` really stops automatic matchmaking from sending new players to the Room, and `releaseRoom` reopens it.
- Private Rooms (`privateRoomsEnabled`): the creator enters, other players enter with the shared Room ID, the Room never receives automatic matchmaking, and a full Room is rejected with `ROOM_FULL`.
- Pool/RankPool: a Room forms only when `teamCount × teamSize` single players are waiting on the same `matchKey`, oldest first. RankPool uses each client's `rank_score`, only groups scores inside the current `expansionStages` window (it widens with the oldest wait) and balances team averages; with `botPolicy.enabled`, Bots fill the Room after `defaultFillAfterSeconds`. The Room roster comes from that formation: team IDs are team indexes (`"0"`, `"1"`, ...) like online, and Scenario actors/bots apply only to Room-mode and private Rooms.
- Pool/RankPool Confirm is all-members: a client that enters early waits (`match_connection_pending`), the Room gets no `onJoin` until every human has entered, then everyone joins at once. If someone never enters, the absent Ticket ends as `confirm_timeout` and the others automatically return to the queue. The local Confirm window is `min(confirmTimeoutSeconds, 15 s)`. Clients must use the wait-and-connect flow and enter concurrently; this is a local placement rule, not online matchmaking quality.
- Switching gameplays from a long-running Room works as online: a player may start matchmaking while still in a Room. A Room-mode Ticket is placed only after the old Room is left; a Pool/RankPool Ticket can reach RoomReady while the player is still there. Entering the new Room before the old one is left fails with `ROOM_ROLE_BINDING_BUSY`, so test the handoff order: leave the old Room, wait for success, then connect.

Without `--online-config`, every `matchKey` maps to one Room-mode policy built from the Scenario; use that only for old single-Room tests.

The local Mock contains no platform production logic and does not simulate the Match algorithm, real authentication, Gateway, WebRTC/TURN, platform storage and scheduling, cross-instance recovery, capacity, performance, or security isolation. The TypeScript Mock provides local player data and fake orders/`fulfill`; the Rust Mock provides fake orders and a `fulfill` buffer. This is only for local falsification and does not replace online final verification; for the flow, see [Player Data and Payment Fulfillment](room-cloud-state-and-payment.md).

The local Mock command saves completed game data and player data between restarts. Keep the saved files local; the selected Mock README explains the path and how to start over. Connections, Room state and pending operations are not restored.
It executes Room source with the permissions of the current operating system user; run only the user's own or reviewed code, and do not treat it as a sandbox for untrusted code.

## Local tool preparation

The installer copies SDK/Mock packages; it does not run the Node package manager. This step also applies to installation-only requests and does not require a Scenario or online game binding.

For TypeScript, in the package that owns the Room source, add `@cysj/room` as `file:<relative path to server/typescript>` and `@cysj/room-mock` as `file:<relative path to server/mock/typescript>`, plus the script `"mock": "builda-room-mock"`. Resolve paths relative to that package.json, not the terminal's directory. For a root package these are `file:server/typescript` and `file:server/mock/typescript`; for `room-source/package.json` use `file:../server/typescript` and `file:../server/mock/typescript`.

Use the existing package manager and lock file to install these dependencies (for example `npm install --install-links` or `pnpm install`); update and keep that lock file. With npm, `--install-links` installs file packages and their transitive dependencies instead of relying on dependencies in the source directories. Also install dependencies in the H5/Cocos client package modified by the installer. Do not use frozen installation before the lock reflects the new local dependencies. With npm, run `npm run mock -- --help` from the Room package; with pnpm, run `pnpm run mock --help`. This must resolve the installed local executable and exit successfully. Do not use a global command or an `npx` fallback that downloads a different package. Download completion alone is not tool readiness. If dependencies cannot be installed, report that blocker.

For Rust, reference `cysj-room-sdk = { path = "<relative path to server/rust>" }` in Cargo.toml and wire the Mock only through the optional `local-mock` feature as shown in [Rust Room](room-rust.md). Check Cargo, rustc, and `wasm32-wasip2` only for Rust; the online `--lib` build must not enable `local-mock`. For installation-only requests, verify the toolchain and installed package paths; no game-specific binary is required. After plan confirmation, prepare the Cargo project and run `cargo check --features local-mock --bin local` from its workspace before starting the Mock. Creating game-specific source and Scenario waits for the confirmed plan.

## Required local acceptance gate

For new integration, first run the [minimum two-client checkpoint](integration-workflow.md#3-first-two-client-checkpoint). It is an intermediate milestone; all applicable checks below are still required for the completed gameplay. Put commands, code identity, observations, and blockers in the [integration record](integration-workflow.md#integration-record); changing a tested input invalidates affected results.

- Start the installed same-language Mock with the actual Room source and the Scenario matching the current config. Connect two independently running clients of the selected engine using distinct `local:<player-id>` identities; a Bot or a second fake Room state is not a substitute. Headless instances of the actual client are acceptable when they exercise the same gameplay path; protocol probes alone do not prove the game UI works.
- Exercise the changed gameplay from both clients: joining the same Room, an action from each side and the other client's resulting state/message, applicable settlement/reset, disconnect/reconnect, active leave, and cleanup. Cover each affected `matchKey` in the same Mock process started with `--online-config`; when the gameplay has more than one Room at a time (several tables, private rooms next to public rooms, a full Room that forces a second one), run enough clients to create those Rooms concurrently and check that state and messages never cross Rooms.
- Record the exact commands, source and Scenario paths, two local identities, cases, expected/observed outcomes, and failures. Keep a short reproducible record in the project's existing test notes; never include online credentials. Re-run affected cases after fixes or changes to source, client protocol, config, or Scenario; an earlier pass is not evidence for newer code.
- After exercising representative gameplay for at least five seconds, read `GET /health` on the actual Mock bind address and record `resource_diagnostics`. Warnings do not stop gameplay: inspect `has_warnings`, resources, peaks, online limits, and local thresholds; do not infer a pass from a live process or lack of a popup. Fix warnings, restart the Mock to clear the cumulative report, and rerun affected cases. Report unresolved resource warnings explicitly and do not mark resource acceptance passed. See [Resource Limits](resource-limits.md) for exact checks and the 25% time-window headroom.
- For Rust Room changes involving retained state, allocation, serialization, or cleanup, also complete the [required Rust memory review](room-rust.md#required-memory-design-and-review): bounded collections, cap/overflow cases, repeated lifecycle cycles, and checkpoint/restore evidence when relevant. Record `rust_memory_review` separately; Mock resource warnings do not measure WASM memory.
- Report `local_mock: passed | failed | blocked | not_applicable` separately from online verification. A health response, a process staying alive, static checks, a successful build, or instructions telling the user how to test are not a pass.
- If tools or client execution are unavailable, finish independent implementation and report the exact blocker and missing cases. Do not mark multiplayer complete or upload the unverified change. If manual interaction is indispensable, provide precise steps and wait for observed results; do not invent a pass.
- Read-only tasks and changes confined to text, art, or presentation with no multiplayer behavior change may use `not_applicable`, with a reason. Installation-only tasks finish installation and hand off this gate for development; no game Scenario is required merely to install tools.

## 1. Define the Scenario

Create `builda.room.local.json` in the project root or the current Room test directory, and point to it with `--scenario` when starting the Mock:

```json
{
  "schema_version": 1,
  "room": {
    "room_id": "local-room",
    "room_name": "local-room",
    "game_id": "local-game",
    "tick_rate": 20,
    "max_players": 4,
    "match_key": "local",
    "room_origin": "public_match",
    "match_mode": "room",
    "room_type": "default"
  },
  "actors": [
    { "player_id": "player-a", "seat_id": "seat-a", "team_id": "red" },
    { "player_id": "player-b", "seat_id": "seat-b", "team_id": "blue" }
  ],
  "bots": [
    { "bot_id": "bot-1", "seat_id": "bot-seat-1", "team_id": "red" }
  ],
  "launch_context": { "map": "forest" },
  "mock_economy": {
    "orders": [
      { "orderId": "ord-1", "userId": "player-a", "payId": "gold_pickaxe" }
    ]
  }
}
```

`mock_economy.orders` is optional: it pre-seeds fake orders for the TypeScript / Rust Mock (`userId` corresponds to the Scenario's `player_id`). Usually you do not need it: an order paid on the Builda local mock payment panel (`Builda.iap.showPayPanel(saleId, { grantBy: "room" })`, requires Builda SDK 0.26.5 or later) reaches Room `doOrder` as `allowed` for the current player with `payId=saleId`, so test the real flow — pay on the client, send the `orderId` to the Room, map the trusted `payId`, `fulfill`, then expect `already_delivered` on replay. Any other undeclared `orderId` for the current player defaults to `payId=orderId`. As online, an order is delivered only to its owner while that player is in the Room, and a completed order gives `already_delivered` in every other Room. Call `doOrder` from the message handler that received the `orderId`: outside client callbacks the Mock cannot tell whose first-seen order it is in a Room with several players and rejects it with a `room_mock_order_unattributed` warning.

The Scenario expresses only the final input passed to the user's Room, not the intermediate process of platform matchmaking.
It must cover the Team, human/bot Roster, and non-secret launch parameters that the confirmed plan will pass to the Room. A CF looping room must cover locking, settlement
reset, and re-release; a shadow room must cover mid-session joins/leaves; a Pool must cover single-match settlement and bounded close.

## 2. Start the Mock for the Current Language

TypeScript projects use only the Node toolchain. Run from the prepared Room package (the example uses npm; for pnpm use `pnpm run mock` without npm's separator):

```bash
npm run mock -- \
  --room <entry .ts inside the Room source root> \
  --source-root <Room source root> \
  --sdk <@cysj/room directory installed in the project> \
  --scenario <path to builda.room.local.json> \
  --online-config <path to builda.online.json>
```

Rust projects use only Cargo; the project's `local` binary registers the current Room type:

```bash
cargo run --manifest-path <Room Workspace/Cargo.toml> --features local-mock --bin local -- --scenario <path to builda.room.local.json> --online-config <path to builda.online.json>
```

Both Mocks listen only on `127.0.0.1:7350` by default; the health check is `http://127.0.0.1:7350/health`, and the client Gateway is `ws://127.0.0.1:7350/ws`. Never bind a public address or pass an online token to the Mock.

## 3. User Room Behavior to Verify

1. Two different `local:<player-id>` clients can join the same Room;
2. The Scenario's human, team, bot, and launch parameters enter the public `RoomContext`;
3. `onCreate/onJoin/onMessage/onTick/onDisconnect/onReconnect/onLeave/onDispose` execute as expected;
4. The client-observable results of `setState/patchState/broadcast/send` conform to the public contract;
5. Active leave, abnormal disconnect, Room-initiated close, and invalid input have clear outcomes;
6. `/health` shows `lifecycle=idle` and `active_rooms=0` before the first Ticket, and returns to that state after the last human occupancy disappears and the empty-Room grace
   has passed; the `room_generation` of the next Admission must increment.
7. For each affected Room-mode `matchKey`: automatic matchmaking fills an existing released Room before creating a new one, a player matched after `lockRoom` lands in a different Room, and after `releaseRoom` new players reach the original Room again;
8. For private Rooms: the creator enters, another client enters with the shared Room ID, automatic matchmaking never places players there, and entering after it is full fails with `ROOM_FULL`;
9. When several Rooms run at once, `/health` lists each in `rooms`, and actions in one Room never change another Room's state;
10. For each affected Pool/RankPool `matchKey`: the Room starts only after every human client entered, team IDs come from the roster rather than being hard-coded, a client that never enters sends the others back to waiting, and when Bots are enabled the Room handles Bot seats from the roster.

If players return to the lobby and rematch after settlement, you must also record and assert the following order: the client receives and saves the final settlement, automatically leaves actively,
the Room receives the final `onLeave`, a later tick requests close, and finally `onDispose` fires. Also cover the fallback where a bounded countdown
eventually reclaims the Room when a client has not left. The Room staying in `finished` forever, or `onDispose` firing before the client has observed the settlement message, both count as failures.
The local Mock does not simulate platform Match role occupancy, so local results cannot be used to claim that a second online matchmaking has passed.

A local pass only shows that the current Room business code behaves correctly under the public Mock contract; it does not show that the online platform's internal implementation, WASM ABI, WebRTC, TURN, recovery, capacity, or isolation have passed.

## 4. Run the Online Build Preflight Separately

Fast local integration and WASM build checks are two separate things. When you need to check online build compatibility, TypeScript runs only the project-locked TypeScript Room build/check; only Rust runs `cargo build --target wasm32-wasip2 --release`. Local artifacts are not uploaded; online deployment still uploads source, and the platform rebuilds it.
