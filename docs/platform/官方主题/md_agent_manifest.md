# Manifest (builda.publish.json)

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's routing table: read it when creating/editing the manifest, choosing a category, filling minimum browser versions, or configuring leaderboards/IAP/Schemas.

`builda.publish.json` is the single source of truth for the draft:

```json
{
  "title": "Your game",
  "tagline": "One short sentence about the game.",
  "desc": "What players should know before playing.",
  "category": "",
  "engine": "godot",
  "tags": ["godot"],
  "orientation": "landscape",
  "minChromeMajor": 0,
  "minIOSMajor": 0,
  "languages": [],
  "coverKind": "palette",
  "coverPalette": "ember",
  "buildPrefix": "",
  "buildEntry": "index.html",
  "buildSize": 0,
  "bundleUrl": "",
  "bundleMd5": "",
  "bundleVersion": "",
  "bundleEntry": "index.html",
  "bundleSize": 0
}
```

`engine` is written automatically by `new-manifest` from directory detection (`godot|h5|unity`, which also sets the `tags` default); bundle-check and upload pick validation rules by it; do not hand-edit it to a value that does not match the project.

Builda App release display boundary (name, cover, description, promo images):

- Builda draft sync **does not overwrite** the Builda App's top-level name, cover, description or promo images. The only display candidate currently wired in is `title`.
- `title` is only a name candidate saved by the platform. When the user **first submits for release in the App** and the name is still empty, the platform may prefill it; resubmitting after a review rejection is not a first submission and will not auto-use the Builda name again; do not promise the user that renaming the draft changes the name already filled in or published in the Builda App. Later name, cover, description and promo images are edited by the user in the Builda App.
- `tagline` / `desc` are only Builda local plan and web display fields; they are not mapped to the Builda App description/slogan; do not write or send `coverUrl`, `advert` or `images` to change release display. These fields are deprecated (including for the first release); the CLI strips them. Writing them explicitly only yields a deprecation notice and does not change the Builda App display. This does not concern images inside the game bundle or normal build content.
- `title`'s "prefill on first submission only" and "platform keeps saving the candidate" are two separate things. Later `publish` / `update-draft` must still sync builds as usual; do not stop updating because title changed, and do not treat "not successfully released" as first submission.

`category` is a required single-choice gate. Based on the game's core gameplay, choose exactly one of the 28 keys below; write the English key in the manifest — no Chinese, no invented values, no case changes. If it truly fits none, use `other`; in the CLI and server, non-empty unknown values are normalized to `other` as a fallback, but an empty value is still rejected:

```text
action Action               strategy Strategy           rolePlay Roleplay
plot Story                  adventure Adventure         sandBox Sandbox
survival Survival           pzzle Puzzle                mystery Mystery
leisure Casual              simulation Simulation       yangCheng Life sim
card Card                   desktop Board               tower Tower defense
rogueLike Roguelike         shoot Shooter               speed Racing
sport Sport                 fangZhi Idle                music Music
dress Dress up              other Other                 cooperation Co-op
moba MOBA                   asymmetric Asymmetric       party Party game
fight Fighting
```

`pzzle` is the compatibility spelling in the current publish contract; you must use it as is and never change it to `puzzle`. If several types apply, choose the one that best represents the core gameplay. `new-manifest` deliberately leaves `category` empty; the CLI refuses submission until it is chosen. Orientation is only `landscape|portrait`, cover kind only `palette|image`; the CLI validates before upload and names fields to fix.

`languages` is required before upload: the languages the game's player-facing text really supports, as BCP 47 codes such as `["en", "zh"]`. Fill it from the translation tables, locale files, and hardcoded text in the project; text hardcoded in one language counts as one language. Never list a language the game does not support just to pass the check. A missing or empty value fails the upload until you fill it. If the game supports only one language or not English, the CLI prints `language-notice=warning` and continues; relay that to the user in their language and offer to add languages, starting with English. The Builda App currently supports 11 languages, so recommend from these first: `en`, `zh`, `ja`, `es-419`, `fr`, `id`, `pt`, `ru`, `th`, `tr`, `vi`. Your game may also list other languages, and the App may add more later; for how the game reads the current language, see "Localization" in `.builda-agent/sdk-guidance/<sdk-version>/md_sdk_ui.md`. Update the list whenever the game's languages change. The CLI checks this field locally and does not send it to the server.

