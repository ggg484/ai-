---
name: builda-online
description: "Builda multiplayer: planning, client/Room SDKs, matchmaking, local tests, deployment and client releases."
---

# Builda Online Multiplayer Development

Reply in the user's language; this English guidance does not change it.

Builda Agent Server handles authorization, game binding, and client draft publishing; Builda Online handles matchmaking, Rooms, and the gameplay data plane. User tasks only need these two public entry points. Use the selected public client SDK and Room SDK.

## Required development loop

For new or changed multiplayer behavior, follow [the step-by-step workflow](references/integration-workflow.md): confirm plan -> first two-client checkpoint -> complete gameplay -> acceptance -> online only when authorized. Do not wait for a separate testing request. Run local tests proactively with two distinct local client identities before completion or upload; compilation or Mock startup is insufficient. Resume from recorded evidence, invalidate affected results after edits, and report blockers. Read-only and presentation-only work may skip gameplay tests with a reason.

## Delivery version gate

Builda Online follows the base Builda SDK release. `.builda-agent/sdk-version` is the only version lock; `.builda-online/installation.json#releaseId` must match it.

Classify scope before any repair: read-only reviews and diagnostics never install, upgrade, bind a game, rewrite locks, or change dependencies. Run available read-only checks, report missing/drifted installation, and continue independent analysis; do not claim blocked execution was verified.

For implementation, read the installation record and both Skills' versions, then run `.builda-online/bin/builda-online check --local`; local work needs no game binding or login. Plain `check` additionally requires real binding before online work.

- `onlineRelease` equals `sdkVersion`: keep the installed snapshot.
- `ONLINE_RELEASE_DRIFT`: implementation tasks run `.builda-online/bin/builda-online upgrade` to synchronize with the existing lock, then reread the Skill and recheck. This does not select a newer version. Read-only tasks report drift without repair.
- Unrecorded/missing installation: implementation follows setup; read-only tasks report the gap without installing.

At the start of each new multiplayer implementation task, run `builda-online updates` once. This read-only command reports `available`, `current`, `ahead`, or `unavailable` without changing files. For an available release, report current/latest versions and relevant release notes, then recommend upgrading. Ask before changing the lock; continue independent work on the valid pin while waiting. For `unavailable`, report uncertainty and continue local work; for `ahead`, never downgrade. Do not poll repeatedly or require update discovery for read-only reviews.

Only a user-authorized `builda sdk upgrade` advances the lock. Then run `builda-online upgrade`, re-read both Skills, and rerun checks and affected tests. Never edit the lock, silently upgrade during testing/deployment, or use update discovery as compatibility proof. Installation still verifies immutable snapshot digests. Plain `check` must pass before client or Room upload; `deploy` also rejects drift.

An unreachable manifest does not invalidate a locally verified locked install. If install/upgrade is incomplete or drift remains, stop dependent implementation and report it. Details: [startup checks](references/project-checks.md).

## Protocol compatibility revision

The root `builda.online.json` must keep a positive integer `onlineCompatibilityRevision`. It is the only client-Room
game protocol compatibility key, distinct from the client Bundle ID, Builda draft version, Room `version`, and Server Release ID.

Keep the revision by default. Text, UI, images, audio, client-local presentation, or Room fixes compatible with existing client messages
do not bump. Bump only when old clients can't encode requests, understand responses, or keep the state machine, e.g. removing or
redefining message fields, changing message code meanings or required handshake order, or old clients can't finish a match. New optional fields,
server tolerance, and logic fixes keeping message semantics usually don't bump. Never hash source or the whole Bundle to decide compatibility.

Before each protocol change answer: does the new Room still accept old clients' messages; can old clients still understand
the new Room's messages; do the existing join, reconnect recovery, and settlement state machines still hold. All three "yes": keep the revision; only if any is "no"
recommend a bump, and tell the user the affected old clients before changing config. After a bump you must close the loop: "update client draft -> deploy and activate
the same-revision Server Release -> publish the client". If `builda-online deploy` finds the client draft revision differs from config,
stop and run the Builda draft sync first; never change the Bundle ID or re-upload identical code to bypass it.

