import type { ExecutionContext } from 'hono'
import { buildApp, type Env } from '../index'
import { SESSION_COOKIE_NAME } from '../auth/cookies'
import type { InternalResponse } from '../mcp/internal'

// Same API authorization, real execution context for notifications, no new
// OAuth client/token or public network request. Credentials never enter tools.
export function sessionToolApi(env: Env, token: string, origin: string, ctx: ExecutionContext, clientIp?: string) {
  return async (method: string, path: string, body?: unknown): Promise<InternalResponse> => {
    if (!path.startsWith('/api/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('Invalid internal API path')
    const headers: Record<string, string> = { Cookie: `${SESSION_COOKIE_NAME}=${token}`, Origin: origin }
    if (clientIp) headers['CF-Connecting-IP'] = clientIp
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const request = new Request(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const response = await buildApp(env).fetch(request, env, ctx)
    const text = await response.text()
    let data: unknown = null
    try { data = JSON.parse(text) } catch { /* ICS and empty responses are not JSON. */ }
    return { ok: response.ok, status: response.status, data, text }
  }
}
