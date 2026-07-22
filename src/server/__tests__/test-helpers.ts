import { env } from 'cloudflare:test'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CLI_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const buf = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function ensureUser(db: D1Database, discordUserId: string, username: string): Promise<string> {
  const now = Date.now()
  const existing = await db.prepare(
    'SELECT id FROM users WHERE discordUserId = ?'
  ).bind(discordUserId).first<{ id: string }>()

  const userId = existing?.id ?? crypto.randomUUID()

  await db.prepare(
    'INSERT OR REPLACE INTO users (id, discordUserId, username, globalName, avatar, createdAt, updatedAt) VALUES (?, ?, ?, NULL, NULL, ?, ?)'
  ).bind(userId, discordUserId, username, now, now).run()

  return userId
}

export async function loginAs(discordUserId: string, username = `user_${discordUserId}`): Promise<string> {
  const db = (env as { DB: D1Database }).DB
  const now = Date.now()

  const userId = await ensureUser(db, discordUserId, username)

  const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = await hashToken(sessionToken)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + SESSION_TTL_MS

  await db.prepare(
    'INSERT INTO sessions (id, userId, tokenHash, kind, createdAt, lastUsedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, tokenHash, 'web', now, now, expiresAt).run()

  return `hiyori_session=${sessionToken}`
}

// 期限切れセッションを挿入する（loginAs と同型・expiresAt だけ過去）。
// loadSession の `gt(expiresAt, now)` 条件が生きていることの検証用。
export async function loginAsExpired(discordUserId: string, username = `user_${discordUserId}`): Promise<string> {
  const db = (env as { DB: D1Database }).DB
  const now = Date.now()

  const userId = await ensureUser(db, discordUserId, username)

  const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = await hashToken(sessionToken)
  const sessionId = crypto.randomUUID()
  // 1 秒前に失効済み
  const expiresAt = now - 1000

  await db.prepare(
    'INSERT INTO sessions (id, userId, tokenHash, kind, createdAt, lastUsedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, tokenHash, 'web', now - SESSION_TTL_MS, now - SESSION_TTL_MS, expiresAt).run()

  return `hiyori_session=${sessionToken}`
}

export async function loginAsBearer(discordUserId: string, username = `user_${discordUserId}`): Promise<string> {
  const db = (env as { DB: D1Database }).DB
  const now = Date.now()

  const userId = await ensureUser(db, discordUserId, username)

  const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = await hashToken(sessionToken)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + CLI_SESSION_TTL_MS

  await db.prepare(
    'INSERT INTO sessions (id, userId, tokenHash, kind, createdAt, lastUsedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, tokenHash, 'cli', now, now, expiresAt).run()

  return `Bearer ${sessionToken}`
}
