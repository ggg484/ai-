# Step-by-step Multiplayer Integration

For performance-sensitive tasks, use the unified [performance requirements analysis](plan-gate.md#performance-requirements-and-language-choice); record separate functional and performance acceptance, with unmeasured targets still pending.
Classify read-only versus implementation scope before the main Skill's version gate; only implementation tasks repair installation. This is the execution path after that gate. Capability decisions belong to [the plan gate](plan-gate.md), lifecycle semantics to [client lifecycle](client-lifecycle.md), and limits to [resource limits](resource-limits.md). Follow the relevant phase links; do not load every engine, language, or advanced feature at once.

## 1. Identify the task and resume point

Run [startup checks](project-checks.md), inspect the selected engine/Room language and real source paths, then read the integration record if one exists. Reconcile it with current files and installed versions; notes are evidence, never authority over code or config.

- Installation only: install, run `check --local` without game binding, report tool readiness, and stop. No gameplay acceptance claim.
- New multiplayer: follow every stage below.
- Existing multiplayer repair: preserve the confirmed plan; reproduce the failure, change the affected path, and rerun affected acceptance. Do not rebuild the whole integration or ask the same product questions again.
- Presentation-only: verify the client change; gameplay tests may be `not_applicable` with a reason. A client-only update does not imply Room deployment.
- Read-only review: report findings without creating a game plan or editing business files.

## 2. Confirm the player experience

Read [matchmaking capabilities](matchmaking-guide.md) and [plan gate](plan-gate.md). Establish how players gather, what happens to a newcomer during play, and what happens after settlement. Infer the engine and existing language from evidence. Preserve an existing Room or explicit language choice; otherwise recommend Rust by default and TypeScript for H5 games, following the plan gate's shared-code boundaries. For genuinely unresolved choices, recommend an option with reasons and ask the author to confirm; do not silently select the Room language, authority model, or a different gameplay.

Record the agreed flow, trust boundaries, enabled entries, and technical mapping. Do not make the user decide API names or edit JSON. Only changes to unresolved product behavior require another confirmation; implementation work and local verification then proceed autonomously.

## 3. First two-client checkpoint

Read [local testing](local-testing.md) before implementing this checkpoint. For new integration, implement one small playable path in the actual project using the selected client SDK, real Room source, shared protocol, and matching Scenario. Keep existing gameplay; add no second server or fake local Room state. Start with one confirmed entry and one meaningful action. Record remaining planned features as pending, not completed.

1. Start the installed same-language Mock with the real source. Start two actual clients of the selected engine using distinct local identities. Use only the explicit local-mode switch described by [client selection](client-sdk-selection.md).
2. Both clients reach a usable Room handle; a ready Ticket alone is insufficient.
3. A sends an action, the Room handles it, and B observes the expected state/message. Reverse the roles and verify A observes B's action.
4. Leave through the public SDK. Re-enter through the confirmed lifecycle and show another action succeeds. Do not replace leave with closing a raw connection.
5. Record observed results and `/health` resource diagnostics. If any step fails, fix this path before expanding features; do not upload source to debug a local failure.

Use [development guide](development-guide.md) for each implementation increment. This checkpoint does not prove complete gameplay, real matchmaking, recovery, or online capacity, and never authorizes deployment.

## 4. Complete the confirmed gameplay

Expand one behavior at a time while keeping config, Room, client, protocol, and Scenario aligned. Cover all confirmed entries, settlement/reset, reconnect, invalid input, and cleanup. Do not present unfinished entries as enabled features or deploy a partial implementation. Shared protocol definitions should be reused or generated where languages permit; otherwise keep one message contract and test encoded messages against both sides.

Read advanced topics only when the agreed game needs them: payment/player data, Bot policy, custom snapshots, or high-frequency sync. For Rust allocation/state changes, complete the memory review in [Rust Room](room-rust.md). Reuse shipped, tested examples for public API calls instead of inventing signatures.

## 5. Accept the current code with evidence

Run the complete [local acceptance gate](local-testing.md), not just the first checkpoint. Separate installation/static checks, two-client gameplay, resource observations, and recovery tests. `check=ok` confirms local installation/config checks; `roomTransferRecovery=safe` is a legacy static-check label, not proof of checkpoint/restore. The Mock does not measure WASM memory or online capacity.

Record exact commands, source/config/Scenario identity, expected and observed outcomes, and unresolved cases. Use the project's revision plus dirty state, or hashes of relevant files when no revision identifies the tested contents. After edits, rerun affected cases and mark stale evidence as such. Do not mark a test passed from a plan, a live process, or an AI's own claim without observations.

If an engine, two clients, real identities, or another required tool is unavailable, complete independent work and report `blocked` with the missing step. Protocol-only probes are useful diagnosis but do not prove the actual game clients work. Do not disable checks, alter SDK internals, or fabricate receipts to obtain a pass.

## 6. Release only when authorized

After explicit deployment authorization, follow exactly the matching release branch in the main Skill and [deployment](deployment.md). First-release, client-only, compatible Room changes, and incompatible protocol changes have different orders. Keep draft upload, Room activation, real two-player verification, and the author's final App publication separate. Local acceptance is not authorization and does not prove online acceptance. If real-player testing is blocked, report that gap; do not describe an activated release as verified.

## Integration record

Reuse the project's existing development/test notes. If none exist, create `docs/multiplayer-integration.md` after plan confirmation. This is a concise handoff record, not a second configuration or a new version lock. Store no tokens or player payloads.

| Record | Contents |
| --- | --- |
| Decisions | Confirmed player flow, trust model, engine/language, evidence and unresolved decisions |
| Source of truth | Paths to actual config, client, Room, protocol definitions and Scenarios; link instead of copying their contents |
| Current stage | First checkpoint, implementation, acceptance or online; next concrete action and blocker |
| Test evidence | Command, tested revision/dirty state or hashes, case, expected/observed result, timestamp, passed/failed/blocked/not_applicable |
| Resource/recovery | Mock warnings and relevant Rust memory/restore evidence; online-only gaps explicitly pending |
| Release state | Client draft, Room activation, real-player verification and final publication recorded separately |

On resuming, verify these facts against the project before continuing. On handoff, summarize completed behavior, failing/blocked cases, and the next action; never require the user to reconstruct progress from conversation history.
