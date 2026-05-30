import { readD1Migrations } from '@cloudflare/vitest-pool-workers'
import path from 'node:path'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

const MIGRATIONS_DIR = path.join(__dirname, '../../../drizzle/migrations')

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const migrations = await readD1Migrations(MIGRATIONS_DIR)
  provide('d1Migrations', migrations)
}

declare module 'vitest' {
  export interface ProvidedContext {
    d1Migrations: D1Migration[]
  }
}
