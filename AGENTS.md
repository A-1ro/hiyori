# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

`Hiyori` is a Discord-integrated date-coordination web tool deployed as a **single** Cloudflare Worker (frontend, API, static assets all from one Worker). Differentiator: the confirmed date is **auto-distributed to Apple Calendar (and any iCalendar client)** via `.ics` download + Webcal subscription feed, and announced to Discord — coordination through follow-through in one flow.

**Source of truth for product decisions is `docs/requirements.md`.** Read it before proposing features, changing data model, or touching external-integration code. It contains: scope (MVP = F-01〜F-08), data model rationale, Discord/Calendar integration choices, and resolved/unresolved questions in §12. Don't relitigate items already marked decided there.

## Hiyori requirements and mandatory interface parity

**機能追加の場合、Web UI / REST API だけで完了とせず、MCP や CLI にも同様の機能が追加されているかを必ず確認し、できていなければ追加すること。** 入力項目・一覧/詳細出力・作成/編集/取消などの操作・ヘルプ・テストを横断して確認する。機能変更や不具合修正も、該当する全インターフェースへの影響を確認する。

- Hiyori は日程調整から開催日確定・カレンダー配布までを扱う。イベント CRUD、候補日時、投票、集計、確定/取消、ICS、Webcal 購読、および公開範囲・招待管理が主なユーザー操作である。詳細な製品判断は `docs/requirements.md` を優先する。
- Web (`src/client/`)、MCP (`src/server/mcp/agent.ts`)、CLI (`cli/src/`) は同じ Hono API のクライアントである。MCP は `internalApi`、CLI/Web は型付き API クライアントを通し、認可・検証・件数上限・原子的更新などの業務ロジックを API に集約する。クライアント側の表示/検証や MCP annotations を認可の代わりにしない。
- 公開イベントは既定値で、既存のゲスト回答を維持する。招待限定は主催者と招待された Discord アカウントだけが閲覧・回答でき、招待一覧・追加・取消とイベント編集は主催者だけに許可する。詳細・集計・投票・個別 ICS・個人予定・MCP/CLI でも同じアクセス判定を使い、権限のない相手に非公開データや存在を明かさない。公開 Webcal/Discord 通知に招待限定の内容を流さない。
- 新規招待の入力は全インターフェースで **Discord ユーザー名のみ**。表示名や数値 ID の入力/切替、登録ユーザー検索を追加しない。数字だけの名前もユーザー名として扱う。既存の数値 ID 招待は互換性を維持し、旧形式の識別用表示は読み取り専用とする。取消は一覧が返す安定した招待レコード ID を使う。
- 招待は登録有無に依存せず未確定で保存し、新しい Discord OAuth ログインで取得した本人の現在のユーザー名から一度だけ固定 ID に紐付ける。セッションの古いプロフィールから確定/認可しない。全招待合計 500 件、重複排除、初期イベント/候補/招待の原子性、取消後に復活しない性質を維持する。
- MCP の read/write スコープ、CLI の破壊的操作の確認と非対話/JSON 動作を維持する。ゲスト Cookie の回答や署名済み Discord チャンネル連携など、意図的に Web/Discord 限定の機能は `docs/plans/2026-07-21-mcp-server.md` の既定方針に従う。差異は理由を明記し、単なる実装漏れを例外にしない。

### Completion checklist

