# Builda Online Multiplayer (Handed Off to a Separate Toolchain)

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's routing table: read it when the user explicitly asks for multiplayer, Room development or deployment.


Multiplayer capabilities (matchmaking, Room, authoritative server, local multiplayer debugging, Room packaging and deployment) are delivered by the separate Builda Online
toolchain and released with the same version as the base SDK: the project's `.builda-agent/sdk-version` is the only version lock for multiplayer deliverables.
When the user asks to integrate multiplayer, or develop or deploy a Room, run in the project root:

```bash
./.builda-agent/builda sdk install --with-online
```

The CLI verifies the `online` block of the base manifest for the current SDK version, installs the multiplayer development Skill to `.agents/skills/builda-online/`
and the deploy client to `.builda-online/bin/`, then hands off to the same-version `builda-online install` to install the single client SDK, Room SDK
and local Mock. If it outputs `online-install=needs-room-language`, ask the user for the Room language per the Skill rules, then run
`./.builda-agent/builda sdk install --with-online --room-language typescript|rust` (Windows: `.\.builda-agent\builda.cmd`; it passes the release manifest to `builda-online install`); `online=not-included`
means that SDK version has no multiplayer deliverables. After installing you must read `.agents/skills/builda-online/SKILL.md`; for compatibility decisions and the full
release order, its "Release decision and fixed order" section is the sole authority. For projects already on multiplayer, every later `sdk install`/`sdk upgrade`
makes the multiplayer deliverables follow the version lock; when `builda check` / `sdk check` outputs `online-status=outdated`, run
`./.builda-online/bin/builda-online upgrade`; do not check the manifest on your own schedule. Human-readable install instructions:

```text
https://ai.builda.game/online/setup.md
```

Boundaries and division of labor:

- `onlineCompatibilityRevision` in `builda.online.json` at the multiplayer project root is the only compatibility key between the client and the Room game protocol.
  This CLI writes it into the client draft automatically on `create-draft` / `update-draft`. Keep it unchanged by default; increment it only when the Builda Online
  Skill determines old clients can no longer understand the new Room protocol. Copy, UI, asset and client-only fixes must not increment it, and it must not be replaced by a
  Bundle ID, Builda version ID or Room `version`.
- A release request must first be classified by the Builda Online Skill into four branches: first multiplayer release, client-only, backward-compatible Room update, incompatible protocol upgrade.
  Then: client-only changes reuse the existing active Server Release of the same revision; run only this CLI's `builda publish`, and must not deploy a Room;
  a compatible server-only update only deploys and verifies the Room, uploads no bundle, and does not ask the user to re-publish the client; a first release or incompatible upgrade must
  "sync the client draft first -> then activate the Server Release of the same revision -> finally the user publishes the client in the Builda App".
- Room deployment is done by the deploy client bundled with the Builda Online Skill; the BuildaGame CLI is responsible only for the client draft.
- Before deploying, make sure `builda auth` works. Authorization is completed automatically by the official tools; never ask the user for, display, record or hand-paste any credential.

