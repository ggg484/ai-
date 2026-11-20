# Authorization and Permission Boundaries

> BuildaGame agent toolchain version: 0.4.145

Enter this topic from the base Skill's routing table: read it when uploading/syncing a draft, or submitting feedback with user consent, while authorization is not ready, or when a command reports an authorization failure.

## Authorization state machine

For every task, first run `builda check`. It shows local/remote tool versions; when the remote version is newer it automatically downloads the project's new CLI and new SKILL, and re-syncs the project-level AGENTS.md marker block and agent stub. After the update, continue per the current command output and the base Skill (`.builda-agent/SKILL.md`) rules.

SDK integration alone needs no authorization. `upload-build`, `assets upload`, creating drafts, updating drafts and Feedback requests require an agent grant.
Feedback reuses the same Builda account and authorization; before submitting, get the user's consent to the feedback content and attachments; if an explicit applicable authorization already exists, do not ask again.

Before the first request of any grant-requiring action above, run once:

```bash
./.builda-agent/builda auth
```

For projects inside Studio, the platform auto-injects project-level authorization at task start; for external projects the CLI handles, in order:

1. The current 30-minute grant is verified valid by the server identity endpoint: outputs `authorization=ready`.
2. The grant is missing or about to expire, but the ~30-day local authorization is still valid: silently refresh the grant.
3. Neither is available: open the dedicated browser authorization page.

Run `./.builda-agent/builda auth --force` only when explicitly switching Builda accounts.
Local SDK development itself consumes no grant; do not ask the user to authorize merely because of installing or integrating the SDK.

If any upload, create-draft or update-draft command returns `HTTP 401`, `HTTP 403`, `code=10006`, `auth-required=1`, `Not found.` (older backends return `未找到`)
or a similar authorization failure, read the command output first: if it says auto-refresh is possible or shows `agent-authorization=present`, retry the original command; if it explicitly asks for `builda auth`, run `./.builda-agent/builda auth` and then retry. Do not change the upload URL, and do not ask the user for a token.

When new authorization is needed, `builda auth` creates a browser authorization session, opens BuildaGame's dedicated authorization page, and waits for the result in the terminal:

A remote Agent must run the command in a session whose output it can keep reading. As soon as the CLI outputs `authorization-url`, immediately
send the user one Assistant Markdown message:

```markdown
[Open the Builda authorization page](replace with the full HTTPS URL from the CLI output)
```

If `authorization-code` is also output, show the short code below the link. Do not leave only a bare URL in the terminal tool output,
do not ask the user to select and copy it, and do not wait for `auth` polling to finish before sending the link. After sending the clickable link, keep waiting on the original command;
the CLI resumes on its own once the user completes web authorization.

1. The user logs in in the browser; registers if they have no account.
2. After login/registration, the page returns to the same Agent Authorization page.
3. The user clicks `Allow agent`.
4. The CLI polls and obtains the agent grant, writes it to `$HOME/.builda-agent/token`, and writes the agent authorization to `$HOME/.builda-agent/refresh-token`.
5. You continue the upload/create-draft flow.

If the authorization details also provide a fixed activation entry and short code, render the activation entry as a Markdown link too:

```text
Open on another device:
https://.../activate
Enter code: AB12-CD34
```

The user can open `/activate` on a phone or any device, enter the short code and authorize; the agent never needs the user's password, cookie, session or the page's token.

Note: this is a skill-initiated authorization page, not an install page; the page must not guide the user to install the skill or copy an install command again. The install entry belongs only to scenarios where the user starts from the website home/upload page.

## Permission boundaries

- Do not upload source code, project directories, private keys, `.env`, `node_modules/`, sourcemaps or editor caches; upload only the H5 build zip (Godot Web export / HTML5 build output / Unity WebGL export) and an optional cover. For Unity projects upload only the WebGL build output; project directories such as `Assets/`, `Library/`, `ProjectSettings/` must never go into the package.
- Do not print the contents of `token` under `$HOME/.builda-agent/`.
- Do not print the contents of `refresh-token` under `$HOME/.builda-agent/`.
- The agent grant is valid for 30 minutes and may only be used by the official publishing tools; it is not a full login session.
- The local agent authorization is valid for about 30 days and can only be exchanged for a new short-term agent grant; it cannot upload directly.
- When the short-term grant is missing or expired, rerun the idempotent `./.builda-agent/builda auth`; it auto-refreshes first,
  and opens the browser only when the local agent authorization is missing, expired, or explicitly rejected by the server. After browser authorization the CLI resumes automatically;
  do not ask the user to copy a second command back.
