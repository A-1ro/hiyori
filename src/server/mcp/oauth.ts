// 案 A（OAuth 2.1）の認可フロー実装。
//
// workers-oauth-provider が /token・/register・ディスカバリを担い、認可（/oauth/authorize）の
// UI とユーザー同意はこの defaultHandler 側で実装する。上流 IdP は既存 Discord OAuth を再利用する:
//   1. GET /oauth/authorize → parseAuthRequest でクライアント要求を取得。
//   2. Web セッション cookie（既存 Discord ログイン）が無ければ /api/auth/discord へ 302（returnTo で復帰）。
//   3. ログイン済みなら同意画面を表示（hiyori:read / hiyori:write のどこまで許すかを選ぶ）。
//   4. POST /oauth/authorize（承認）→ kind:'mcp' 短命セッションを 1 つ発行して props.apiToken に入れ、
//      completeAuthorization でグラント確定 → クライアントへリダイレクト。
//
// これにより McpAgent（agent.ts）は props.apiToken を Bearer に既存 /api/* を内部呼び出しするだけで
// 済み（案 B と同じ props 形状）。サーバー側の認可・バリデーション・レート制限は二重実装しない。

import { internalApi } from './internal'
import { SESSION_COOKIE_NAME, generateSessionToken, hashToken } from '../auth/cookies'
import type { McpProps, McpScope } from './types'
import type { Env } from '../index'
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

export const MCP_AUTHORIZE_PATH = '/oauth/authorize'
export const MCP_TOKEN_PATH = '/oauth/token'
export const MCP_REGISTER_PATH = '/oauth/register'

export const MCP_SCOPES: McpScope[] = ['hiyori:read', 'hiyori:write']

// kind:'mcp' セッションの TTL。OAuth リフレッシュトークン既定（30 日）に合わせる。
// グラントを失効（revokeGrant）すれば props ごと復号不能になり、この Bearer は到達不能になる。
const MCP_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

interface AuthMeUser {
  userId: string
  discordUserId: string
  username: string
  globalName: string | null
  avatar: string | null
  displayName: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim())
    }
  }
  return undefined
}

// 既存 Web セッション cookie（Discord ログイン）から本人を解決する。
// cookie トークンを Bearer として /api/auth/me に内部呼び出しする（loadSession は cookie/Bearer 両対応）。
async function getWebUser(request: Request, env: Env): Promise<AuthMeUser | null> {
  const token = getCookieValue(request, SESSION_COOKIE_NAME)
  if (!token) return null
  const me = await internalApi(env, token, 'GET', '/api/auth/me')
  const body = me.data as { user: AuthMeUser | null } | null
  if (!me.ok || !body?.user) return null
  return body.user
}