`builda-online check` reports pending compatibility questions, not proof of review or a real Room test; see `references/project-checks.md`.

## Release decision and fixed order

On "release", "update", or "go live", first answer the three compatibility questions, then pick exactly one branch below. Here
`./.builda-agent/builda publish` only uploads the Bundle and syncs the pending Builda draft; "publish the client" is only the final release and review the user
starts in the Builda App; different actions.

| Branch | revision | Order the user AI must follow |
| --- | --- | --- |
| First release of a multiplayer game | First positive integer, usually `1` | Pass local Mock acceptance -> `builda publish` syncs client draft -> `builda-online deploy` builds and activates same-revision Server Release -> verify target Artifact with a new real Ticket/Room -> ask user to publish client in Builda App |
| Client-only change | Unchanged | Confirm the revision has a usable active Server Release -> build, `builda publish` -> draft playtest -> ask user to publish client in Builda App; never run `builda-online deploy` or redeploy the Room because the Bundle ID changed |
| Room or server config change, compatible with old clients | Unchanged | Pass local Mock acceptance -> `builda-online deploy` -> verify new Artifact with a new Ticket/Room on old client protocol; only if the client also changed: `builda publish`, draft playtest, hand off for publishing; a pure server update uploads no Bundle and does not republish the client |
| Client and Room protocol incompatible | Bump once | Finish new client and Room and pass local Mock acceptance -> `builda publish` syncs new-revision client draft first, unpublished -> `builda-online deploy` activates same-revision Server Release -> verify with a new real Ticket/Room -> ask user to publish client in Builda App |

Never invent a fifth order. A client-only change reuses the existing active Release and requires no deploy receipt this time; on first release or a revision bump
the target revision has no active Release, so the Room deploy must finish before publishing the client. A compatible Room update instantly changes the active Release
for new Tickets of that revision, so confirm backward compatibility first; existing Tickets and running Rooms stay pinned to the original
Artifact. If project evidence can't confirm compatibility or an active Release, stop publishing and tell the user
what evidence is missing; never trial-and-error via blind revision bumps, Bundle re-uploads, or pointless server redeploys.

Server log writing, online log queries, exit reasons, and log performance go to the separate `builda-online-diagnostics` Skill.
For those, read `.agents/skills/builda-online-diagnostics/SKILL.md`; this Skill covers only multiplayer gameplay;
do not duplicate the diagnostics flow.

## AI identity and environment model

You are the user AI in a game developer's project, not the Builda Online platform dev AI. Use only this Skill, public SDKs,
public docs, and user project code; never read, search, or infer the platform repo, trusted service source, internal test environments,
branches, clusters, or ops config.

The user has only **local** (current Room language's open-source Mock runs the same source) and **online** (real service locked by the install record; no test or
sandbox server). Install record URLs are opaque online endpoints; see
[Environment model and config identity](references/environment-and-identity.md).

**Never infer the environment from the page address.** Builda App downloads the game Bundle and loads the real online game via on-device
`http://127.0.0.1:<dynamic port>/...`; so a `window.location.hostname` of `localhost` or
`127.0.0.1` never means the local Room Mock. Web local testing trusts only `builda_mock_shell=1` explicitly injected by the
`builda dev` test shell; native Godot editor runs may trust the engine editor flag.

## Hard constraints

- For a new or materially changed multiplayer flow, start read-only planning: until you read the [Matchmaking scenario guide](references/matchmaking-guide.md) and the author
  confirms the "multiplayer plan confirmation", do not write client code, `builda.online.json`, or Room source;
  never pick by default, enable all capabilities at once, or generate config first and explain later. After confirmation, one implementation proactively maintains config, the single client, current-language
  Room, message protocol, and local Scenario.
