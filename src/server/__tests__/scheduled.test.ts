import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env, applyD1Migrations, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { inject } from 'vitest'
import worker, { EVENT_CLEANUP_CRON, type Env } from '../index'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const DAY = 24 * 60 * 60 * 1000
const HOURLY_CRON = '0 * * * *'
const NOW = new Date('2026-07-22T03:00:00.000Z')
const RETENTION_DAYS = 30

function db(): D1Database {
  return (env as { DB: D1Database }).DB
}

async function insertExpiredCliAuthRequest(): Promise<string> {
  const id = crypto.randomUUID()
  await db()
    .prepare(
      `INSERT INTO cli_auth_requests (id, deviceCodeHash, userCode, status, expiresAt, createdAt)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(id, 'deadbeef', 'ABCD-1234', NOW.getTime() - 2 * 60 * 60 * 1000, NOW.getTime() - 3 * 60 * 60 * 1000)
    .run()
  return id
}

async function insertExpiredClosedEvent(): Promise<string> {
  const id = crypto.randomUUID()
  const old = NOW.getTime() - (RETENTION_DAYS + 1) * DAY
  await db()
    .prepare(
      `INSERT INTO events (id, organizerDiscordId, title, defaultDurationMinutes, status, timezone, createdAt)
       VALUES (?, ?, ?, ?, 'closed', ?, ?)`,
    )
    .bind(id, '12345678901234567', 'テストイベント', 60, 'UTC', old)
    .run()
  return id
}

async function count(table: string, where: string, ...binds: unknown[]): Promise<number> {
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function runScheduled(cron: string): Promise<void> {
  const controller = createScheduledController({ cron, scheduledTime: NOW.getTime() })
  const ctx = createExecutionContext()
  await worker.scheduled!(controller, env as unknown as Env, ctx)
  await waitOnExecutionContext(ctx)
}

describe('scheduled() ディスパッチ配線（M-1）', () => {
  beforeEach(async () => {
    await applyMigrations()
    for (const table of ['cli_auth_requests', 'votes', 'decisions', 'candidates', 'participants', 'events']) {
      await db().prepare(`DELETE FROM ${table}`).run()
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (env as Record<string, unknown>).EVENT_RETENTION_DAYS
  })

  it('SC1: 毎時 cron では EVENT_RETENTION_DAYS 設定済みでもイベント削除は走らない（CLI掃除だけ走る）', async () => {
    ;(env as Record<string, unknown>).EVENT_RETENTION_DAYS = String(RETENTION_DAYS)
    const cliId = await insertExpiredCliAuthRequest()
    const eventId = await insertExpiredClosedEvent()

    await runScheduled(HOURLY_CRON)

    expect(await count('cli_auth_requests', 'id = ?', cliId)).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('SC2: 日次 cron でも EVENT_RETENTION_DAYS 未設定ならイベント削除はスキップする（CLI掃除だけ走る）', async () => {
    delete (env as Record<string, unknown>).EVENT_RETENTION_DAYS
    const cliId = await insertExpiredCliAuthRequest()
    const eventId = await insertExpiredClosedEvent()

    await runScheduled(EVENT_CLEANUP_CRON)

    expect(await count('cli_auth_requests', 'id = ?', cliId)).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(1)
  })

  it('SC3: 日次 cron かつ EVENT_RETENTION_DAYS 設定時のみイベント削除が実行される', async () => {
    ;(env as Record<string, unknown>).EVENT_RETENTION_DAYS = String(RETENTION_DAYS)
    const cliId = await insertExpiredCliAuthRequest()
    const eventId = await insertExpiredClosedEvent()

    await runScheduled(EVENT_CLEANUP_CRON)

    expect(await count('cli_auth_requests', 'id = ?', cliId)).toBe(0)
    expect(await count('events', 'id = ?', eventId)).toBe(0)
  })
})
