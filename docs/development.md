# 開発・セルフホスト

## 必要な環境

- Node.js **22.23.4 以降の 22.x、24.22.1 以降の 24.x、または 26.12.1 以降**。ルート `package.json` の `engines` に従う。CI は 22.23.4 / 24.22.1 / 26.12.1 で検証する。
- **pnpm 10.33.2**（ルート `packageManager` 指定）。依存パッケージのビルドスクリプト許可もリポジトリの設定に従う。
- Cloudflare アカウントはリモートリソース作成・デプロイ時に必要。ローカル D1 / KV は開発環境でエミュレートされる。

## ローカル開発

```bash
git clone https://github.com/A-1ro/hiyori.git
cd hiyori
pnpm install --frozen-lockfile
```

ルートに `.dev.vars`（Git 管理外）を作る。以下は**仮の値**なので、自分の Discord Application の設定に置き換える。コールバック URL は Developer Portal の OAuth2 Redirects にも登録する。

```dotenv
ENVIRONMENT=development
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DISCORD_CLIENT_SECRET=YOUR_CLIENT_SECRET
DISCORD_OAUTH_REDIRECT_URI=http://localhost:5173/api/auth/discord/callback
```

招待の照合には `DISCORD_BOT_TOKEN`、チャンネル連携には Bot と署名鍵などの設定が別途必要。[環境変数一覧](environment.md)と [Bot 構築](discord-bot.md)を参照。MCP をローカルで試さない場合は `.dev.vars` に `MCP_ENABLED=false` を指定できる。

```bash
# 初回はコミット済み SQL migration をローカル D1 に適用
pnpm db:migrate:local

# Vite + ローカル Worker を起動（Docker は不要）
pnpm dev
```

表示されたローカル URL を開く。ポートが 5173 と異なる場合は `DISCORD_OAUTH_REDIRECT_URI` と Discord 側の登録 URL も揃える。

`pnpm db:generate` は初回セットアップでは不要。`src/models/*.ts` のモデル定義を変更した場合に実行し、生成された `drizzle/schema.ts` と SQL migration を確認する。

## セルフホストの設定

自分のアカウントへのリソース作成・デプロイを行う場合の手順。リポジトリの `wrangler.jsonc` には本家用の ID が含まれるため、そのまま使わない。

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create hiyori
pnpm exec wrangler kv namespace create OAUTH_KV
```

1. D1 作成結果の `database_id` を `d1_databases` の `DB` に設定する。DB 名 `hiyori` と `migrations_dir: drizzle/migrations` を維持する。別の DB 名を使う場合は migration コマンドの対象も揃える。
2. KV 作成結果の `id` を `kv_namespaces` の `OAUTH_KV` に設定する。MCP を無効にしても、バインディングを残す場合は自分の KV ID が必要。
3. MCP を利用する場合は `MCP_OBJECT` / `HiyoriMcpAgent` の Durable Object バインディングと `v1` の SQLite migration を維持する。KV は OAuth のグラント・トークン保管用。
4. Worker 名、公開先と `vars` を自分の環境に合わせる。現行設定は `workers_dev: false`。workers.dev で公開する場合は `true` に変更するか、利用する独自ドメインを設定する。デプロイ環境では `ENVIRONMENT=production` を使う。
5. [環境変数一覧](environment.md)に従って Discord OAuth の公開 URL とシークレットを設定する。シークレットは `pnpm exec wrangler secret put <KEY>` で登録し、`vars` に直接書かない。ローカルの `.dev.vars` は本番シークレット登録の代わりにはならない。
6. 必要なら [Discord Bot 構築](discord-bot.md)と [MCP 接続](integrations.md)を設定する。`env.e2e` も本家用の設定なので、自分の環境用に用意するまでは使用しない。

```bash
# 自分の設定・接続対象を確認してから実行
pnpm db:migrate:remote
pnpm deploy
```

初回とスキーマ変更時はリモート D1 に migration を適用する。`pnpm deploy` はビルドと Worker のデプロイを行う。上記はセルフホスト運用者向けの手順であり、ドキュメント変更の検証で実行するコマンドではない。

## 検証とコマンド

CI と同じ主な確認は次のとおり。

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:tests
pnpm -C cli typecheck
pnpm -C cli test
pnpm test
pnpm test:client
pnpm build
pnpm -C cli build
```

モデル変更時は `pnpm db:generate` も実行する。CI は生成後の `drizzle/` に差分がないかも確認する。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Vite 開発サーバー（Worker をローカル実行・HMR） |
| `pnpm build` | 本番ビルド（クライアント → `dist/client/`、Worker → `dist/hiyori/`） |
| `pnpm deploy` | `vite build && wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm typecheck:tests` | サーバーテストの型チェック（`tsconfig.test.json`） |
| `pnpm test:client` | React コンポーネントのテスト（jsdom） |
| `pnpm lint` | Biome による静的チェック |
| `pnpm test` | `vitest run`（Workers プールでテスト） |
| `pnpm db:generate` | `nanoka generate`（モデル → `drizzle/schema.ts`）→ `drizzle-kit generate`（SQL マイグレーション）。**`src/models/*.ts` を変更したら必ず実行** |
| `pnpm db:migrate:local` | ローカル D1 にマイグレーション適用 |
| `pnpm db:migrate:remote` | リモート（本番）D1 にマイグレーション適用 |
| `pnpm discord:register` | Discord スラッシュコマンドを登録（`.dev.vars` を読み込み） |

## 技術構成

単一の **Cloudflare Worker** がフロント・API・静的アセットをすべて配信する。

| 領域 | 採用 |
|---|---|
| ランタイム | Cloudflare Workers（`nodejs_compat`） |
| サーバー | Hono 4（API ＋ SSR シェル）、エントリ `src/server/index.tsx` |
| クライアント | React 19（CSR）、React Router 8、TanStack Query |
| ビルド | Vite 8 ＋ `@cloudflare/vite-plugin`（Worker をローカル miniflare で実行・HMR） |
| DB | Cloudflare D1（SQLite）＋ Drizzle ORM |
| モデル定義 | [`@nanokajs/core`](https://www.npmjs.com/package/@nanokajs/core)（`src/models/*.ts` から Drizzle スキーマを生成） |
| スタイル | Tailwind CSS v4（`@tailwindcss/vite`） |
| 型付き API | Hono RPC（`hc<AppType>`、サーバー型を type-only import） |

> アーキテクチャの要点（per-request `buildApp(env)`、React/Hono の JSX ランタイム混在、React Refresh preamble など）は [開発時の注意](../CLAUDE.md) に詳述。

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

[README に戻る](../README.md)