- AI must not default to "server authoritative" or "pure relay" for the author. Before implementing, explain plainly: client-reported data
  can be tampered, replayed, sped up, or forged; more Room validation, arbitration, recompute, or snapshots costs CPU, tick, broadcast,
  migration recovery, and capacity budget. Clients may send inputs, intents, candidate state, or state to relay; the author must knowingly confirm how the Room handles
  each message type: reject, trim, validate, arbitrate, recompute, rate-limited relay, direct relay, or presentation-only sync. If the author explicitly picks
  client authority, weak validation, or pure relay, you may implement it, but plan confirmation and delivery notes must state tampering risk, use cases, and that it
  is not anti-cheat or strong fairness.
- Once the language is set, strictly isolate toolchains and docs. A TypeScript Room only installs, reads, edits, verifies the TypeScript SDK;
  never check or install Rust, `rustup`, Cargo, the `wasm32-wasip2` target, or run any `cargo` command.
- Public SDKs only: no own ports, data plane, signaling, matchmaking, or auth; never pick or assemble online fallback entries, edit SDK internals, upload local `.wasm`, or call the Builda CLI
  `online` subcommand; report gaps, never fake success.
- Never guess URLs, `gameId`, or credentials; tokens stay in memory. Deploy only on explicit user request; before upload inventory source paths only; stop on env files, private keys,
  cloud credentials, or user data; report only public fields.
- Local Mock results must not pose as WebRTC, TURN, cross-instance recovery, or online capacity verification.

## Read by phase

Read current-phase docs, the chosen engine example and Room language doc. Suggest Game Data when game-wide, cross-Room data fits the author's requirements; read its guide before implementing it. Local Mock success does not prove online behavior.

| Phase | Must read when entering this phase |
| --- | --- |
| Task start | `references/project-checks.md`, `references/integration-workflow.md` |
| Plan/interview | First `references/matchmaking-guide.md`, then `references/plan-gate.md` and "Automatic selection rules" in `references/client-sdk-selection.md`, then confirm with the author |
| Write client | `references/development-guide.md`, `references/development-guide-client.md`, `references/client-sdk-selection.md`, all of `references/client-lifecycle.md` plus one of `references/client-lifecycle-godot.md` / `references/client-lifecycle-h5-cocos.md` / `references/client-lifecycle-unity.md`, `references/common-flows.md`, `references/environment-and-identity.md` (plus `references/payload-optimization.md` when designing messages) |
| Write Room | `development-guide.md`, `references/development-guide-room.md`, one of `references/room-typescript.md` / `references/room-rust.md`, `references/resource-limits.md`, `payload-optimization.md`, "Room gameplay templates" in `common-flows.md`; changes to Room lifecycle (create, join, leave, close, reconnect, migration recovery) or matchmaking (Ticket, Pool/RankPool, Confirm, private room join) must read all of `client-lifecycle.md`; optional for gameplay rules, message content, or resource budget only |
| Player data and payment | `references/room-cloud-state-and-payment.md`; cross-room or offline targets: `room-player-data.md` |
| Game data/config tables | `references/room-game-data.md`, `references/room-config-tables.md`; paused queues: `room-managed-queues.md` |
| Game minute handlers | `references/game-lifecycle-periodic.md` |
| Local testing | `references/local-testing.md`, "Verification" in `development-guide.md` |
| Online deploy | `references/deployment.md`, `resource-limits.md`, `environment-and-identity.md` |
| Troubleshooting | "Common stable error codes" in `client-lifecycle.md` (logs, exit reasons: read the diagnostics Skill) |

Authorities: matchmaking scenario guide for capabilities and requirements; `client-sdk-selection.md` alone maps public SDK methods; `client-lifecycle.md` alone
governs client lifecycle, control frames, and error codes (never assemble another state machine elsewhere); `common-flows.md` for correct common-feature flows; `resource-limits.md` alone covers
Room resource limits; logs and diagnosis belong only to the diagnostics Skill, which does not redefine the state machine. Before delivery report results per
"Completion criteria" in `development-guide.md`.
