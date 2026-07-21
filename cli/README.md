# hiyori-cli

Command-line client for **[Hiyori](https://github.com/A-1ro/hiyori)** — the Discord-integrated date-coordination tool. Create events, collect `○ / △ / ×` votes, inspect the tally, confirm a date, and pull the confirmed `.ics` — all from your terminal, scriptable with `--json`.

> Hiyori is OSS and self-host-first (1 instance ≈ 1 Discord server). This CLI talks to **your** Hiyori instance over its typed API; point it at your own deployment with `--api-url` / `HIYORI_API_URL` / `hiyori config set api-url`.

## Install

```bash
npm install -g hiyori-cli
# or run without installing
npx hiyori-cli --help
```

Requires **Node.js >= 22.12**.

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
| `hiyori vote <id>` | Vote `○ / △ / ×` on candidates |
| `hiyori tally <id>` | Show the participant × slot tally matrix |
| `hiyori busy` | Show your busy times |
| `hiyori confirm <id> <candidateId...>` / `unconfirm <id>` | Set / cancel the confirmed date |
| `hiyori ics <id>` | Download the confirmed event's `.ics` |
| `hiyori sub ...` | Manage calendar (Webcal) subscriptions |

Global flags: `--api-url <url>`, `--json` (machine-readable output for scripting), `-V/--version`, `-h/--help`. Run `hiyori <command> --help` for per-command options.

## Notes

- Auth uses a `kind:"cli"` session token obtained via the device-code flow; the raw token is stored only in `~/.config/hiyori/credentials.json` (mode 600) and sent as `Authorization: Bearer`. It never leaves your machine except to your configured instance.
- CLI-created events are not linked to a Discord channel, and guest voting is browser-only — both are by design (see the main repo).

## License

[MIT](./LICENSE) © A-1ro

Issues & source: <https://github.com/A-1ro/hiyori> (CLI lives in [`cli/`](https://github.com/A-1ro/hiyori/tree/main/cli)).