1. Web / REST / MCP / CLI の対応表を確認し、欠けた入力・操作・出力を実装する。新しい製品上の例外や権限拡大が必要なら、黙って省略/拡大せず確認する。
2. 該当 API と各インターフェースの回帰テストを追加する。正常系だけでなく未認証・非主催者・read-only scope・不正入力・上限/重複・失敗時の部分更新・既存公開動作を確認する。MCP の公開 schema と CLI の実際のフラグ/サブコマンドから API への伝播もテストする。
3. `docs/requirements.md`、README/CLI README、MCP 説明・対応表と CLI help を更新する。
4. 最終コードでサーバー/クライアント/CLI テスト、アプリ/テスト/CLI typecheck、lint、アプリ/CLI build を実行し、モデル変更時は生成 schema/migration も確認する。未実行・失敗した確認は明記する。
5. 承認された公開先だけに反映し、その正確な commit の CI を確認する。ソース/プレビューの対応と、本番 MCP・配布済み CLI の対応を混同しない。PR 更新はマージ・本番デプロイ・npm 公開の許可を意味しない。

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server (uses `@cloudflare/vite-plugin` — runs the Worker locally under miniflare, serves client assets, HMR for both) |
| `pnpm build` | Vite production build → emits client assets to `dist/client/` and Worker bundle to `dist/hiyori/` |
| `pnpm deploy` | `vite build && wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm typecheck:tests` | Typecheck server tests with `tsconfig.test.json` |
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

### Unknown API paths return JSON

`app.notFound()` returns a JSON 404 for unmatched `/api/*` paths and non-GET requests. Other unmatched GET paths receive the HTML shell for client-side routing. Preserve this distinction so RPC clients do not receive HTML errors.

### Authentication (F-06)

Discord OAuth2 + session cookie auth is implemented in `src/server/auth/`.

- **`cookies.ts`**: Cookie constants (`hiyori_session`, `hiyori_oauth_state`), `generateSessionToken`, `hashToken` (SHA-256), `setSessionCookie` / `clearSessionCookie`, `setStateCookie` / `consumeStateCookie`.
- **`session.ts`**: `loadSession(c, app, sessions, users)` — looks up session by token hash, checks expiry, returns `SessionUser | null`. `requireSession` — throws `HTTPException(401)` if no valid session.
- **`discord.ts`**: `buildAuthorizeUrl`, `exchangeCodeForToken`, `fetchDiscordMe`.

OAuth routes: `GET /api/auth/discord` (redirect), `GET /api/auth/discord/callback`, `POST /api/auth/logout`, `GET /api/auth/me`.

State anti-CSRF: state is stored as raw value in the `hiyori_oauth_state` cookie (path-scoped to `/api/auth/discord`). The URL `state` query param is a base64 JSON bundle `{s: rawState, r: safeReturnTo}`. Callback verifies `parsed.s === cookieState`.

Session cookie: `hiyori_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 30-day TTL. Only `tokenHash` (SHA-256) is stored in D1; the raw token never touches the DB.

Test helper: `loginAs(discordUserId)` in `src/server/__tests__/test-helpers.ts` inserts a user+session directly into D1 and returns a `hiyori_session=<token>` string for use as a `Cookie` header.

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

docs/requirements.md       Product decisions, data model rationale, open questions
```

## Versioning notes

- Workspace development requires Node **22.22+ (22.x) or 24.11+** and **pnpm 10.33.2**. Use the pinned package manager so dependency build-script permissions are honored.
- Security overrides in `package.json` constrain affected transitive versions. The esbuild override intentionally updates legacy `@esbuild-kit/core-utils` (0.18.20), `tsx` (0.25.12), `tsup` (0.27.3), and 0.28.0 to 0.28.1; these are build-time tools, so verify both builds and `pnpm db:generate` as well as tests before changing it. Other overrides stay within the existing major (and sharp minor). Revalidate `pnpm audit` before changing or removing overrides.

- **Vite 8** (not 7) — `@vitejs/plugin-react@6` requires it. The requirements doc still says "Vite 7+" which 8 satisfies; don't downgrade.
- **React 19**, **Tailwind v4** (`@tailwindcss/vite` plugin, no `tailwind.config.ts` needed — Tailwind v4 reads CSS-imported config).
- **Wrangler 4** (Vite plugin pulls 4.x; the scaffolder's original `^3` was bumped).
- `pnpm.onlyBuiltDependencies` whitelists `esbuild`, `workerd`, `sharp` — required for their native binaries. New packages with build scripts need explicit approval.
