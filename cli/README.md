# hiyori-cli

Command-line client for **[Hiyori](https://github.com/A-1ro/hiyori)** — the Discord-integrated date-coordination tool. Create events, collect `○ / △ / ×` votes, inspect the tally, confirm a date, and pull the confirmed `.ics` — all from your terminal, scriptable with `--json`.

> Hiyori is OSS and self-host-first (1 instance ≈ 1 Discord server). This CLI talks to **your** Hiyori instance over its typed API; point it at your own deployment with `--api-url` / `HIYORI_API_URL` / `hiyori config set api-url`.

## Install

```bash
npm install -g hiyori-cli
# or run without installing
npx hiyori-cli --help
```

Requires **Node.js >= 22.12** to run the CLI. Building or testing the full workspace requires **Node.js 22.22+ (22.x) or 24.11+** and **pnpm 10.33.2**, as specified by the root package.

## Quick start

```bash
# 1. Point the CLI at your Hiyori instance
hiyori config set api-url https://your-hiyori.example.workers.dev

# 2. Log in (RFC 8628 device-code flow — opens a browser to approve)
hiyori login

# 3. Who am I?
hiyori whoami

# 4. List your events
hiyori event list
```

## Configuration

Settings and credentials live under `~/.config/hiyori/`:

- `config.json` — non-secret settings (e.g. `api-url`).
- `credentials.json` — the session token (file mode `600`), scoped per `api-url`; expired tokens are ignored.

The API URL is resolved in this order:

1. `--api-url <url>` flag
2. `HIYORI_API_URL` environment variable
3. `hiyori config set api-url <url>`
4. built-in default (a placeholder — set your own)

## Commands

| Command | Description |
|---|---|
| `hiyori login` / `logout` / `whoami` | Device-code auth against your instance |
| `hiyori config get\|set\|list` | Manage local config (e.g. `api-url`) |
| `hiyori event list\|show\|create\|edit\|rm` | Event CRUD |
| `hiyori candidate ...` | Manage an event's candidate slots |
| `hiyori invite list\|add\|revoke` | Manage an event's username invitations (organizer only) |
| `hiyori vote <id>` | Vote `○ / △ / ×` on candidates |
| `hiyori tally <id>` | Show the participant × slot tally matrix |
| `hiyori busy` | Show your busy times |
| `hiyori confirm <id> <candidateId...>` / `unconfirm <id>` | Set / cancel the confirmed date |
| `hiyori ics <id>` | Download the confirmed event's `.ics` |
| `hiyori sub ...` | Manage calendar (Webcal) subscriptions |

Global flags: `--api-url <url>`, `--json` (machine-readable output for scripting), `-V/--version`, `-h/--help`. Run `hiyori <command> --help` for per-command options.

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
- A username invitation is saved as pending even if the person has never used Hiyori. It binds once to the Discord account holding that username when the person next completes a fresh Discord OAuth login. An already-open session alone does not claim it. Ask the invitee to use “Discord で招待を確認” on the event page if needed. Check spellings carefully: the account holding the name at that first match receives access. Renaming before the first match may require a corrected invitation; renaming afterward does not transfer access to another account.
- `invite list` prints full, stable invitation UUIDs for revocation, including pending invitations and legacy numeric-ID records. Only legacy records without a username show their existing Discord ID as a read-only label. Pass the invitation UUID to `invite revoke`, never a username or numeric Discord ID. Revoking a claimed invitation also removes any same-event grants for that bound account. Removed invitations do not return on a later login.
- `invite add` also works on public events, but adding an invitation does not restrict public access or change visibility. Use `event edit --visibility invite_only` to restrict access. `event edit --visibility public` restores public access and retains invitations. Invite-only events are excluded from public Discord announcements and public Webcal feeds.
- Interactive creation/editing offers visibility selection; creation collects invite-only usernames one at a time. Full creation flags skip prompts. With `--json`, create/edit never prompt, so supply the required creation fields or at least one edit flag. `invite add` always requires `--username`. `invite revoke` requires `--yes` in JSON mode or without a TTY; an interactive terminal otherwise asks for confirmation.
- JSON output preserves REST shapes: create returns `{event, candidates}`, edit returns `{event}`, list returns `{invites}`, and add returns `{invite}`. Revoke returns `{revoked: true, eventId, inviteId}` after a successful deletion. Validation, authorization, and API failures produce a nonzero exit and no success JSON. The configured instance remains the authority for access checks and the invitation cap.

## Notes

- Auth uses a `kind:"cli"` session token obtained via the device-code flow; the raw token is stored only in `~/.config/hiyori/credentials.json` (mode 600) and sent as `Authorization: Bearer`. It never leaves your machine except to your configured instance.
- CLI-created events are not linked to a Discord channel, and guest voting is browser-only — both are by design (see the main repo).

## License

[MIT](./LICENSE) © A-1ro

Issues & source: <https://github.com/A-1ro/hiyori> (CLI lives in [`cli/`](https://github.com/A-1ro/hiyori/tree/main/cli)).
