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

**`ENVIRONMENT` (`production` by default, overridden to `development` locally).** `wrangler.jsonc`'s `vars.ENVIRONMENT` is `"production"` — the deployed value. A gitignored `.dev.vars` at the repo root sets `ENVIRONMENT=development`; `.dev.vars` values override same-named `vars` during `wrangler dev` / `pnpm dev` (miniflare reads it) and are ignored by `wrangler deploy`. So `env.ENVIRONMENT` is `development` locally and `production` in prod with no per-deploy flags. **A fresh clone needs its own `.dev.vars`** (it's also where the Discord secrets live) — without `ENVIRONMENT=development` in it, local dev runs in production mode and the React Refresh preamble (gated on `env.ENVIRONMENT !== 'production'`, see below) is not injected, so the page renders blank.

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
- **`session.ts`**: `loadSession(c, app, sessions, users)` — looks up session by token hash, checks expiry, returns `SessionUser | null` (now includes `kind`: `web` / `cli`). Reads the token from the `hiyori_session` cookie **or** an `Authorization: Bearer <token>` header (cookie takes precedence). `requireSession` — throws `HTTPException(401)` if no valid session.
- **`discord.ts`**: `buildAuthorizeUrl`, `exchangeCodeForToken`, `fetchDiscordMe`.

OAuth routes: `GET /api/auth/discord` (redirect), `GET /api/auth/discord/callback`, `POST /api/auth/logout`, `GET /api/auth/me`.

State anti-CSRF: state is stored as raw value in the `hiyori_oauth_state` cookie (path-scoped to `/api/auth/discord`). The URL `state` query param is a base64 JSON bundle `{s: rawState, r: safeReturnTo}`. Callback verifies `parsed.s === cookieState`.

Session cookie: `hiyori_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 30-day TTL. Only `tokenHash` (SHA-256) is stored in D1; the raw token never touches the DB.

Test helper: `loginAs(discordUserId)` in `src/server/__tests__/test-helpers.ts` inserts a user+session directly into D1 and returns a `hiyori_session=<token>` string for use as a `Cookie` header. `loginAsBearer(discordUserId)` does the same with `kind:'cli'` and returns a `Bearer <token>` string for the `Authorization` header.

### CLI 認証基盤（M1, デバイスコード + Bearer）

非ブラウザクライアント（`hiyori` CLI, #36）向けに **RFC 8628 ベースのデバイスコードフロー**をサーバー側に実装（#35）。CLI 本体は別 Issue。

- **モデル `cliAuthRequest.ts`**（テーブル `cli_auth_requests`）: ハンドシェイクの保留状態。`deviceCodeHash`（`.serverOnly()`, SHA-256）/ `userCode`（人間可読 `XXXX-XXXX`, `src/server/auth/cli-device.ts` で紛らわしい文字を除いた 32 文字集合からリジェクションサンプリング生成, ~1.1e12）/ `status`（`pending` / `approved` / `denied` / `completed` / `expired`）/ `userId`（承認時バインド）/ `clientName` / `hostname` / `pollIntervalSec` / `lastPolledAt` / `expiresAt`（10 分 TTL）。
- **ルート**（すべて `index.tsx` のチェーン式内）:
  - `POST /api/auth/cli/start` — `CliAuthRequest` を作成。raw `deviceCode` は**このレスポンスだけ**で返し DB はハッシュのみ。`verificationUriComplete`（`/cli?code=<userCode>`）を返す。
  - `GET /cli` — ブラウザ承認ページ（Hono JSX サーバーレンダリング）。未ログインは既存 Discord OAuth へ 302（`returnTo` 維持）。`clientName` / `hostname` はエスケープ表示。承認/拒否は same-origin JSON fetch。
  - `POST /api/auth/cli/approve` / `deny` — `requireSession` 必須。承認は `status='approved'` + `userId` バインドのみ（**ここでは Session を発行しない**）。
  - `POST /api/auth/cli/poll` — `deviceCode` で照合。初回 `approved` 観測時に **CAS**（`UPDATE ... WHERE id AND status='approved'`, 影響行 1 のときだけ）で `kind:'cli'` の `Session`（TTL `CLI_SESSION_TTL_SECONDS`=90 日）を発行し生トークンを一度だけ返して `completed` に消費。`pending` / `denied` / `expired` / `expired_or_used` / `slow_down`（`lastPolledAt` ベース）を返す。
- **セキュリティ**: 生 deviceCode / 生 session token は DB・ログ・AuditLog に残さない（AuditLog payload は `requestId` ベース）。`start` / `approve` / `deny` は `CF-Connecting-IP` キーの **Rate Limiting binding `CLI_AUTH_RATELIMIT`**（`wrangler.jsonc` の `ratelimits`, 10 req / 60s）で総当たり・DoS を抑止。`approve` / `deny` は `Origin` 検証（CSRF defense-in-depth）。期限切れ行は **cron（`triggers.crons`）→ `scheduled` → `cleanupExpiredCliAuthRequests`** で定期削除。
- AuditLog アクション: `cli.auth.start` / `cli.auth.approve` / `cli.auth.deny` / `cli.auth.token.issued`。

### Discord チャンネル連携（cross-tenant 投稿防止）

Hiyori はマルチサーバー対応（1 Bot を任意の Discord サーバーに招待 OK）だが、**Hiyori にログインした任意のユーザーが任意のチャンネル ID を貼って Bot に投稿させる**攻撃面を塞ぐため、`POST/PATCH /api/events` は raw な `discordChannelId` を一切受け付けない。

- 受け付けるのは `discordChannelToken`（`src/server/discord/channel-token.ts` の HMAC-SHA256 署名トークン、7 日 TTL）のみ。
- 発行ルートは `/hiyori new` スラッシュコマンドのみ（`src/server/index.tsx` の interactions ハンドラ）。Discord 側がスラッシュコマンド実行者のチャンネルアクセス権を保証するので、暗黙の所属チェックになる。
- 検証鍵は `DISCORD_CHANNEL_TOKEN_SECRET` Worker secret。**未設定なら Discord 連携機能は無効**（トークン提示時に 503）。
- UI 側に手動入力フィールドは置かない（`EventComposer` から削除済み）。クライアントは `?channelToken=<jwt-like>` クエリで受け取った値をそのまま `discordChannelToken` として送るだけ。
- 編集ページからは連携の付け替え / 解除は行わない設計。やり直したい場合は `/hiyori new` から作成し直す。
- Embed 内のユーザー入力（`event.title` / `event.description` / `participant.displayName`）は `src/server/discord/markdown.ts` の `escapeMarkdown()` で必ずエスケープ。Bot メッセージは `allowed_mentions: { parse: [] }` を必ず付けて `@everyone` / ロール ping を無効化（`src/server/discord/client.ts`）。

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

cli/                       hiyori CLI（エンドユーザー向け端末クライアント, #36）
├── src/index.ts           commander エントリ + サブコマンド登録
├── src/api.ts             hc<AppType> ラッパ（型のみ共有 + Bearer 注入）
├── src/config.ts          ~/.config/hiyori（config.json + credentials.json mode 600）
└── src/commands/          login/logout/whoami/config + 読み取り系（M2 まで実装）

docs/requirements.md       Product decisions, data model rationale, open questions
```

