# Hiyori

Discord 連携の **日程調整 Web ツール**。複数人で候補日を出し合い、`○ / △ / ×` で投票して合意形成し、**確定した日程を Apple Calendar（および任意の iCalendar クライアント）へ自動配信** ＋ **Discord へ自動通知** するところまでを一気通貫で行う。

調整さん・伝助・When2meet などと違い「決めた後の反映」までカバーするのが差別化点 — 確定日時を手でカレンダーに入れ直したり Discord にコピペで告知したりする手間をなくす。

> 詳しい仕様・設計判断は [`docs/requirements.md`](docs/requirements.md)、開発時の注意点は [`CLAUDE.md`](CLAUDE.md) を参照。

## 主な機能（MVP: F-01〜F-08）

- **イベント CRUD** — タイトル / 説明 / 既定所要時間 / 候補枠（開始時刻必須・終了時刻は省略時に自動補完）/ 締切
- **投票** — 候補枠ごとに `○ / △ / ×`、一括入力（曜日・時間帯フィルタ）に対応
- **集計** — 参加者 × 候補枠のマトリクスと合計スコア、最有力枠の提示
- **確定** — オーガナイザーが確定日を選択
- **Discord 通知** — 確定時に Hiyori Bot が指定チャンネルへ埋め込みメッセージを投稿（`.ics` 追加ボタン付き）
- **認証 2 系統** — Discord OAuth2 ログイン（オーガナイザー必須）／ ゲスト投票（表示名のみ・匿名不可）
- **カレンダー配信** — 確定時に `.ics` を生成して 1 タップ追加、さらにユーザー別 **Webcal 購読 URL** で以降の確定を自動反映

## 技術スタック

単一の **Cloudflare Worker** がフロント・API・静的アセットをすべて配信する。

