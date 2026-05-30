import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq, and, gt } from 'drizzle-orm'
import { getSessionToken, hashToken } from './cookies'

export type SessionUser = {
  userId: string
  discordUserId: string
  username: string
  globalName: string | null
  avatar: string | null
  displayName: string
  sessionId: string
}

export async function loadSession(
  c: Context,
  app: { db: any },
  sessions: any,
  users: any,
): Promise<SessionUser | null> {
  const token = getSessionToken(c)
  if (!token) return null
  const tokenHash = await hashToken(token)
  const now = new Date()
  const rows = await app.db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      discordUserId: users.discordUserId,
      username: users.username,
      globalName: users.globalName,
      avatar: users.avatar,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1)
  if (rows.length === 0) return null
  const row = rows[0]
  c.executionCtx.waitUntil(
    app.db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, row.sessionId))
  )
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    discordUserId: row.discordUserId,
    username: row.username,
    globalName: row.globalName,
    avatar: row.avatar,
    displayName: row.globalName ?? row.username,
  }
}

export async function requireSession(
  c: Context,
  app: { db: any },
  sessions: any,
  users: any,
): Promise<SessionUser> {
  const s = await loadSession(c, app, sessions, users)
  if (!s) throw new HTTPException(401, { message: 'Authentication required' })
  return s
}
