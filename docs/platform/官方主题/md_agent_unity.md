# Unity WebGL export

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's task table: read it when engine=unity and you need to export or package.

Unity projects (engine=unity) upload the **WebGL build output**, not the Unity project. The full export topic (including common pitfalls) is `.builda-agent/sdk-guidance/<sdk-version>/md_unity_webgl.md`; key points:

1. Environment: Unity 2021.3 LTS+, with the WebGL Build Support module installed. Confirm you have completed `sdk install` per the Unity part of the same-version SDK integration Skill and selected the **Builda** WebGL Template in Player Settings (SDK reference contract, hard-checked by bundle-check).
2. **Compression settings (wrong settings mean outright rejection)**: in `Player Settings → Publishing Settings`, set Compression Format to **Brotli/Gzip with Decompression Fallback checked** (recommended; output `Build/*.unityweb`), or **Disabled** (bare output as fallback). **`.br`/`.gz` output with compression on but Fallback unchecked is hard-rejected**.
3. WASM memory ≤1GiB (Player Settings → Publishing Settings → memory-related settings); above the limit it very likely fails to start in the mobile WebView.
4. Fonts: under WebGL neither TMP nor legacy Font has system font fallback (the editor does — the Game view is not trustworthy). CJK text must embed fonts subset with fontTools; do not put full CJK fonts directly into the bundle. Open-set text such as leaderboard player names needs runtime missing-glyph filtering. Before doing localization or fonts, read chapter 5, "Localization (i18n) and fonts (required reading for CJK)", of `.builda-agent/sdk-guidance/<sdk-version>/md_unity_webgl.md` (TMP/legacy choice, includeFontData trap, full subsetting and missing-glyph filtering flow).
5. `File → Build Settings → WebGL → Build`, output to a temporary directory inside the project (e.g. `Builds/WebGL`). The output should be a root `index.html` + the `Build/` four files (`*.loader.js`/`*.framework.js`/`*.wasm`/`*.data`, `.unityweb` suffix allowed) + `TemplateData/` + optional `StreamingAssets/`. `Build/` is the default output directory name; do not rename it.
6. Zip the contents of the build output directory (the zip root is `index.html` directly):

```bash
(cd Builds/WebGL && zip -r ../../builda-web.zip .)
./.builda-agent/builda bundle-check builda-web.zip
./.builda-agent/builda upload-build builda-web.zip
```

On Windows PowerShell use:

```powershell
.builda-agent\builda.cmd bundle-pack Builds\WebGL builda-web.zip
```

7. unity bundle-check rules: root `index.html` references `builda-sdk.js`; the `Build/` four files are all present (matched by prefix + suffix, any file name); forbidden: bare pre-compressed `.br`/`.gz`, `*.meta`/`*.csproj`/`*.sln`/`*.unity`, `Library/`/`Temp/`/`Obj/`/`ProjectSettings/`, `.map`, `node_modules/`; files under `StreamingAssets/` may have any extension (AssetBundles may have none); everywhere else is limited to the platform allowlist.
8. The whole bundle is subject to the default 200 MiB app limit, and an existing dynamically allowlisted game owned by the current user may be raised to `201..500` MiB per the server value; an empty Unity project is about 5-10MB after Brotli; for mid-to-large projects control size with Strip Engine Code, texture compression and on-demand AssetBundle loading.
