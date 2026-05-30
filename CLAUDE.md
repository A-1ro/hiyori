# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`Hiyori` is a Discord-integrated date-coordination web tool deployed as a **single** Cloudflare Worker (frontend, API, static assets all from one Worker). Differentiator: the confirmed date is **auto-distributed to Apple Calendar (and any iCalendar client)** via `.ics` download + Webcal subscription feed, and announced to Discord — coordination through follow-through in one flow.

**Source of truth for product decisions is `docs/requirements.md`.** Read it before proposing features, changing data model, or touching external-integration code. It contains: scope (MVP = F-01〜F-08), data model rationale, Discord/Calendar integration choices, and resolved/unresolved questions in §12. Don't relitigate items already marked decided there.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server (uses `@cloudflare/vite-plugin` — runs the Worker locally under miniflare, serves client assets, HMR for both) |
| `pnpm build` | Vite production build → emits client assets to `dist/client/` and Worker bundle to `dist/hiyori/` |
| `pnpm deploy` | `vite build && wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | `nanoka generate` (models → `drizzle/schema.ts`) then `drizzle-kit generate` (schema → SQL migration in `drizzle/migrations/`) — **run this after any change to `src/models/*.ts`** |
| `pnpm db:migrate:local` | Apply migrations to local D1 |
| `pnpm db:migrate:remote` | Apply migrations to remote D1 (production) |

For local D1, run `wrangler d1 create hiyori` once and paste the returned `database_id` into `wrangler.jsonc`. Secrets (Discord bot token, OAuth client secret, etc.) go through `wrangler secret put`, not `vars`.

## Architecture

### Single-Worker hybrid SSR + CSR

The Worker entry is `src/server/index.tsx`. One Worker serves three responsibilities:

1. **API routes** under `/api/*` (Hono + nanoka model wrappers)
2. **SSR HTML shell** for all other paths (Hono JSX returning a minimal `<html>` with React mount point + Vite-resolved asset tags)
3. **Static client assets** (handled automatically by `@cloudflare/vite-plugin` — no `assets` block needed in `wrangler.jsonc`)

The React app (`src/client/`) mounts (`createRoot(...).render(...)`) into `<div id="root">`. **It is not React SSR** — the Hono shell only ships an empty mount point and asset URLs; React renders client-side. Adding `renderToString` would be a real change in approach, not a one-line tweak.

### Why `buildApp(env)` is called per-request

`src/server/index.tsx` builds the Hono app inside the fetch handler because nanoka's `d1Adapter` needs `env.DB` at construction time. The module-level `export type AppType = ReturnType<typeof buildApp>` extracts the chained route types for the Hono RPC client without actually running the function. **Keep all routes in the chained `app.get(...).get(...)` expression so types flow through to `AppType`** — breaking the chain (e.g. assigning routes to side variables) loses RPC type inference on the client.

### Mixed JSX runtimes — read this before editing `.tsx` files

- **Default JSX is React** (`tsconfig.json`: `jsx: "react-jsx"`, `jsxImportSource: "react"`). All client `.tsx` files use React JSX.
- **`src/server/index.tsx` opts into Hono JSX** via the pragma `/** @jsxImportSource hono/jsx */` at the top of the file. This is required because `vite-ssr-components/hono` returns Hono JSX elements (`<Script>`, `<Link>`, `<ViteClient>`).
- Don't import React JSX components into the server file — the runtimes are not interchangeable. Same problem in reverse for putting Hono JSX in `src/client/`.

### React Refresh preamble — do not delete

`src/server/index.tsx` injects two `<script type="module">` tags into the SSR `<head>` in dev mode. They look removable; they are not. `@vitejs/plugin-react` requires the `__vite_plugin_react_preamble_installed__` flag to be set or it rejects React module execution and the page renders blank with no visible HTTP error. `vite-ssr-components/react`'s `<ReactRefresh />` component does this but returns a React JSX element, which the Hono shell can't render — hence the inline scripts. Gated on `env.ENVIRONMENT !== 'production'` because `/@react-refresh` doesn't exist in prod.

### Data model derivation (nanoka)

`src/models/*.ts` files are the source of truth. Each file exports `{xxx}TableName` and `{xxx}Fields` built with nanoka's `t` builder. Add the file's exports to `nanoka.config.ts`'s `models` array, then run `pnpm db:generate`.

- `.serverOnly()` fields (e.g. `participant.guestToken`, `calendarSubscription.token`) are excluded from both `inputSchema()` and `outputSchema()` — they will never leak through `Model.validator()` or `toResponse()`. Use this for any token/secret.
- `.readOnly()` is for server-generated fields (`id`, `createdAt`) — excluded from input schema, present in output.
- Function defaults like `t.timestamp().default(() => new Date())` emit a warning during `pnpm db:generate` saying the default clause is omitted from SQL. This is fine — the default applies at the nanoka-model layer at insert time, not at the DB layer. Don't try to "fix" the warning by removing the default.

### Hono RPC client

`src/shared/api.ts` exposes `createApi(baseUrl)` returning `hc<AppType>(baseUrl)`. The `import type { AppType } from '../server/index'` is type-only (enforced by `verbatimModuleSyntax: true`) — no server code lands in the client bundle.

### Known sharp edge: SSR catch-all eats unknown API paths

The current `app.get('*')` catch-all returns the SSR HTML shell for **any** unmatched GET, including `/api/<typo>`. That breaks RPC error handling (clients get HTML when expecting JSON). When adding the first real API routes, also add path-aware handling — either narrow the SSR catch-all to non-`/api` paths, or add an `app.notFound()` that returns JSON for `c.req.path.startsWith('/api/')`.

### Authentication (F-06)

Discord OAuth2 + session cookie auth is implemented in `src/server/auth/`.

- **`cookies.ts`**: Cookie constants (`hiyori_session`, `hiyori_oauth_state`), `generateSessionToken`, `hashToken` (SHA-256), `setSessionCookie` / `clearSessionCookie`, `setStateCookie` / `consumeStateCookie`.
- **`session.ts`**: `loadSession(c, app, sessions, users)` — looks up session by token hash, checks expiry, returns `SessionUser | null`. `requireSession` — throws `HTTPException(401)` if no valid session.
- **`discord.ts`**: `buildAuthorizeUrl`, `exchangeCodeForToken`, `fetchDiscordMe`.

OAuth routes: `GET /api/auth/discord` (redirect), `GET /api/auth/discord/callback`, `POST /api/auth/logout`, `GET /api/auth/me`.

State anti-CSRF: state is stored as raw value in the `hiyori_oauth_state` cookie (path-scoped to `/api/auth/discord`). The URL `state` query param is a base64 JSON bundle `{s: rawState, r: safeReturnTo}`. Callback verifies `parsed.s === cookieState`.

Session cookie: `hiyori_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 30-day TTL. Only `tokenHash` (SHA-256) is stored in D1; the raw token never touches the DB.

Test helper: `loginAs(discordUserId)` in `src/server/__tests__/test-helpers.ts` inserts a user+session directly into D1 and returns a `hiyori_session=<token>` string for use as a `Cookie` header.

## File layout

```
src/
├── server/index.tsx       Hono entry (SSR shell + API + AppType export)
├── server/auth/           Discord OAuth, session cookies, loadSession/requireSession
├── client/                React app (entry: main.tsx, root: App.tsx)
├── client/auth/           useSession / useLogout / loginUrl フック
├── shared/api.ts          Hono RPC client factory (type-only server import)
├── models/                nanoka model definitions (one file per table)
└── styles.css             Tailwind v4 entry (just @import "tailwindcss";)

drizzle/
├── schema.ts              nanoka-generated, do not edit by hand
└── migrations/            drizzle-kit-generated SQL

docs/requirements.md       Product decisions, data model rationale, open questions
```

## Versioning notes

- **Vite 8** (not 7) — `@vitejs/plugin-react@6` requires it. The requirements doc still says "Vite 7+" which 8 satisfies; don't downgrade.
- **React 19**, **Tailwind v4** (`@tailwindcss/vite` plugin, no `tailwind.config.ts` needed — Tailwind v4 reads CSS-imported config).
- **Wrangler 4** (Vite plugin pulls 4.x; the scaffolder's original `^3` was bumped).
- `pnpm.onlyBuiltDependencies` whitelists `esbuild`, `workerd`, `sharp` — required for their native binaries. New packages with build scripts need explicit approval.
