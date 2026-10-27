import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq, and, gt } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { sessions as sessionTable, users as userTable } from '../../../drizzle/schema'
import { getSessionToken, getBearerToken, hashToken } from './cookies'

type SessionDatabase = Pick<DrizzleD1Database, 'select' | 'update'>

export type SessionUser = {
  userId: string
  discordUserId: string
  username: string
  globalName: string | null
  avatar: string | null
  displayName: string
  sessionId: string
  kind: string
}

declare module 'hono' {
  interface ContextVariableMap {
    hiyoriSessionLookup: Promise<SessionUser | null> | undefined
  }
}

export async function loadSession(
  c: Context,
  app: { db: SessionDatabase },
  sessions: typeof sessionTable,
  users: typeof userTable,
): Promise<SessionUser | null> {
  // The invite middleware and route guard share one authenticated lookup only
  // within this Hono request. Subsequent requests always recheck revocation.
  const existing = c.get('hiyoriSessionLookup')
  if (existing) return existing
  const lookup = lookupSession(c, app, sessions, users)
  c.set('hiyoriSessionLookup', lookup)
  return lookup
}

async function lookupSession(c: Context, app: { db: SessionDatabase }, sessions: typeof sessionTable, users: typeof userTable): Promise<SessionUser | null> {
  const token = getSessionToken(c) ?? getBearerToken(c)
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
      kind: sessions.kind,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
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
    kind: row.kind,
  }
}

export async function requireSession(
  c: Context,
  app: { db: SessionDatabase },
  sessions: typeof sessionTable,
  users: typeof userTable,
): Promise<SessionUser> {
  const s = await loadSession(c, app, sessions, users)
  if (!s) throw new HTTPException(401, { message: 'Authentication required' })
  return s
}