`minChromeMajor` / `minIOSMajor` are the lowest Chrome major version and lowest Safari iOS major version the game runs on; they are written into the game version info by `create-draft` / `update-draft`, and the platform uses them to block incompatible devices: **the lower the declared value, the more devices can enter the game**. When a player's device is below the declared value (Android checks the WebView's Chrome version, iOS checks the OS version), the App shows "Browser engine version is too old." (in the player's App language) on game launch and exits; the player cannot enter. So fill in the **lowest version the build actually runs on**: do not inflate it (that needlessly locks out older-device players), and do not understate it (below real capability, older devices get a black screen/crash after entering). **Preflight hard check: both fields must be positive integers**; the template's `0` is a placeholder, and the draft cannot be submitted without evaluating and filling them.

How to evaluate: find evidence from the build's real runtime requirements, not gut feeling. Reference points, measured on real Chromium 81/85 builds — **Godot 4.6 and later** Web exports use WebAssembly exception handling and Emscripten's own runtime check, so they **need Chrome 95** (they fail on Chrome 85); older Godot 4 exports need **85** (the Emscripten JS glue uses `??=`; Chrome 81 fails with `SyntaxError`). Multithreaded exports (SharedArrayBuffer) need 88 at least. Unity/Tuanjie WebGL builds tested ran on Chrome 81. The upload check reads these engine requirements from the build itself (see below), so declare what it reports. Raise it if the build uses newer Web APIs. For other H5 games with no reliable evidence, use the platform baseline `81` / `15`. Only pure canvas/DOM H5 games with transpiled JS can go significantly below the baseline; if the build uses newer Web APIs (e.g. OffscreenCanvas, WebGPU, untranspiled newer ES syntax), raise accordingly. Old projects' `builda.publish.json` may lack these two keys; likewise evaluate and add them before submitting a draft.

Builda platform players' Chrome version distribution (Android): about **98.5%** are on 81 or above, **89.5%** on 85 or above, **88%** on 88 or above. So declaring `88` blocks about 12% of players, declaring `81` only about 1.5%. Godot 4.6+ games need Chrome 95, so they turn away more than 12% of players; authors need to know this, and games that care about reach should consider an older Godot 4 export (85) or the H5 engine. Weigh compatibility before filling in for H5 games: to reach more players, prefer lowering the build's runtime requirements (e.g. transpile JS, avoid relying on cross-origin isolation/multithreading) and verify on low-version real devices before lowering the declared value, instead of filling a low value without verification.

**Upload compatibility check (enforced).** `upload-build` scans the JavaScript the build actually loads (from `index.html` through `<script src>`, inline scripts, `import`/`import()`, Workers) and prints `bundle-compat-required-chrome=<N>`, then for every unguarded feature newer than your `minChromeMajor` a `bundle-compat-finding=` line (file:line:col) followed by a `bundle-compat-fix-item=` line with the concrete code fix. `create-draft` / `update-draft` reject the draft while `minChromeMajor` is below N. It also reads engine requirements from the export itself: a `bundle-compat-engine=` line (WebAssembly exception handling = Chrome 95, or the minimum compiled into Emscripten's runtime) cannot be fixed in game code; set `minChromeMajor` to at least that value.

**Fix the code first; do not just raise `minChromeMajor`.** Every device below the declared value is turned away, so raising it trades players for convenience. Apply each `bundle-compat-fix-item`, rebuild, re-upload, and repeat until `bundle-compat=ok`:
- **Syntax** such as `??=` / `||=` / `&&=` (Chrome 85), private methods (84), top-level `await` (89), class `static {}` blocks (94): an older WebView cannot parse the file at all (black or stuck loading screen). Set the bundler target to ES2020 (Vite `build.target: "es2020"`, esbuild `--target=es2020`, TypeScript `"target": "ES2020"`) or rewrite the line as suggested. Syntax cannot be waived.
- **APIs** such as `replaceChildren` (86), Canvas `roundRect` (99), `structuredClone` (98), `Array.prototype.at` (92), `crypto.randomUUID` (92), `Object.hasOwn` (93): they throw when reached. Use the suggested fallback, feature-test before calling, or load a polyfill (core-js or your own `X.prototype.name = ...`). If you already polyfill one in a way the scan cannot see, list its name in `"compatWaivers": ["replaceChildren"]`, only after verifying on an old WebView.
- A finding in `vendor/online/socket.js` (or another Builda Online SDK file) means the SDK copy is outdated: run `builda sdk upgrade`, rebuild and re-upload; do not edit SDK files.

Last resort only: if the code truly cannot be fixed, raise `minChromeMajor` to the printed N; players below it then see the clear "engine version too old" notice instead of a black screen, but they cannot play (see the distribution above: about 10% of players are below Chrome 85, about 12% below 88). Tell the user which players this excludes.

The default manifest deliberately omits `rankBoards`, meaning ordinary updates keep existing leaderboards. To configure leaderboards, add the full array per SDK guidance `.builda-agent/sdk-guidance/<sdk-version>/md_rankboards.md` (for SDK versions before 0.9.7 that file only has runtime notes; read `https://ai.builda.game/game-sdk/releases/0.9.7/md_rankboards.md` instead — the configuration contract is independent of SDK version); write `"rankBoards": []` only when the user explicitly asks to clear all boards.

IAP release config uses `payPoints`; declaring `grantBy: "client" | "room"` explicitly is recommended; omitted or empty string defaults to `client`.
`client` means the client grants items; `room` means the Room grants after redeeming, and the client must not grant rewards again; blanks, null or other values are not accepted.
Omit `payPoints` when there is no IAP; do not change pay points in ordinary build updates. Read the release contract on demand at
`.builda-agent/sdk-guidance/<sdk-version>/md_cysj_app.md` §6.2.2; payment API integration still follows the same-version SDK Skill.

To add or evolve a Builda Online Player Data Object structure, use `objectSchemas` in the manifest, and first read
`https://ai.builda.game/agent/releases/0.4.145/md_object_schemas.md`. Schemas are registered separately via the Builda CLI, not through Builda App review; the same
`schemaId` only allows additive-only evolution — never delete/change existing fields. Do not bind Schema Version to Bundle/Game Version.

After `builda upload-build` succeeds, it writes `prefix`, `entry`, `size` and `bundleUrl/bundleMd5/bundleVersion/bundleEntry/bundleSize` from the response back into the manifest. The former serve Builda online trial play; the latter serve Builda App download, verification and local WebView caching. If the automatic write fails, you must copy them manually; get this step wrong and the draft has no playable entry or App bundle.

Hand off Builda Online Room work per `md_agent_online.md` only when the user explicitly asks.
