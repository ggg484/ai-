# Recovery Strategy and Uninstall

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's routing table: read it when a command fails, an upload/draft must be resumed or completed, or the user asks to uninstall.

- Check local state first with `./.builda-agent/builda status`.
- When `.builda-agent/game.json` exists, use its `gameId` to keep updating the draft; never treat any `last-game-id` receipt as a cross-project update target.
- No grant but `agent-authorization=present`: run the idempotent `./.builda-agent/builda auth` to auto-refresh the short-term grant.
- No grant and no `agent-authorization`: run `./.builda-agent/builda auth` and have the user log in/register on the opened authorization page and click authorize.
- zip uploaded but create/update draft failed: prefer rerunning the same `builda publish <same zip>`; the stable Upload Session key reuses the ready Build. The CLI atomically saves the unconfirmed draft operation in `.builda-agent/last-draft-operation-*`: reruns after network interruption or CLI/machine restart reuse it, and it is deleted once a success response arrives; later, even checking out the same historical content creates a new operation. Do not hand-edit or delete unconfirmed receipts to force a retry. Only when diagnosing manifest or binding problems, reuse the existing `buildPrefix/buildEntry/buildSize`, `bundleUrl/bundleMd5/bundleVersion/bundleEntry/bundleSize` in `builda.publish.json`; after fixing the manifest, run `create-draft` for a new game and `update-draft` for an existing game.
- `assets upload` interrupted: rerun the same command with the original ZIP to resume; use `assets upload-list/upload-status` to inspect. Do not cancel an active validation task.
- `assets.zip` uploaded but create/update draft failed: do not upload again; prefer reusing the existing `assetsVersion/assetsBaseUrl/assetsManifestUrl` in `builda.publish.json`.
- Version already created or updated: prefer reading `.builda-agent/game.json` and the project's `.builda-agent/last-version-id`, show the user title, category, tags, game id, current version id, bundleVersion and orientation; finally remind the user to play-test the Builda pending-release draft in the Builda app and complete the subsequent publishing.
- Grant expired: rerun the idempotent `./.builda-agent/builda auth`; it opens the browser only when refresh fails or there is no local agent authorization;
  do not ask the user to upload source code or copy a token.
- Network failure: keep `last-build.json`, `last-draft.json` and the manifest, and retry the last idempotent or recoverable step.
- Room cloud build/deploy problems: troubleshoot per the Builda Online toolchain docs at `https://ai.builda.game/online/setup.md`. If the deploy client reports an authorization failure, first rerun `./.builda-agent/builda auth` in the project root; authorization is restored automatically by the official tools; never ask the user for any credential.

- `BAD_KEY`, server `200452`, invalid parameters, quota or oversized values are deterministic errors: stop retrying immediately and log clearly. Treat a failed batch as entirely unsuccessful; never retry indefinitely or at high frequency.

Uninstall the current project's toolchain with `./.builda-agent/builda uninstall`: it keeps `game.json`, `sdk-version` and user credentials. Use `uninstall --purge` only when the user explicitly asks for a full wipe; it also deletes project data and the machine-wide shared credentials under `$HOME/.builda-agent/`.
