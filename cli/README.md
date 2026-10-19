# hiyori-cli

Command-line client for **[Hiyori](https://github.com/A-1ro/hiyori)** — the Discord-integrated date-coordination tool. Create events, collect `○ / △ / ×` votes, inspect the tally, confirm a date, and pull the confirmed `.ics` — all from your terminal, scriptable with `--json`.

[日本語の概要](../README.md) · [招待・カレンダーの利用条件](../docs/usage.md)

## Build and quick start

Build from this repository so the CLI matches this revision. These instructions do not depend on npm publication. The package is named `hiyori-cli`; its executable is `hiyori`.

Use **Node.js 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+** and **pnpm 10.33.2**, matching the root package and CI. The CLI package's runtime engine is `>=22.12`; building and testing this workspace uses the stricter root requirement.

```bash
git clone https://github.com/A-1ro/hiyori.git
cd hiyori
pnpm install --frozen-lockfile
pnpm -C cli build
node cli/dist/index.js --help

# Explicitly select the production instance (the built-in URL is a placeholder)
node cli/dist/index.js --api-url https://hiyori-schedule.com login
node cli/dist/index.js --api-url https://hiyori-schedule.com whoami
node cli/dist/index.js --api-url https://hiyori-schedule.com event list --json
node cli/dist/index.js --api-url https://hiyori-schedule.com busy

# Optionally save the URL instead of passing --api-url every time
node cli/dist/index.js config set api-url https://hiyori-schedule.com
```

The examples below use `hiyori` as shorthand for `node cli/dist/index.js` from the repository root. They assume the API URL has been saved as above. For self-hosting, replace the production URL with your instance's URL. Device-code login opens a browser for Discord sign-in and approval.

## Configuration

Settings and credentials live under `$XDG_CONFIG_HOME/hiyori/`, or `~/.config/hiyori/` when `XDG_CONFIG_HOME` is unset:

- `config.json` — non-secret settings (e.g. `api-url`).
- `credentials.json` — the session token (file mode `600`), valid only for the exact saved `api-url`; expired tokens are ignored. The file holds one login, so logging in to another instance replaces it.

The API URL is resolved in this order:

1. `--api-url <url>` flag
2. `HIYORI_API_URL` environment variable
3. `hiyori config set api-url <url>`
4. built-in default: `https://hiyori.example.workers.dev` (a placeholder — explicitly select production or your own instance)

## Commands

| Command | Description |
|---|---|
| `hiyori login` / `logout` / `whoami` | Device-code auth against your instance |
| `hiyori config get\|set` | Manage local config (e.g. `api-url`) |
| `hiyori event list\|show\|create\|edit\|rm` | Event CRUD |
| `hiyori candidate ...` | Manage an event's candidate slots |
| `hiyori invite list\|add\|revoke` | Manage an event's username invitations (organizer only) |
| `hiyori vote <id>` | Vote `○ / △ / ×` on candidates |
| `hiyori tally <id>` | Show the participant × slot tally matrix |
| `hiyori busy` | Show confirmed start times for events you participate in (no event ID argument) |
| `hiyori confirm <id> <candidateId...>` / `unconfirm <id>` | Set / cancel the confirmed date |
| `hiyori ics <id>` | Download the confirmed event's `.ics` |
| `hiyori sub ...` | Manage calendar (Webcal) subscriptions |

Global flags: `--api-url <url>`, `--json` (machine-readable output for scripting; `ics` always returns plain ICS text), `-V/--version`, `-h/--help`. `login`, `logout`, and `config` print human-readable text even with `--json`. Run `hiyori <command> --help` for per-command options.

## Examples

The IDs below are placeholders; use IDs returned by your instance.

```bash
hiyori event list --json
hiyori event show EVENT_ID
hiyori tally EVENT_ID
hiyori busy
hiyori ics EVENT_ID -o event.ics

# Full creation flags skip interactive prompts
hiyori event create \
  --title "Team meeting" --description "Monthly meeting" --duration 60 \
  --candidate 2030-01-15T10:00:00.000Z \
  --candidate 2030-01-22T10:00:00.000Z --yes

hiyori vote EVENT_ID --vote CANDIDATE_ID=yes --vote OTHER_CANDIDATE_ID=maybe
hiyori confirm EVENT_ID CANDIDATE_ID OTHER_CANDIDATE_ID

# One subscription for your participating public events, not one per event
hiyori sub add
```

## Invite-only events

Events remain `public` when visibility is omitted. Choose `invite_only` explicitly to limit viewing and voting to the organizer and invited Discord accounts; guests cannot participate.

```bash
# Create the event, candidates and initial invitations together
hiyori --json event create \
  --title "Game night" --duration 90 \
  --candidate 2030-01-15T10:00:00.000Z \
  --visibility invite_only \
  --invite-username alice.name \
  --invite-username @bob

# Change visibility without changing the existing invitations
hiyori event edit EVENT_ID --visibility invite_only

# Organizer-only invitation management
hiyori invite list EVENT_ID
hiyori --json invite add EVENT_ID --username @carol
hiyori --json invite revoke EVENT_ID INVITATION_UUID --yes
```

- Repeat `--invite-username` once per person on `event create`. Initial invitations require `--visibility invite_only`; this is rejected locally otherwise. At most 500 invitation flags are accepted, and normalized duplicates are removed. An event can hold at most 500 pending and claimed invitation records in total.
- Use Discord's unique username, not a display name or an old `name#1234` tag. A leading `@` is optional; surrounding whitespace is trimmed and letters are lowercased. Numeric-only input is always treated as a username. There is no numeric Discord ID input option and no user-directory search or existing-user lookup.
- A username invitation is saved as pending even if the person has never used Hiyori. When an already-signed-in person opens the event or reads it through the CLI/MCP, the server uses the authenticated account’s immutable Discord ID for a fresh Bot-authenticated Discord lookup and binds a matching invitation once. No logout, new OAuth redirect, or repeat consent is needed. Signed-out or new users still complete the normal Discord login. Cached usernames never authorize a claim. Check spellings carefully: the account holding the name at that first match receives access. Renaming before the first match may require a corrected invitation; renaming afterward does not transfer access to another account.
- If Discord lookup is temporarily unavailable or rate-limited, or the Bot token is missing, pending invitations stay unclaimed while existing sessions and already-bound access keep working. Wait briefly and rerun the read command, or use “再試行する” on the event page. All inaccessible events use the same generic 404; it does not confirm whether an event or invitation exists. A genuine authentication failure (401) still requires normal login.
- `invite list` prints full, stable invitation UUIDs for revocation, including pending invitations and legacy numeric-ID records. Only legacy records without a username show their existing Discord ID as a read-only label. Pass the invitation UUID to `invite revoke`, never a username or numeric Discord ID. Revoking a claimed invitation also removes any same-event grants for that bound account. Removed invitations do not return on a later login.
- `invite add` also works on public events, but adding an invitation does not restrict public access or change visibility. Use `event edit --visibility invite_only` to restrict access. `event edit --visibility public` restores public access and retains invitations. Invite-only events are excluded from public Discord announcements and public Webcal feeds.
- Interactive creation/editing offers visibility selection; creation collects invite-only usernames one at a time. Full creation flags skip prompts. With `--json`, create/edit never prompt, so supply the required creation fields or at least one edit flag. `invite add` always requires `--username`. `invite revoke` requires `--yes` in JSON mode or without a TTY; an interactive terminal otherwise asks for confirmation.
- JSON output preserves REST shapes: create returns `{event, candidates}`, edit returns `{event}`, list returns `{invites}`, and add returns `{invite}`. Revoke returns `{revoked: true, eventId, inviteId}` after a successful deletion. Validation, authorization, and API failures produce a nonzero exit and no success JSON. The configured instance remains the authority for access checks and the invitation cap.

## Notes

- Auth uses a `kind:"cli"` session token obtained via the device-code flow; the raw token is stored in the credentials file described above (mode 600) and sent as `Authorization: Bearer`. Use a trusted instance URL; the CLI sends that token to the configured instance.
- CLI-created events are not linked to a Discord channel, and guest voting is browser-only — both are by design (see the main repo).

## License

[MIT](./LICENSE) © A-1ro

Issues & source: <https://github.com/A-1ro/hiyori> (CLI lives in [`cli/`](https://github.com/A-1ro/hiyori/tree/main/cli)).
