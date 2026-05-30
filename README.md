# My Nanoka App

A Hono + Drizzle + D1 project scaffolded with `create-nanoka-app`.

## Quickstart

```bash
pnpm install
pnpm exec nanoka generate
pnpm dev
```

`pnpm exec nanoka generate` generates the Drizzle schema from your model definitions. If a `drizzle.config.ts` is present in your project root, it also automatically runs `drizzle-kit generate` to produce SQL migration files.

To apply migrations to your local D1 database in one step:

```bash
pnpm exec nanoka generate --apply --db <DATABASE_NAME>
```

## Discord Bot のセットアップ

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application と Bot を作成
2. `wrangler secret put DISCORD_BOT_TOKEN` — Bot トークンを登録
3. `wrangler secret put DISCORD_PUBLIC_KEY` — Application の公開鍵を登録
4. `wrangler secret put DISCORD_APP_ID` — Application ID を登録
5. Interactions Endpoint URL に `https://{your-worker}.workers.dev/api/discord/interactions` を設定
6. Bot 招待 URL: `https://discord.com/oauth2/authorize?client_id={APP_ID}&scope=bot&permissions=2048`
