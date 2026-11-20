# Local run and debugging: mock test users

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's task table: read it when you need to run, debug or accept an H5 build locally.

Local debugging is entirely based on the mock SDK and mock test users; it does not connect to the real server and needs no token. After producing the H5 build (Godot: the `build/web` export directory; HTML5: a build directory such as `dist/`; Unity: the WebGL export directory), prefer starting it with the Builda local runner; do not make the user hand-assemble URL parameters:

```bash
./.builda-agent/builda dev --web build/web        # Godot export directory
./.builda-agent/builda dev --web dist             # HTML5 build directory (or zip)
./.builda-agent/builda dev --web Builds/WebGL     # Unity WebGL export directory (or zip)
```

`builda dev` is an agent-first minimal debugging host, not an editor. It:

- Runs the H5 build on a local HTTP server and sets the platform-wide COOP/COEP headers (same as the play domain).
- Automatically serves assets as a fallback: `audio/**` and `res/**` under the project-root `assets/` (or set explicitly with `--assets <dir|zip>`; a zip uses the same layout as assets.zip) are mapped to same-origin paths, so `Builda.audio.*` / `assets.url()` work locally as-is — **no need to copy assets into the build directory**; the `dev-assets=` line in the startup output shows the source actually in effect.
- With SDK 0.21.9 or later, the shell starts in the `orientation` from the project's `builda.publish.json` (or `BUILDA_MANIFEST`). Only `landscape` selects landscape; missing, unreadable or invalid metadata keeps portrait and does not block play. Manual rotation does not edit the manifest. Existing projects must explicitly upgrade their SDK; an older shell keeps its previous portrait default and receives no new URL parameter.
- `dev-url` opens the **test shell** (`builda-dev-shell.html`, installed into the project by `sdk install`): a phone-frame iframe loads the game; you can switch landscape/portrait, toggle the notch (safe-area values are injected into the SDK via `builda_mock_safearea`), and show safe-area guides. The platform capsule buttons overlay the game's top-right corner (settings/exit capsule on the right + round multiplayer-members button on the left + chat button, always reserving 160×32, positioned to match the `runtime.capsuleMenuRect()` mock formula). Clicking the capsule pops a simulated platform pause/exit page; clicking the members or chat button pops the corresponding simulated host page (no host events are pushed).
- The mock test user identity is set by URL parameters, default `local-player`; append `&builda_mock_player=<id>&builda_mock_name=<name>` to the URL to switch identity.
- Makes the Builda SDK in the browser use local fake data: `whoami` returns the mock test user, and KV uses localStorage (isolated per test user).

Mock behavior per capability: audio/vibration use the browser's native `Audio` / `navigator.vibrate`; calling `Builda.pay.showPayPanel` / `Builda.ad.showRewardAd` pops a mock modal (in the test shell it is rendered by the shell over the phone screen, simulating the host App panel; when opening `game-url` directly it falls back to an in-page dimmed modal), and a human clicks "Success" / "Failure" to decide the return value (the mock UI follows the browser language: Chinese in a Chinese browser, where these read 成功 / 失败; English otherwise), so the CP can test both the success and failure branches. Do not modify `builda-sdk.js` / `builda-dev-shell.html` to customize behavior — `sdk install` restore or `sdk upgrade` overwrites the whole file; `builda check` does not upgrade the SDK.

The `dev-url` in the command output is the shell entry (`game-url` is the bare game entry without the shell). The developer agent should use `dev-url` as the local acceptance entry: actually run the game in a browser, switch orientation and notch to verify `safeArea()`/`capsuleMenuRect()` avoidance, and observe the mock test user identity (`whoami()` differs after changing the `builda_mock_player` parameter), privateKV per-user isolation (localStorage shows keys like `builda:privatekv:<gameId>:local-player:*`, values in base64), and pay/ad modal behavior. If the output shows `dev-shell=missing`, rerun `sdk install` first.
If the output shows `dev-sdk=missing`, neither the build directory nor the project has `builda-sdk.js`. `builda dev` automatically maps the project's
mock SDK (Godot: `addons/builda/web/builda-sdk.js`; HTML5/Unity: `.builda-agent/sdk/web/builda-sdk.js`) to the web root path and serves it; rerun `sdk install` first, then retry.

Real-device behavior (host audio/payment/ads/identity) is verified only in the Builda App runtime: go through the draft flow and play-test in the Builda app pending-release area. There is no "local integration against the real server" flow.
