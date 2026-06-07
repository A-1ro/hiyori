export async function cleanupExpiredCliAuthRequests(db: D1Database, now: Date): Promise<number> {
  const cutoff = now.getTime() - 60 * 60 * 1000
  const res = await db.prepare('DELETE FROM cli_auth_requests WHERE expiresAt < ?').bind(cutoff).run()
  return res.meta?.changes ?? 0
}
