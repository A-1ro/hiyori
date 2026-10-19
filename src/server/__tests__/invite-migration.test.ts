import { env, applyD1Migrations } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'

it('username-invite migration preserves existing numeric records and adds pending invite indexes', async () => {
  const db = (env as { DB: D1Database }).DB
  const migrations = inject('d1Migrations')
  const upgradeIndex = migrations.findIndex((migration) => migration.name.startsWith('0014_'))
  expect(upgradeIndex).toBeGreaterThan(0)
  await applyD1Migrations(db, migrations.slice(0, upgradeIndex))

  const eventId = crypto.randomUUID()
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  const discordUserId = '12345678901234567'
  const createdAt = 1780000000123
  // Legacy writes did not enforce uniqueness; keep both record IDs so a previously
  // rendered revoke target remains meaningful after the schema upgrade.
  await db.batch(ids.map((id) => db.prepare(
    'INSERT INTO event_invites (id, eventId, discordUserId, createdAt) VALUES (?, ?, ?, ?)',
  ).bind(id, eventId, discordUserId, createdAt)))

  await applyD1Migrations(db, migrations)
  const rows = await db.prepare('SELECT * FROM event_invites WHERE eventId = ? ORDER BY id').bind(eventId).all()
  expect(rows.results).toEqual(ids.sort().map((id) => ({
    id, eventId, discordUserId, discordUsername: null, claimedAt: null, createdAt,
  })))

  const pendingId = crypto.randomUUID()
  await db.prepare('INSERT INTO event_invites (id, eventId, discordUsername, createdAt) VALUES (?, ?, ?, ?)')
    .bind(pendingId, eventId, 'pending_invitee', createdAt).run()
  expect(await db.prepare('SELECT discordUserId FROM event_invites WHERE id = ?').bind(pendingId).first())
    .toEqual({ discordUserId: null })
  await expect(db.prepare('INSERT INTO event_invites (id, eventId, discordUsername, createdAt) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), eventId, 'pending_invitee', createdAt).run()).rejects.toThrow()

  const indexes = await db.prepare("PRAGMA index_list('event_invites')").all<{ name: string }>()
  expect(indexes.results.map((index) => index.name)).toEqual(expect.arrayContaining([
    'event_invites_event_username_unique',
    'event_invites_event_discord_idx',
    'event_invites_pending_username_idx',
  ]))
})
