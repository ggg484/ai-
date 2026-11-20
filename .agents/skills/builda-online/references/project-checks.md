# Startup Checks

Every new multiplayer task first passes the main Skill's "Delivery version gate", then completes the project and toolchain checks on this page, and then reads the reference documents
according to the main Skill's "Read by phase" routing.

1. Read the `AGENTS.md` files between the current working directory and the repository root.
2. Confirm the project has the Builda toolchain installed, read `.builda-agent/SKILL.md`, and inspect the engine. For installation and local Mock work, run `builda-online check --local`; no `.builda-agent/game.json`, login, or online binding is required. Scenario `local-game` and `local:<player-id>` values are explicitly synthetic and must never be written as an online game binding. When online testing or deployment is requested, read the real bound `gameId`; if missing, create or bind through the Builda Skill and run `auth` and plain `check`. Never invent a real Game ID. For read-only review, report missing prerequisites without installing, upgrading, or binding. Local runs do not upload source. Before every deployment,
   run `.builda-online/bin/builda-online check` to verify the installation record, the client SDK version actually in the project, and the current Room language,
   Server SDK, and Room Contract install locks; on failure, first repair the installation state per setup or sync the mismatched project dependencies—never continue
   multiplayer work or deployment with drifted versions. Before every deployment you must append
   `--project-root . --room-source <Room source file or directory> --activity-config builda.online.json` and confirm the output shows
   `roomTransferRecovery=safe` (a legacy label for static source checks, not a successful restore test); `deploy` repeats this gate before authorization and upload, and the source check must never be skipped.
   A successful `check` means the client SDK matches what is on disk and the Room language, Server SDK, and Contract install locks are complete; the deployment API also
   checks these install locks exactly against the current online build capabilities. `check` also verifies `onlineRelease` against the version lock's `sdkVersion`; when it reports
   `ONLINE_RELEASE_DRIFT`, for implementation tasks run `.builda-online/bin/builda-online upgrade` (read-only reviews report drift without repair) so the multiplayer deliverables catch up with the version lock—never let an old
   SDK copy new documentation APIs. Before uploading the client or Room you must pass `check` again.
3. Follow [Client SDK Selection and Integration](client-sdk-selection.md) to inspect the project files and uniquely determine Godot, H5, Cocos, or
   Unity. When Builda `engine detect` conflicts with source evidence, stop and explain; do not install multiple client SDKs at the same time. Unity projects always
   use the C# API of the standalone Unity SDK `com.cysj.online` and do not install the H5 SDK; other unrecognized engines are currently unsupported.
4. If the current workspace contains `game/` and `server/`, treat it as a complete game workspace:
   - `game/`: the Godot, H5, Cocos, or Unity client and the Builda release root.
   - `server/`: the TypeScript or Rust Room.
   If the project already keeps the Room source code in another conventional directory, keep using that directory and state it in the plan confirmation, local Mock commands, and deployment commands;
   do not force the user to move directories just to match the example paths.

Read only the documentation of the selected Godot/H5/Cocos/Unity client SDK and the selected TypeScript/Rust Room SDK. `server/` in the delivered workspace
is the user's Room and may be read and written; do not read the trusted service implementation inside the Builda Online platform repositories.

For new or changed multiplayer behavior, include the required local Mock acceptance gate in the task plan, even when the user only asks to build a game. Read [local testing](local-testing.md) before implementation; do not defer it until the user requests testing.

`builda-online check` prints `compatibilityReviewRequired=true`, three `compatibilityQuestionNStatus=pending`
and the questions; it never fakes manual review as an automatic verdict. Legacy
`compatibilityDecision` and `compatibilityQuestionN` are transition-period output only;
`compatibilityDecisionDeprecated=true` means new flows must not treat them as a finished review.
`initialRevision=true` only means config uses first revision `1`, not that a real Ticket/Room was verified.
