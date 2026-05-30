import type { Context } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'

export const SESSION_COOKIE_NAME = 'hiyori_session'
export const OAUTH_STATE_COOKIE_NAME = 'hiyori_oauth_state'
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
export const OAUTH_STATE_TTL_SECONDS = 600
export const OAUTH_STATE_PATH = '/api/auth/discord'

// HTTPS なら常に Secure を付ける。HTTP の場合、localhost 開発に限り Secure を
// 外す（ブラウザが localhost HTTP では Secure 付き Cookie を破棄するため）。
// staging などの誤設定 HTTP デプロイで token Cookie が cleartext に晒されないよう、
// localhost 以外の HTTP は Secure を維持して認証フローを fail loud にする。
export function isSecureRequest(c: Context): boolean {
  const url = new URL(c.req.url)
  if (url.protocol === 'https:') return true
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname.endsWith('.localhost')
  return !isLoopback
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
}

export function getSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME)
}

export function setStateCookie(c: Context, state: string) {
  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: OAUTH_STATE_PATH, maxAge: OAUTH_STATE_TTL_SECONDS,
  })
}

export function consumeStateCookie(c: Context): string | undefined {
  const v = getCookie(c, OAUTH_STATE_COOKIE_NAME)
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: OAUTH_STATE_PATH })
  return v
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const buf = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
