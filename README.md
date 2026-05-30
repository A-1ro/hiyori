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
