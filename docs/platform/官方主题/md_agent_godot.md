# Godot Web export

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's task table: read it when engine=godot and you need to export or package.

1. Confirm the current directory has `project.godot`.
2. Check whether `export_presets.cfg` has a Web/HTML5 preset; if not, tell the user to configure the Web export template in Godot first.
   `sdk install` tries to inject a root-path `builda-sdk.js` reference into an existing Web preset; if bundle-check still reports
   `index.html does not load builda-sdk.js`, check and fix `html/head_include` first, then re-export.
3. Find the Godot command: prefer the Godot major version the project needs, then `godot4`, then `godot`. If the project is Godot 4.6 but the local `godot` is 4.3/4.4,
   do not force the export; first install the matching editor version and Web export template, then export. A missing-template error is usually not a Builda problem.
4. Before exporting, run `./.builda-agent/builda godot web-template-check godot4` or `... godot`. This check verifies that the current `HOME`
   has Web export templates for the matching Godot version. A common problem on a clean HOME is having the Godot binary but no
   `$HOME/.local/share/godot/export_templates/<version>/web_release.zip` or `web_nothreads_release.zip`; in that case do not upload the empty directory from a failed export.
   If another HOME on the same machine already has templates of the same version, you may copy the whole `<version>` directory to the corresponding location under the current HOME; otherwise install the matching Web export templates and retry.
5. The recommended export directory is a temporary directory inside the project, e.g. `build/web`; do not zip the source along with it.
6. Use the Godot Web single-threaded export by default: pin the Web preset to
   `variant/thread_support=false`, `variant/extensions_support=false`, `progressive_web_app/ensure_cross_origin_isolation_headers=false`, `progressive_web_app/offline_page=""`.
   This is the current release baseline for the Android + iOS Builda App WebView; do not enable multithreading/SharedArrayBuffer by default for browser performance. Export a separate multithreaded variant only when the user explicitly asks for an iOS-only multithreaded package.
7. After exporting, there is no need to (and do not) copy the SDK JS into the export directory: the zip does not package the SDK. Verify locally with `builda dev` (it automatically serves the project's dev build); at production runtime the Builda App downloads and injects the matching version from the CDN per the manifest's `sdk` contract.
8. Then package it as a Godot H5 bundle zip: the root must contain `index.html`, `index.js`, `index.wasm`, `index.pck` (the SDK JS is not packaged; the host injects it per the manifest); you must not include source/editor files such as `project.godot`, `export_presets.cfg`, `.env`, `.godot/`, `.git/`, `*.import`.
9. The Godot Web/WASM memory limit must not exceed 1GiB; if the project's export settings configure a larger WebAssembly memory/heap, you must lower it to 1GiB or less before packaging and uploading.
10. `builda bundle-check` hard-checks SDK injection, WebView-compatible export, WASM memory and export structure; on failure, fix the export config, loose SDK JS or HTML head include per the error, and do not continue uploading.

Common command shapes:

```bash
mkdir -p build/web
./.builda-agent/builda godot web-template-check godot4
godot4 --headless --path . --export-release "Web" build/web/index.html
(cd build/web && zip -r ../builda-web.zip .)
./.builda-agent/builda bundle-check --webview-compatible build/builda-web.zip
```

Windows PowerShell packaging commands:

```powershell
.builda-agent\builda.cmd bundle-pack build\web build\builda-web.zip
.builda-agent\builda.cmd bundle-check --webview-compatible build\builda-web.zip
```

If the project's preset name is not `Web`, use the actual preset name from `export_presets.cfg`.
