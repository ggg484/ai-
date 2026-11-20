# Multiplayer Plan Gate and Capability Boundaries

This page carries the "plan / interview" stage of the main Skill. When adding multiplayer, turning a single-player game into a multiplayer one, adding a matchmaking entry, or substantially changing an existing multiplayer flow,
first read this page and the [Matchmaking scenario guide](matchmaking-guide.md); you may enter the implementation stage only after the author confirms the "Multiplayer plan confirmation".

## Multiplayer Product Gate

Use a short player-facing confirmation before the detailed implementation matrix: how players gather, whether newcomers join a running game, and where players go after a match. Explain trust/tampering consequences in ordinary terms and recommend a technical mapping with reasons. Ask at most 1-3 unresolved questions at a time. The AI writes technical keys, APIs, and the full matrix; do not make the user fill in platform configuration. Preserve already confirmed choices and avoid a new interview for a repair that keeps the same product behavior. Use the [integration record](integration-workflow.md#integration-record) to retain decisions and their evidence.

When adding multiplayer, turning a single-player game into a multiplayer one, adding a matchmaking entry, or substantially changing an existing multiplayer flow, you must first enter the **read-only plan stage**.
The read-only plan stage allows, and requires, first reading the public capability documents this Skill explicitly references, especially
the [Matchmaking scenario guide](matchmaking-guide.md) and
the "Automatic selection rules" in [Client SDK Selection and Integration](client-sdk-selection.md), and then taking inventory of the existing UI, configuration, client and
Room source in the user project. Until the plan is confirmed, do not write client code, `builda.online.json` or Room source.

The read-only plan stage has three steps:

1. **Public capability inventory**: first understand what the Builda Online public SDK can and cannot do, and for each capability the corresponding configuration,
   client calls, Room responsibilities and verification method. Never confirm a multiplayer plan with the user before reading `references/matchmaking-guide.md`.
   For game-wide data shared across Rooms, consider [Game Data](room-game-data.md) and explain the fit in the plan; it need not be named by the author first.
2. **Project evidence inventory**: read-only inspection of the current game's engine, Room language, existing entry UI, `builda.online.json`, message codes and
   Room code; the existing project structure takes precedence over example paths.
3. **Multiplayer plan confirmation**: in ordinary player language, map the public capabilities into a gameplay flow the user can confirm, then write out the implementation terms and the Key matrix.

Before starting implementation you must produce a "Multiplayer plan confirmation" the user can understand, and it must satisfy the following seven items:

1. The public capability boundary inventory is complete, and every candidate gameplay is mapped to the Admission, public automatic matchmaking,
   Confirm, Bot and lifecycle capabilities Builda Online already supports; any capability missing from the public SDK has been reported as a gap.
2. The client engine has been uniquely determined from project evidence as Godot, H5, Cocos or Unity; if it cannot be uniquely determined, ask the user first.
3. Preserve the author's explicit Room language choice or the existing Room source language. For a new Room with neither, recommend Rust by default; for H5 games, recommend TypeScript instead so the JavaScript/TypeScript client and Room can share protocol definitions and portable pure game logic. Explain the recommendation briefly and ask for confirmation; do not silently choose or migrate an existing Room. A Cocos web export is still a Cocos project, not automatically an H5 project. See the reuse boundaries below.
4. Each gameplay entry has been classified as exactly one of the following, and the user has confirmed the player experience they actually want:
   - **Stay in the same room for the next match after one ends**: e.g. a CF looping room. While waiting, the system may fill in newcomers; once a match starts, newcomers cannot join the current match. After
     settlement and reset, the same room opens again; internally the platform maps this to a Room-mode looping room.
   - **New players can enter a world that is already running**: e.g. MMORPG channels or a shadow world. The world persists for a long time, does not require a full batch of players
     to start, and is not destroyed by a single win or loss; internally the platform maps this to a Room-mode long-lived room.
   - **Gather a fixed number of players for one match, return to the lobby afterwards to find new players**: e.g. regular 1v1, MOBA 5v5. Once the match starts, no strangers are added; after settlement
     the current room ends, and the next match may have different opponents; internally the platform maps this to Pool.
5. For each gameplay, the two independent entries, public matchmaking and private room creation, have been confirmed: the public entry automatically finds a room or waits for a fixed number of players; the private entry creates a room directly,
   and other players join by Room ID. The client shows only the entries enabled in configuration.
6. The user has confirmed the complete Key matrix: each `matchKey` represents one independent gameplay together with its public mode, teams, Confirm
   and Bot policy; the public matchmaking and private room buttons may reuse the same Key. Keys use stable, readable business names.
7. If players may start matchmaking for another gameplay from a long-lived Room such as an MMORPG/shadow room or a looping lobby room, the exit timing for the old Room has been confirmed:
   the platform allows a role that is already in a Room to create and wait on a Ticket, but the same role can still occupy only one Room Seat. Room mode forms a room only after
   the old Room is finally left; Pool may wait until `RoomReady` first, and the client must actively
   leave the old Room and wait for success before connecting to the new Room. The AI must decide when to leave the room based on the gameplay, and implement the cancel, timeout, leave-failure and RoomReady races;
   it must not blanket-forbid players in a Room before matchmaking starts, and must not rely on a new connection silently kicking out the old Seat. When the plan is unclear, use
   the "shadow world + dungeon" example in the [Matchmaking scenario guide](matchmaking-guide.md) to explain to the author the flow players will actually see.

A game may configure multiple `matchKey`s at the same time, but each
`matchKey` can choose only one mode. If the user only says "make it multiplayer", "make a three-player room" or "can play with friends", that is not enough to decide the classification
above; you must ask first. **Never present "drop-in/drop-out or match a single game", "Room or Pool", or "whether to Confirm" directly as user options.**
These words are not concrete enough for non-expert authors. First give common modes with complete flows for the author to compare against, for example: "Is it more like Honor of Kings/LOL regular matchmaking,
where a fixed number of players gather for one match, no newcomers join after it starts, and everyone returns to the lobby at the end; or like a CF/CS looping room, where players stay in the same room for consecutive matches; or
like Legend of Mir/World of Warcraft channels or a Minecraft server, where you enter a world that is already running?" Do not just name games, because the same game may also
have multiple modes. If the author still cannot decide, follow up using characters and moments from their game: "A and B are halfway through a match; if C taps Start now, where will C
go?" After the user answers what players will see, the AI then maps it to a platform mode. When the user has already described it clearly and existing code does not conflict, you may write
the judgment and its basis into the plan confirmation and continue, without mechanically asking again.

After the plan is confirmed, the AI bears full-stack responsibility for the multiplayer implementation. Unless the user explicitly limits the scope to a read-only review, the same implementation must proactively
maintain, and keep consistent:

- The project-root `builda.online.json`: truthfully record the mode, Team, public automatic matchmaking, Confirm,
  Bot, Presence and Room lifecycle policy of every `matchKey`; do not just hand the user a sample to fill in themselves.
- Client business code for the selected engine: implement only the entry, waiting, connection, room-leaving and error UI chosen in the plan.
- The Room source directory for the current language: implement the state handling, input validation, Team/Roster/Bot usage, match start/settlement,
  `lockRoom/releaseRoom` or the corresponding Rust API, reconnect, snapshots and final close confirmed by the author; do not wire up only the client and leave an empty Room.
- The message protocol shared by the client and Room, plus `builda.room.local.json` and local verification runnable in the current language.

When any existing implementation conflicts with the confirmed plan, modify that project file directly and say so; do not keep two mutually contradictory sets of old configuration, old Room
logic or compatibility branches. If the public SDK genuinely lacks a capability, report the gap explicitly; never work around it with a self-built protocol or fake success.

## Room Language Recommendation and Reuse

- Respect an explicit user choice first; otherwise keep an existing Room's language. If those conflict, clarify the intended migration before changing it. Client `package.json` alone does not prove the project already has a TypeScript Room.
- For a new Room without a prior choice, recommend Rust by default. Follow the Rust memory review; the recommendation does not remove allocation bounds or testing requirements.
- For H5 games, recommend TypeScript to stay in the JavaScript/TypeScript ecosystem and reuse more client code. The supported Room entry is TypeScript with `@cysj/room`, not a standalone JavaScript Room target. A JavaScript H5 client can remain JavaScript; adapt extracted shared logic into compatible TypeScript modules as needed, without rewriting the whole client.
- Share message schemas, serialization rules, constants, and portable pure gameplay functions through a small shared module where build tooling supports it. Check its imports and build it for both consumers. Follow [shared source packaging](deployment.md#shared-typescript-code-and-upload-boundaries) so the same modules are included in the Room upload. Keep browser DOM, rendering, engine objects, client storage, client credentials, and browser/Node-only dependencies out of the Room dependency graph.
- Shared code does not make client results trustworthy. Room code still validates inputs and applies the confirmed authority policy; keep authoritative state and secret data out of client bundles. Test behavior on both sides with the same protocol fixtures and run the required two-client Mock acceptance.

### Choose from project evidence, not engine names alone

Apply the existing-language and explicit-choice rules first. For a genuinely new Room, use this decision table to explain the default and any exception:

| Project evidence | Recommendation and reason | Before choosing an exception |
| --- | --- | --- |
| H5 with reusable JS/TS protocol, validation, or pure gameplay logic | TypeScript: one language family reduces duplicate logic and protocol drift | Check actual reusable modules, their imports, and upload containment; rendering code alone is not reusable Room logic |
| H5 with substantial pathfinding, collision, simulation, or large bounded state | Normally prefer TypeScript for H5; when the author explicitly prioritizes server computation performance, recommend Rust as the leading candidate, subject to the analysis below | Identify entities, operations per tick, tick rate, message volume, and memory bounds; compare a representative slice, not language reputation |
| Godot or Unity without existing Room code | Rust default; the client language does not constrain the Room | Consider TypeScript if the maintainer explicitly prefers it and the workload/portability fit; no C# or GDScript Room target |
| Cocos, including web export | Rust default; a web export does not turn Cocos into H5 | Recommend TypeScript as an exception when reusable pure TS modules or the team's maintenance skills provide a concrete benefit |
| Lightweight turn-based, card, board, lobby, or relay gameplay | Keep the engine-based default; both supported languages may fit | Prioritize reuse and maintenance evidence over speculative speed; relay still needs the agreed validation and abuse limits |
| Existing tested Room or team-owned libraries | Preserve the working language; assess whether libraries are allowed and portable | Migration needs an explicit request/confirmation, measured benefit, and a compatibility/test plan; do not migrate merely to match the default |

Inspect code before asking questions. If needed, ask at most one bundled question about unresolved reusable logic, workload, or who will maintain the Room; do not ask a nontechnical author to estimate CPU/fuel. Infer rough workload from the planned gameplay and explain assumptions. AI familiarity alone is not a selection criterion.

Present a short recommendation: **recommended language; project evidence; what can be reused; main constraint; when the alternative would be preferable**. Fold confirmation into the existing multiplayer plan instead of adding another approval gate. For example: "For this H5 game I recommend TypeScript: we can reuse the card rules and message definitions. Browser rendering stays on the client. If the planned simulation proves too costly after reducing unnecessary work, we can measure a Rust alternative."

### Performance Requirements and Language Choice

This section is the single source of truth for interpreting performance requests and their effect on Room language. Other guides link here; numeric resource limits remain in [resource limits](resource-limits.md), and test procedures remain in [local testing](local-testing.md).

Do not translate "fast", "smooth", "high performance", or "many players" directly into a language. Inspect the game first, then distinguish the author's actual goal:

| Performance goal | Inspect and measure | Effect on the recommendation |
| --- | --- | --- |
| Server computation | Players/entities per Room, pathfinding/collision/simulation work, operations and allocations per tick, tick rate and bursts | If server computation is explicitly the top priority, prioritize Rust even for H5; explain the loss of direct JS/TS logic reuse and extra cross-language maintenance. This is a design recommendation, not proof that Rust will be faster for this game |
| Input responsiveness / network latency | Input-to-visible-result time, network round trips, message size/rate, Room processing, prediction and interpolation | Optimize the measured portion; changing Room language does not remove network latency |
| Client frame rate | Target devices, render/frame time, assets and client script work | Profile the client; a Room language change generally does not fix client rendering stalls |
| Player capacity and operating cost | Distinguish players per Room from total concurrent players across Rooms; measure per-Room compute, state size, bandwidth and broadcast fan-out under a representative load | Evaluate Rust if computation is the constraint; do not promise capacity or cost savings from language alone, and do not invent platform-wide capacity from local tests |
| Long-running stability | Allocation growth, collection bounds, cleanup, repeated join/leave/round cycles, checkpoint size and recovery work | Both languages need bounded state and lifecycle tests; Rust is not a substitute for memory/state design |

If the goal remains ambiguous, ask one bundled question in player terms: for example, "Do you mean smoother graphics on phones, quicker response to actions, or more units/players running together? What devices and largest planned match should we target?" Reuse existing answers and do not ask the author to estimate CPU/fuel. If several goals conflict, identify the primary one in the existing plan confirmation.

Turn the goal into a small performance acceptance record in the integration record: target metric and threshold, representative scene/load, target device or online environment, duration and sample count, measurement method, and observed result. Distinguish user requirements from AI-proposed targets and assumptions; never invent a confirmed FPS, latency, tick budget, player count, or acceptable cost. When targets are unknown, propose a baseline experiment and keep performance acceptance pending. For latency/timing, record typical and tail behavior where samples permit, not just a best-case average; record peak memory/traffic and growth across repeated cycles as applicable.

Selection order remains: respect an explicit language choice and preserve an existing Room; then assess the performance requirement; then apply the usual Rust default / H5 TypeScript preference and reuse/maintenance exceptions. For a new H5 Room whose primary goal is server computation performance, present Rust as the preferred exception and state the tradeoff before confirmation. For an existing TypeScript Room, profile and reduce unnecessary work first; propose a migration only with evidence and explicit confirmation. Client FPS or generic "smoothness" alone does not trigger this exception. Fold the recommendation into the existing plan, without a separate approval gate or two production Room implementations.

Neither language guarantees online capacity. First bound algorithms, allocations, and traffic; then measure the representative workload. Local Mock functional results and resource warnings do not certify online CPU/fuel, WASM memory, real network latency, capacity, or cost. Use actual client/device profiling for frame rate and authorized online measurements for production-dependent claims; if unavailable, report that performance acceptance is pending/blocked rather than deploying without permission. Use comparable workloads and environments when evaluating alternatives, and do not change language from a Mock timing alone.

## Requirements Interview

Whenever you add or substantially change a multiplayer entry, or the user only vaguely asks for "multiplayer", "multiple players" or "play with friends", you must read
the [Matchmaking scenario guide](matchmaking-guide.md), first carry out its "Multiplayer requirements interview and plan confirmation", and then use its "External AI
completion checklist" for acceptance of the selected capabilities. When requirements are vague, follow up using the common breakdown examples in the guide; never skip this just because the user did not use platform terms such as Room locked/released.
Questions should first use common modes such as Honor of Kings/LOL regular matchmaking, CF/CS looping rooms, Legend of Mir/World of Warcraft channels or Minecraft servers as
analogies, and explain gathering players, match start, mid-match joining and where players go after settlement all together; if ambiguity remains, describe specific players, tap timing and outcomes. Do not just
swap "drop-in/drop-out / match a single game" for another set of terms and keep making the user guess; when only fixing a clear problem that does not change the existing multiplayer product semantics, you may keep the existing plan.

## Contents of the Multiplayer Plan Confirmation

First take inventory of existing scenes, scripts, `builda.online.json`, message codes and Room; do not overwrite existing gameplay. Before modifying any multiplayer file,
output a short "Multiplayer plan confirmation" according to the "Multiplayer Product Gate" above, stating at least: the client engine, the Room language, which of
CF looping room / shadow room / single-match matchmaking each entry belongs to, all `matchKey`s and their client entries, Room/Pool mode, player count and Team
structure, public automatic matchmaking, when Room mode is locked or released by user Room code,
bot policy, Pool Confirm timeout,
final lifecycle, Room chat, and for each kind of shared data its trust model, tampering risk, Room handling and resource cost.
Room chat is the one capability that is on by default: state in the confirmation that players get the Builda App chat room-wide, and ask only whether the author wants team-only chat or no chat.
When something can be uniquely determined from what the user has already said clearly, existing configuration and code, adopt it directly and state the basis without asking again; when any option that would change the product flow or
Activity cannot be uniquely determined, you must ask the user in ordinary player language and wait for confirmation. At minimum make clear "what happens when a new player taps the entry while others are already playing"
and "where the original players go after a match ends"; if necessary also ask whether strangers may fill a spot after someone leaves mid-match. When many items are undecided,
communicate in rounds, each round prioritizing 1–3 questions that decide the subsequent path,
and do not dump the full checklist on the user at once. Never choose by default, turn on every capability at once, or generate configuration first and explain afterwards.
Also make clear the lifecycle model after a match ends: either reset state within the same Room to continue the next match, or return to the lobby and rematch into
a new Room. Only one of the two may be chosen; any gameplay that rematches into a new Room must design active Room closing for final paths such as normal win/loss, surrender and business timeout;
do not merely set the business state to `finished`.
If a long-lived Room also contains dungeons, battlegrounds or other matchmaking entries, you must also confirm whether the player "leaves the long-lived Room immediately after tapping matchmaking,
and keeps waiting once the exit succeeds", or "waits in the long-lived Room until Pool's RoomReady, then exits and connects to the new Room";
Room mode does not offer the latter timing. Write the choice into the client state machine and error UI; never use "already in a Room" as a reason to disable the matchmaking button.

## Determining the Room Language

Determine the Room language for this task in the plan confirmation:
- When the user has already explicitly specified a language, adopt it directly;
- When the existing `server/` contains only TypeScript evidence such as `package.json`, `tsconfig.json` or `@cysj/room` imports,
  keep TypeScript directly and do not ask again;
- When the existing `server/` contains only Rust evidence such as `Cargo.toml` or a `cysj-room-sdk` dependency, keep Rust directly
  and do not ask again;
- For a new Room, apply the recommendation above and explain it before confirmation. If both kinds of evidence are present or existing code cannot be reliably judged, clarify the active source rather than guessing.
The `roomLanguage` already recorded in `.builda-online/installation.json` should agree with the source evidence; on conflict, stop and explain.
JavaScript and other server languages are not supported; a single user game task modifies only one Room implementation. Do not synchronously rewrite or delete the other example the repository demo
keeps to showcase capabilities, unless the user explicitly asks.

Once the language is determined, strictly isolate toolchains and documentation. A TypeScript Room only installs, reads, modifies and verifies the TypeScript SDK;
it does not check or install Rust, `rustup`, Cargo or the `wasm32-wasip2` target, and does not run any `cargo` command. Only a Rust Room
uses the Rust SDK and the Cargo toolchain. Examples and verification items for the other language are not part of the current task.

## Capability Boundaries

- The Builda SDK handles `whoami`, privateKV, payments, ads, leaderboards, audio, vibration, safe area, text input and host
  lifecycle. For related tasks, also use the project's `builda` skill.
- Builda Online handles runtime token authentication, matchmaking, Room allocation, Presence, authoritative state and the three logical channels; online, these are carried primarily by
  WebRTC DataChannel, and only after the SDK confirms that bounded WebRTC connection attempts have failed may it automatically fall back to standalone WSS.
- The SDK automatically notifies the Builda App of entering/leaving the current Room on first room entry and on leaving the room, room close, reconnect grace exhaustion and Socket close; this is
  host-side state, and game code does not need to, and must not, call the host interface itself.
- Private Rooms are created by the client for a `matchKey` with `privateRoomsEnabled=true` (Godot `create_and_connect_private_room_async`,
  H5/Cocos `createAndConnectPrivateRoom`, Unity `CreateAndConnectPrivateRoomAsync`), and can only be joined by Room ID;
  the creator and members are equals, the platform has no host, and match start, parameter changes and disbanding are decided by user Room code based on the roster; public and private Rooms are written the same way.
- When a player launches the game from a Builda App room invitation, use Godot `take_room_invite_async`, H5/Cocos `takeRoomInvite`, Unity
  `TakeRoomInviteAsync` in the startup flow to read the invitation once, and after obtaining the Room ID join by ID with Godot `join_room_by_id_async`, H5/Cocos
  `joinRoomById`, Unity `JoinRoomByIdAsync` (example `takeRoomInviteAndEnter`); with `available=false` or `invite=null`,
  follow the normal lobby flow. Sending invitations is the Builda App's job; Online provides no send interface.
- Room chat groups are hosted by the Builda App. The Online SDK only, after room entry and using the `team_id` provided by the game, has the host join the group by Room ID, and
  automatically leaves the group on leaving the room, room close and Socket close. When it returns `available=false`, hide the chat entry; never build your own chat service or retry.
  After joining, group messages pushed by the host reach the game through the Godot `received_chat_message`, H5/Cocos `chatMessage` and Unity
  `ChatMessageReceived` events; `senderId` is the sender's `roleId`, including messages you sent yourself. Sending is handled by the Builda App
  chat UI; Online provides no send interface, and messages are not cached or redelivered.
- The multiplayer part of the Builda Skill is only responsible for guiding installation of this Skill. The Builda SDK does not provide `Builda.backend`, signaling, TURN
  or Room APIs; do not call these nonexistent interfaces. This project's multiplayer capabilities use the separate Builda Online public SDK.
- User business code must not create its own listening ports, WebSocket data plane, signaling service, matchmaking service or authentication protocol, and must not actively choose,
  pre-establish or assemble the online fallback entry. Online standalone WSS is enabled automatically only by the public SDK after all bounded WebRTC attempts have explicitly failed and the platform has declared the capability.
  The `local_mock_websocket` installed with the deliverables and bound only to the loopback address is the fixed transport of the local source Mock; it is not a user-built
  service or an online fallback entry.
- The client Bundle and the Room Artifact are two separate artifact pipelines and must not be packaged into each other:
  - The Builda client draft command only uploads the Godot Web/HTML5 Bundle and optional assets.
  - Builda Online's own deployment client in `.builda-online/bin/` submits a TypeScript entry or a Rust Cargo
    Workspace; the platform generates and validates the WASM Component, then activates the Match Activity. Never upload a locally
    precompiled `.wasm`, and never call the Builda CLI's `online` subcommand.

## Gameplays and Entries

A `matchKey` corresponds to a gameplay; the public `mode` only decides the Room, Pool or RankPool matchmaking method. `privateRoomsEnabled=true`
allows the same gameplay to create private rooms directly, joined by Room ID; private rooms have no host, and do not take part in public matchmaking, tier filtering, automatic Bot backfill or
Confirm. Public Pool/RankPool matches still lock the roster. Public matchmaking and private room creation are enabled independently, and new entries may also both be closed.