| 領域 | 採用 |
|---|---|
| ランタイム | Cloudflare Workers（`nodejs_compat`） |
| サーバー | Hono 4（API ＋ SSR シェル）、エントリ `src/server/index.tsx` |
| クライアント | React 19（CSR）、React Router 7、TanStack Query |
| ビルド | Vite 8 ＋ `@cloudflare/vite-plugin`（Worker をローカル miniflare で実行・HMR） |
| DB | Cloudflare D1（SQLite）＋ Drizzle ORM |
| モデル定義 | [`@nanokajs/core`](https://www.npmjs.com/package/@nanokajs/core)（`src/models/*.ts` から Drizzle スキーマを生成） |
| スタイル | Tailwind CSS v4（`@tailwindcss/vite`） |
| 型付き API | Hono RPC（`hc<AppType>`、サーバー型を type-only import） |

> アーキテクチャの要点（per-request `buildApp(env)`、React/Hono の JSX ランタイム混在、React Refresh preamble など）は [`CLAUDE.md`](CLAUDE.md) に詳述。

## はじめに

### 前提

- Node.js 20+ / **pnpm**
- Cloudflare アカウント（`wrangler` ログイン済み）

### セットアップ

```bash
pnpm install

# D1 データベースを作成し、返ってきた database_id を wrangler.jsonc に貼る
wrangler d1 create hiyori

# モデル定義 → Drizzle スキーマ → SQL マイグレーション を生成
pnpm db:generate

# ローカル D1 にマイグレーション適用
pnpm db:migrate:local

# 開発サーバー（Vite + miniflare、フロント/Worker 両方 HMR）
pnpm dev
```

ローカル開発用の環境変数・シークレットは **`.dev.vars`**（リポジトリ直下、Git 管理外）に記述する。本番のシークレットは `wrangler secret put` で登録する（[環境変数](#環境変数--シークレット) 参照）。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Vite 開発サーバー（Worker をローカル実行・HMR） |
| `pnpm build` | 本番ビルド（クライアント → `dist/client/`、Worker → `dist/hiyori/`） |
| `pnpm deploy` | `vite build && wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run`（Workers プールでテスト） |
| `pnpm db:generate` | `nanoka generate`（モデル → `drizzle/schema.ts`）→ `drizzle-kit generate`（SQL マイグレーション）。**`src/models/*.ts` を変更したら必ず実行** |
| `pnpm db:migrate:local` | ローカル D1 にマイグレーション適用 |
| `pnpm db:migrate:remote` | リモート（本番）D1 にマイグレーション適用 |
| `pnpm discord:register` | Discord スラッシュコマンドを登録（`.dev.vars` を読み込み） |

## 環境変数 / シークレット

`vars`（非機密）は `wrangler.jsonc` に、シークレットは `wrangler secret put <KEY>` で登録する。ローカル開発ではすべて `.dev.vars` に書けばよい。

| キー | 区分 | 用途 |
|---|---|---|
| `ENVIRONMENT` | var | `development` / `production`。`production` 以外で dev 用 React Refresh preamble を注入 |
| `DISCORD_CLIENT_ID` | var/secret | Discord Application ID（= OAuth2 Client ID） |
| `DISCORD_CLIENT_SECRET` | secret | OAuth2 Client Secret |
| `DISCORD_OAUTH_REDIRECT_URI` | var | OAuth コールバック URL（例: `https://{worker}.workers.dev/api/auth/discord/callback`） |
| `DISCORD_BOT_TOKEN` | secret | Bot トークン（チャンネル通知・コマンド登録に使用） |
| `DISCORD_PUBLIC_KEY` | secret | Interactions の署名検証用 公開鍵 |
| `DISCORD_CHANNEL_TOKEN_SECRET` | secret | チャンネル連携トークン（HMAC-SHA256）の署名鍵。**未設定だと Discord 連携は無効化**（トークン提示時に 503） |
| `EVENT_RETENTION_DAYS` | var | 完了済み（`closed` / `cancelled`）イベントを最終活動から N 日経過後に日次 cron で自動削除する保持日数（正の整数）。**未設定（デフォルト）は自動削除しない = 永久保持** |

> `pnpm discord:register` は `DISCORD_APP_ID`（= `DISCORD_CLIENT_ID` と同値）と `DISCORD_BOT_TOKEN`、任意で `DISCORD_GUILD_ID`（ギルド限定登録）を `.dev.vars` から読む。

### Discord Bot のセットアップ

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application と Bot を作成
2. 上表のシークレットを `wrangler secret put` で登録（ローカルは `.dev.vars`）
3. **OAuth2 → Redirects** に `DISCORD_OAUTH_REDIRECT_URI` と同じ URL を登録
4. **Interactions Endpoint URL** に `https://{your-worker}.workers.dev/api/discord/interactions` を設定
5. `pnpm discord:register` でスラッシュコマンドを登録
6. Bot 招待 URL: `https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&scope=bot&permissions=2048`

> セキュリティ上、`POST/PATCH /api/events` は raw な `discordChannelId` を受け付けず、`/hiyori new` 経由で発行された署名付き `discordChannelToken` のみを受理する（cross-tenant 投稿防止）。詳細は [`CLAUDE.md`](CLAUDE.md) 参照。

## カレンダー連携

- **`.ics` ダウンロード** — `GET /api/events/:id/decision.ics`（確定済みイベントの単発配信）
- **Webcal 購読** — ユーザー別購読 URL を発行し、`GET /feeds/:filename` で ICS フィードを配信。Apple Calendar に一度購読すれば以降の確定が自動反映される

## CLI

Hiyori の **端末クライアント** (`hiyori` コマンド)。読み取り系（イベント一覧・詳細、投票集計、忙しい時間帯、`.ics` ダウンロード）と書き込み系（イベント作成・編集・削除、候補枠追加・削除、投票、確定・確定取消、Webcal 購読管理）をすべて端末から操作できます。すべてのコマンドが `--json` オプションで JSON 出力に対応しており、スクリプト・プログラムからの利用も可能です。

### インストール

npm 実公開後（将来）：

```bash
npx hiyori login
```

**現在はローカルビルド経由**（実公開前）：

```bash
cd /path/to/hiyori
pnpm -C cli build
node cli/dist/index.js login
```

### ログイン

```bash
# デバイスコードフローでブラウザ承認
hiyori login

# 認証状態を確認
hiyori whoami

# ログアウト
hiyori logout
```

RFC 8628 デバイスコード認証フローにより、ブラウザで Discord OAuth ログインを行い、セッショントークンを `~/.config/hiyori/credentials.json`（mode 600）に保存します。

### セルフホスト時の接続先設定

API 接続先の優先順位（高い順）：

1. `--api-url <url>` フラグ
2. `HIYORI_API_URL` 環境変数
3. `hiyori config set api-url <url>` コマンドで保存した設定
4. デフォルト値（`https://hiyori.example.workers.dev`）

セルフホストして Worker を自分の URL にデプロイした場合、以下のいずれかで接続先を指定します：

```bash
# フラグで指定（1 回限り）
hiyori --api-url https://my-hiyori.workers.dev event list

# 環境変数で指定（セッション中）
export HIYORI_API_URL=https://my-hiyori.workers.dev

# 設定ファイルに保存（永続的）
hiyori config set api-url https://my-hiyori.workers.dev
```

### 主要コマンド例

**読み取り系：**

```bash
# イベント一覧を JSON で取得
hiyori event list --json

# イベント詳細を表示
hiyori event show <event-id>

# 投票集計を表示
hiyori tally <event-id>

# 忙しい時間帯を表示（複数参加者が× を投じた時間）
hiyori busy <event-id>

# 確定済みイベントを .ics として保存
hiyori ics <event-id> -o event.ics
```

**書き込み系：**

```bash
# イベント作成（必須フラグが揃っていれば対話をスキップ。--yes でも対話スキップを明示できる）
hiyori event create \
  --title "チーム定例" \
  --description "月 1 回の全体定例会" \
  --duration 60 \
  --candidate 2026-07-01T19:00:00Z \
  --candidate 2026-07-08T19:00:00Z \
  --candidate 2026-07-15T19:00:00Z \
  --yes

# 投票
hiyori vote <event-id> --vote <candidate-id>=yes --vote <candidate-id2>=maybe

# イベント確定（候補 ID は複数指定可）
hiyori confirm <event-id> <candidate-id> [candidate-id...]

# Webcal 購読を追加（自分の確定イベント全体の購読。イベント単位ではない）
hiyori sub add
```

### 制約

**重要：以下 2 点の制約があります。**

1. **CLI で作成したイベントは Discord チャンネル未連携** — CLI の `event create` で作成したイベントは Discord チャンネルに通知されません。Discord への確定通知が必要な場合は、Discord 上で `/hiyori new` スラッシュコマンドを実行してイベントを作成してください。

2. **ゲスト投票は CLI 非対応** — CLI 操作にはすべて Discord OAuth ログインが必須です。表示名のみで投票するゲスト投票は Web UI のみで利用可能です。

## ディレクトリ構成

```
src/
├── server/index.tsx       Hono エントリ（SSR シェル + API + AppType エクスポート）
├── server/auth/           Discord OAuth・セッション Cookie・requireSession
├── server/discord/        チャンネルトークン・Markdown エスケープ・Bot クライアント
├── client/                React アプリ（entry: main.tsx, root: App.tsx）
├── shared/api.ts          Hono RPC クライアントファクトリ（型のみのサーバー import）
├── models/                nanoka モデル定義（1 テーブル 1 ファイル）
└── styles.css             Tailwind v4 エントリ

drizzle/
├── schema.ts              nanoka 生成（手で編集しない）
└── migrations/            drizzle-kit 生成の SQL

docs/requirements.md       製品仕様・データモデル・未解決事項
```

## デプロイ

```bash
pnpm db:migrate:remote   # 本番 D1 にマイグレーション適用（初回・スキーマ変更時）
pnpm deploy              # vite build && wrangler deploy
```

## ドキュメント

- [`docs/requirements.md`](docs/requirements.md) — 製品判断のソース・オブ・トゥルース（スコープ、データモデル、未解決事項）
- [`CLAUDE.md`](CLAUDE.md) — アーキテクチャの勘所と編集時の注意（JSX ランタイム混在、nanoka 派生、認証、Discord 連携のセキュリティ）