### CLI パッケージ（`cli/`, pnpm workspace）

エンドユーザー向け CLI（`hiyori` コマンド, Epic #34 / #36）。**pnpm workspace** のメンバー（ルート `pnpm-workspace.yaml` の `packages: ['.', 'cli']`）。Worker 向け Vite ビルドとは別系統で **tsup**（node platform, esm, shebang）でバンドルする。

- 型共有は `import type { AppType } from '../src/server/index'`（**型のみ**。`verbatimModuleSyntax` + tsup `dts:false` でサーバーコードはバンドルに混入しない）。`hc<AppType>(apiUrl, { headers })` で #35 の CLI 認証・読み取り API を型安全に叩く。
- 認証は `hiyori login`（RFC 8628 デバイスコードフロー）→ `kind:'cli'` セッショントークンを `~/.config/hiyori/credentials.json`（mode 600, apiUrl ごとに有効・期限切れは無効）に保存し、各リクエストに `Authorization: Bearer` で送る。
- 接続先は `--api-url` / `HIYORI_API_URL` / `hiyori config set api-url` で上書き可（優先順位はこの順 → config → デフォルト）。
- テストは `cli/vitest.config.ts`（**node 環境**。ルートの workers pool とは別。ルート `vitest.config.ts` は `test.include: ['src/**/*.test.ts']` で CLI テストを除外）。CI は `pnpm -C cli typecheck` / `pnpm -C cli test` を別ステップで実行。
- **実装範囲**: M2（スキャフォールド + login/logout/whoami/config + 読み取り系 event list/show・tally・busy・ics、全 `--json`）まで。M3（書き込み系）/ M4（npm 配布・README）は後続。CLI 作成イベントは Discord チャンネル未連携、ゲスト投票は CLI 非対応。

## Versioning notes

- **Vite 8** (not 7) — `@vitejs/plugin-react@6` requires it. The requirements doc still says "Vite 7+" which 8 satisfies; don't downgrade.
- **React 19**, **Tailwind v4** (`@tailwindcss/vite` plugin, no `tailwind.config.ts` needed — Tailwind v4 reads CSS-imported config).
- **Wrangler 4** (Vite plugin pulls 4.x; the scaffolder's original `^3` was bumped).
- `pnpm.onlyBuiltDependencies` whitelists `esbuild`, `workerd`, `sharp` — required for their native binaries. New packages with build scripts need explicit approval.