// kind:'mcp' の短命セッションを 1 つ発行し、生トークン（apiToken）を返す。
// DB にはハッシュのみ保存（既存 sessions テーブル・Bearer 経路に相乗り）。
async function mintMcpSession(env: Env, userId: string): Promise<string> {
  const rawToken = generateSessionToken()
  const tokenHash = await hashToken(rawToken)
  const now = Date.now()
  const expiresAt = now + MCP_SESSION_TTL_SECONDS * 1000
  await env.DB.prepare(
    'INSERT INTO sessions (id, userId, tokenHash, createdAt, lastUsedAt, expiresAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), userId, tokenHash, now, now, expiresAt, 'mcp')
    .run()
  return rawToken
}

// スコープ要求の解決結果。invalid = 「指定はあるが有効スコープが 1 つも無い」＝ invalid_scope で拒否。
type ScopeResolution = { ok: true; scopes: McpScope[] } | { ok: false }

function resolveRequestedScopes(oauthScope: string[]): ScopeResolution {
  // scope 省略（空配列）→ 最小権限の既定として read のみを提示する。
  // 理由: 「無効スコープ typo → 両方フォールバック」で書き込み権限が化ける事故（Codex P2-1）を防ぐため、
  //   デフォルトは安全側（read）に倒す。write が要るクライアントは scope=hiyori:write を明示要求する。
  if (oauthScope.length === 0) return { ok: true, scopes: ['hiyori:read'] }
  // クライアント要求 ∩ サーバー対応。
  const valid = oauthScope.filter((s): s is McpScope => (MCP_SCOPES as string[]).includes(s))
  // 指定はあるが有効スコープが 0 件（例: typo の hiyori:wirte のみ）→ フル権限に落とさず invalid_scope 拒否。
  if (valid.length === 0) return { ok: false }
  return { ok: true, scopes: valid }
}

function scopeLabel(scope: McpScope): string {
  return scope === 'hiyori:read'
    ? '読み取り（イベント一覧・詳細・集計・カレンダー予定の閲覧）'
    : '書き込み（イベント作成・編集・投票・確定・削除など）'
}

function renderConsent(
  client: { clientName?: string; clientUri?: string } | null,
  user: AuthMeUser,
  scopes: McpScope[],
  oauthQuery: string,
): Response {
  const clientName = escapeHtml(client?.clientName || 'MCP クライアント')
  const who = escapeHtml(user.displayName)
  const checkboxes = scopes
    .map(
      (s) => `
      <label class="scope">
        <input type="checkbox" name="scope" value="${escapeHtml(s)}" checked />
        <span>${escapeHtml(scopeLabel(s))}</span>
      </label>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hiyori へのアクセス許可</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 30rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.6; }
  h1 { font-size: 1.25rem; }
  .client { font-weight: 600; }
  .scope { display: flex; gap: .5rem; align-items: flex-start; margin: .75rem 0; padding: .5rem .75rem; border: 1px solid #8884; border-radius: .5rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button { font: inherit; padding: .6rem 1.1rem; border-radius: .5rem; border: 1px solid #8886; cursor: pointer; }
  button.approve { background: #2563eb; color: #fff; border-color: #2563eb; }
  .muted { color: #8889; font-size: .85rem; }
</style></head>
<body>
  <h1>アクセス許可の確認</h1>
  <p><span class="client">${clientName}</span> が、あなた（<strong>${who}</strong>）の Hiyori アカウントへのアクセスを求めています。</p>
  <form method="post" action="${escapeHtml(MCP_AUTHORIZE_PATH)}">
    <input type="hidden" name="oauth_req" value="${escapeHtml(oauthQuery)}" />
    <p>許可する権限を選んでください：</p>
    ${checkboxes}
    <div class="actions">
      <button type="submit" name="action" value="approve" class="approve">許可する</button>
      <button type="submit" name="action" value="deny">拒否する</button>
    </div>
  </form>
  <p class="muted">許可すると、選んだ範囲の操作をこのクライアント経由で AI が実行できます。いつでも接続を解除して失効できます。</p>
</body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function redirectToLogin(url: URL): Response {
  // 未ログイン → 既存 Discord OAuth へ。ログイン後に同じ /oauth/authorize?… へ復帰する。
  const returnTo = url.pathname + (url.search || '')
  const loginUrl = `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`
  return new Response(null, { status: 302, headers: { location: loginUrl } })
}

// 認可失敗をクライアントの redirect_uri へ OAuth エラーとして戻す（access_denied / invalid_scope 等）。
// redirect_uri はこの時点で lookupClient 済み = 検証済みなので、error を付けて戻すのが RFC 6749 §4.1.2.1 の作法。
function errorRedirect(redirectUri: string, state: string, error: string): Response {
  const u = new URL(redirectUri)
  u.searchParams.set('error', error)
  if (state) u.searchParams.set('state', state)
  return new Response(null, { status: 302, headers: { location: u.toString() } })
}

// GET /oauth/authorize（同意画面 or Discord ログインへ）
async function handleAuthorizeGet(request: Request, env: Env, url: URL): Promise<Response> {
  const provider = env.OAUTH_PROVIDER
  if (!provider) return new Response('OAuth provider unavailable', { status: 500 })

  let oauthReq: Awaited<ReturnType<OAuthHelpers['parseAuthRequest']>>
  try {
    oauthReq = await provider.parseAuthRequest(request)
  } catch {
    return new Response('Invalid authorization request', { status: 400 })
  }

  const client = await provider.lookupClient(oauthReq.clientId)
  if (!client) return new Response('Unknown client', { status: 400 })

  // スコープ検証はログイン強制の前に行う（無効要求のためにログインさせない）。
  const resolved = resolveRequestedScopes(oauthReq.scope)
  if (!resolved.ok) return errorRedirect(oauthReq.redirectUri, oauthReq.state, 'invalid_scope')

  const user = await getWebUser(request, env)
  if (!user) return redirectToLogin(url)

  // 元のクエリ文字列をそのまま持ち回り、POST 時に再パースして完全性を担保する。
  return renderConsent(client, user, resolved.scopes, url.search.replace(/^\?/, ''))
}

// POST /oauth/authorize（承認 / 拒否）
async function handleAuthorizePost(request: Request, env: Env, url: URL): Promise<Response> {
  const provider = env.OAUTH_PROVIDER
  if (!provider) return new Response('OAuth provider unavailable', { status: 500 })

  // CSRF 防御（same-origin のみ許可）。同意画面は SameSite=Lax cookie でも保護される。
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).origin !== url.origin) {
    return new Response('Forbidden', { status: 403 })
  }

  const form = await request.formData()
  const action = String(form.get('action') ?? '')
  const oauthQuery = String(form.get('oauth_req') ?? '')
  const chosen = form.getAll('scope').map(String)

  // 元の認可リクエストを再構築して再パース（フォーム改竄に依存しない）。
  const rebuilt = new Request(`${url.origin}${MCP_AUTHORIZE_PATH}?${oauthQuery}`, { method: 'GET' })
  let oauthReq: Awaited<ReturnType<OAuthHelpers['parseAuthRequest']>>
  try {
    oauthReq = await provider.parseAuthRequest(rebuilt)
  } catch {
    return new Response('Invalid authorization request', { status: 400 })
  }

  const user = await getWebUser(request, env)
  if (!user) return redirectToLogin(new URL(rebuilt.url))

  if (action !== 'approve') {
    return errorRedirect(oauthReq.redirectUri, oauthReq.state, 'access_denied')
  }

  // 無効スコープのみの要求は承認時点でも拒否（GET と同じ判定・フル権限に落とさない）。
  const resolved = resolveRequestedScopes(oauthReq.scope)
  if (!resolved.ok) return errorRedirect(oauthReq.redirectUri, oauthReq.state, 'invalid_scope')

  // 許可スコープ = 解決済み提示スコープ ∩ ユーザーが選択したスコープ。
  // （提示スコープを超える chosen は無視されるので、フォーム改竄で write を足すことはできない）
  const grantedScopes = resolved.scopes.filter((s) => chosen.includes(s))

  // 内部呼び出し用の kind:'mcp' 短命セッションを発行。
  const apiToken = await mintMcpSession(env, user.userId)

  const props: McpProps = {
    userId: user.userId,
    discordUserId: user.discordUserId,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    displayName: user.displayName,
    apiToken,
    scopes: grantedScopes,
  }

  const { redirectTo } = await provider.completeAuthorization({
    request: oauthReq,
    userId: user.discordUserId,
    metadata: { clientId: oauthReq.clientId, via: 'discord' },
    scope: grantedScopes,
    props,
  })

  return new Response(null, { status: 302, headers: { location: redirectTo } })
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET') return handleAuthorizeGet(request, env, url)
  if (request.method === 'POST') return handleAuthorizePost(request, env, url)
  return new Response('Method Not Allowed', { status: 405 })
}
