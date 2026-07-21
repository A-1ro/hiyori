import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs, loginAsBearer } from './test-helpers'

// MCP Phase 2 統合テスト:
//  - 案 A（OAuth 2.1）: 動的登録 → authorize（同意）→ token → /mcp 接続 の一連
//  - スコープ同意分離: read のみ許可すると write ツールが拒否される
//  - 残りツール（edit/delete/candidate add・rm/unconfirm/busy/subscription×4）が権限どおり動く
//  - MCP_ENABLED off で /oauth/* も既存挙動（/mcp は 404）

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

function withMcpEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const e = env as { MCP_ENABLED?: string }
  const original = e.MCP_ENABLED
  e.MCP_ENABLED = 'true'
  return fn().finally(() => {
    if (original === undefined) delete e.MCP_ENABLED
    else e.MCP_ENABLED = original
  })
}

// ---- MCP over Streamable HTTP の最小クライアント ----

function parseSse(text: string): unknown[] {
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd()
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice('data:'.length).trim()
      if (payload) {
        try {
          out.push(JSON.parse(payload))
        } catch {
          /* keepalive */
        }
      }
    }
  }
  return out
}

type JsonRpc = { jsonrpc: '2.0'; id?: number; result?: unknown; error?: unknown }

class McpTestClient {
  sessionId: string | null = null
  private nextId = 1
  constructor(private authorization: string) {}

  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: this.authorization,
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const res = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    return res
  }

  async initialize(): Promise<void> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p2', version: '1.0.0' } },
    })
    expect(res.status).toBe(200)
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async listTools(): Promise<string[]> {
    const res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} })
    const msgs = parseSse(await res.text()) as JsonRpc[]
    const result = msgs.find((m) => m.result)?.result as { tools?: { name: string }[] } | undefined
    return (result?.tools ?? []).map((t) => t.name)
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: unknown; text: string }> {
    const res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } })
    const msgs = parseSse(await res.text()) as JsonRpc[]
    const rpc = msgs.find((m) => m.result || m.error)
    if (!rpc) throw new Error(`no JSON-RPC response for ${name}: ${JSON.stringify(msgs)}`)
    if (rpc.error) throw new Error(`JSON-RPC error for ${name}: ${JSON.stringify(rpc.error)}`)
    const result = rpc.result as { content?: { type: string; text?: string }[]; isError?: boolean }
    const text = result.content?.map((c) => c.text ?? '').join('') ?? ''
    let data: unknown = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
    return { isError: result.isError === true, data, text }
  }
}

// ---- OAuth ヘルパ ----

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

const REDIRECT_URI = 'https://client.example/callback'

async function registerClient(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      client_name: 'Phase2 Test Client',
      token_endpoint_auth_method: 'none',
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { client_id: string }
  expect(body.client_id).toBeTruthy()
  return body.client_id
}

// authorize（同意）→ token を通してアクセストークンを得る。cookie は既存 Web セッション（Discord ログインの代役）。
async function obtainAccessToken(clientId: string, cookie: string, scopes: string[]): Promise<string> {
  const { verifier, challenge } = await makePkce()
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(' '),
    state: 'st-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()

  // GET /oauth/authorize → 同意画面（ログイン済み cookie）
  const consent = await SELF.fetch(`${BASE}/oauth/authorize?${query}`, { headers: { cookie } })
  expect(consent.status).toBe(200)
  expect(res_ct(consent)).toContain('text/html')

  // POST /oauth/authorize（承認・許可スコープを選択）
  const form = new URLSearchParams()
  form.set('oauth_req', query)
  form.set('action', 'approve')
  for (const s of scopes) form.append('scope', s)
  const approve = await SELF.fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  })
  expect(approve.status).toBe(302)
  const loc = approve.headers.get('location')!
  const code = new URL(loc).searchParams.get('code')!
  expect(code).toBeTruthy()
  expect(new URL(loc).searchParams.get('state')).toBe('st-123')

  // POST /oauth/token（PKCE 交換）
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  })
  const tokenRes = await SELF.fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })
  expect(tokenRes.status).toBe(200)
  const tok = (await tokenRes.json()) as { access_token: string }
  expect(tok.access_token).toBeTruthy()
  return tok.access_token
}

function res_ct(r: Response): string {
  return r.headers.get('content-type') ?? ''
}

beforeEach(async () => {
  await applyMigrations()
})

describe('MCP Phase 2: OAuth ディスカバリ / ゲート', () => {
  it('MCP off なら /mcp は 404（OAuth を被せても既存挙動）', async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(res.status).toBe(404)
  })

  it('MCP on なら認可サーバーメタデータが公開される', async () => {
    await withMcpEnabled(async () => {
      const res = await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`)
      expect(res.status).toBe(200)
      const meta = (await res.json()) as {
        authorization_endpoint: string
        token_endpoint: string
        registration_endpoint?: string
        scopes_supported?: string[]
      }
      expect(meta.authorization_endpoint).toContain('/oauth/authorize')
      expect(meta.token_endpoint).toContain('/oauth/token')
      expect(meta.scopes_supported).toEqual(expect.arrayContaining(['hiyori:read', 'hiyori:write']))
    })
  })

  it('MCP on でも既存 API は無傷（/api/health が 200）', async () => {
    await withMcpEnabled(async () => {
      const res = await SELF.fetch(`${BASE}/api/health`)
      expect(res.status).toBe(200)
    })
  })

  it('未認証の /mcp（OAuth トークンなし）は 401', async () => {
    await withMcpEnabled(async () => {
      const res = await SELF.fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })
      expect(res.status).toBe(401)
    })
  })
})

describe('MCP Phase 2: OAuth フロー（authorize→consent→token→/mcp）', () => {
  it('未ログインの authorize は Discord ログインへ 302', async () => {
    await withMcpEnabled(async () => {
      const clientId = await registerClient()
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'hiyori:read',
        state: 's',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      }).toString()
      const res = await SELF.fetch(`${BASE}/oauth/authorize?${query}`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/api/auth/discord')
    })
  })

  it('read+write 同意で全ツールが本人権限で動く', async () => {
    await withMcpEnabled(async () => {
      const cookie = await loginAs('oauth-user-rw')
      const clientId = await registerClient()
      const accessToken = await obtainAccessToken(clientId, cookie, ['hiyori:read', 'hiyori:write'])

      const client = new McpTestClient(`Bearer ${accessToken}`)
      await client.initialize()
      const { isError, data } = await client.callTool('hiyori_whoami')
      expect(isError).toBe(false)
      expect((data as { discordUserId: string }).discordUserId).toBe('oauth-user-rw')

      const created = await client.callTool('hiyori_create_event', {
        title: 'OAuth 経由の会',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      expect(created.isError).toBe(false)
      expect((created.data as { event: { id: string } }).event.id).toBeTruthy()
    })
  })

  it('read のみ同意なら write ツールはスコープ不足で拒否される', async () => {
    await withMcpEnabled(async () => {
      const cookie = await loginAs('oauth-user-ro')
      const clientId = await registerClient()
      const accessToken = await obtainAccessToken(clientId, cookie, ['hiyori:read'])

      const client = new McpTestClient(`Bearer ${accessToken}`)
      await client.initialize()

      // read は通る
      const list = await client.callTool('hiyori_list_events')
      expect(list.isError).toBe(false)

      // write は拒否
      const created = await client.callTool('hiyori_create_event', {
        title: 'NG',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      expect(created.isError).toBe(true)
      expect(created.text).toContain('scope')
    })
  })
})

// Codex P2-1 の回帰: 無効スコープ typo でフル権限に化けない / 省略時は最小権限（read）に倒す。
describe('MCP Phase 2: スコープ要求の解決（権限過剰付与の防止）', () => {
  function authorizeQuery(clientId: string, scopeParam: string | null): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'st-scope',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
    })
    if (scopeParam !== null) params.set('scope', scopeParam)
    return params.toString()
  }

  it('無効スコープのみ要求（typo）は GET authorize で invalid_scope 拒否（フル権限に化けない）', async () => {
    await withMcpEnabled(async () => {
      const cookie = await loginAs('scope-typo-get')
      const clientId = await registerClient()
      const query = authorizeQuery(clientId, 'hiyori:wirte') // typo
      const res = await SELF.fetch(`${BASE}/oauth/authorize?${query}`, {
        headers: { cookie },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      const loc = new URL(res.headers.get('location')!)
      // クライアントの redirect_uri へ invalid_scope で戻る（同意画面を出さない）
      expect(loc.origin + loc.pathname).toBe(REDIRECT_URI)
      expect(loc.searchParams.get('error')).toBe('invalid_scope')
      expect(loc.searchParams.get('code')).toBeNull()
    })
  })

  it('無効スコープのみ要求は POST approve でも invalid_scope 拒否（承認しても化けない）', async () => {
    await withMcpEnabled(async () => {
      const cookie = await loginAs('scope-typo-post')
      const clientId = await registerClient()
      const query = authorizeQuery(clientId, 'hiyori:wirte')
      const form = new URLSearchParams()
      form.set('oauth_req', query)
      form.set('action', 'approve')
      // 攻撃者がフォームで read/write を送っても、無効要求なので付与されない
      form.append('scope', 'hiyori:read')
      form.append('scope', 'hiyori:write')
      const res = await SELF.fetch(`${BASE}/oauth/authorize`, {
        method: 'POST',
        headers: { cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      const loc = new URL(res.headers.get('location')!)
      expect(loc.searchParams.get('error')).toBe('invalid_scope')
      expect(loc.searchParams.get('code')).toBeNull()
    })
  })

  it('scope 省略時は最小権限（read のみ）— フォームで write を足しても付与されない', async () => {
    await withMcpEnabled(async () => {
      const cookie = await loginAs('scope-omitted')
      const clientId = await registerClient()

      // scope パラメータを付けずに PKCE 込みで認可を完走させる
      const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)))
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const challenge = base64UrlEncode(new Uint8Array(digest))
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        state: 'st-omit',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()

      // 同意画面は 200（invalid にはならない）
      const consent = await SELF.fetch(`${BASE}/oauth/authorize?${query}`, { headers: { cookie } })
      expect(consent.status).toBe(200)

      const form = new URLSearchParams()
      form.set('oauth_req', query)
      form.set('action', 'approve')
      // 攻撃者が write を足しても、省略時の提示は read のみなので付与されない
      form.append('scope', 'hiyori:read')
      form.append('scope', 'hiyori:write')
      const approve = await SELF.fetch(`${BASE}/oauth/authorize`, {
        method: 'POST',
        headers: { cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
      })
      expect(approve.status).toBe(302)
      const code = new URL(approve.headers.get('location')!).searchParams.get('code')!
      expect(code).toBeTruthy()

      const tokenRes = await SELF.fetch(`${BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
      })
      expect(tokenRes.status).toBe(200)
      const accessToken = ((await tokenRes.json()) as { access_token: string }).access_token

      const client = new McpTestClient(`Bearer ${accessToken}`)
      await client.initialize()
      // read は通る
      const list = await client.callTool('hiyori_list_events')
      expect(list.isError).toBe(false)
      // write は拒否（= 省略時に write が付与されていない）
      const created = await client.callTool('hiyori_create_event', {
        title: 'should-be-blocked',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      expect(created.isError).toBe(true)
      expect(created.text).toContain('scope')
    })
  })
})

describe('MCP Phase 2: 残りツール（案 B Bearer 経路で権限確認）', () => {
  it('tools/list に Phase 2 の全 19 ツールが並ぶ', async () => {
    await withMcpEnabled(async () => {
      const client = new McpTestClient(await loginAsBearer('p2-list'))
      await client.initialize()
      const tools = await client.listTools()
      for (const name of [
        'hiyori_whoami',
        'hiyori_list_events',
        'hiyori_get_event',
        'hiyori_tally',
        'hiyori_create_event',
        'hiyori_vote',
        'hiyori_get_my_votes',
        'hiyori_confirm',
        'hiyori_get_ics',
        'hiyori_edit_event',
        'hiyori_delete_event',
        'hiyori_add_candidate',
        'hiyori_remove_candidate',
        'hiyori_unconfirm',
        'hiyori_my_busy',
        'hiyori_list_subscriptions',
        'hiyori_add_subscription',
        'hiyori_remove_subscription',
        'hiyori_regen_subscription',
      ]) {
        expect(tools).toContain(name)
      }
      expect(tools.length).toBe(19)
    })
  })

  it('edit / add_candidate / remove_candidate / unconfirm が主催者で通る', async () => {
    await withMcpEnabled(async () => {
      const client = new McpTestClient(await loginAsBearer('p2-organizer'))
      await client.initialize()
      const created = await client.callTool('hiyori_create_event', {
        title: '編集する会',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      const cData = created.data as { event: { id: string }; candidates: { id: string }[] }
      const eventId = cData.event.id

      // 編集
      const edited = await client.callTool('hiyori_edit_event', { eventId, title: '改題した会' })
      expect(edited.isError).toBe(false)
      expect((edited.data as { event: { title: string } }).event.title).toBe('改題した会')

      // 候補追加
      const added = await client.callTool('hiyori_add_candidate', { eventId, startAt: '2026-08-02T09:00:00.000Z' })
      expect(added.isError).toBe(false)
      const newCandId = (added.data as { candidate: { id: string } }).candidate.id
      expect(newCandId).toBeTruthy()

      // 候補削除
      const removed = await client.callTool('hiyori_remove_candidate', { eventId, candidateId: newCandId })
      expect(removed.isError).toBe(false)

      // 確定 → 取り消し
      await client.callTool('hiyori_confirm', { eventId, candidateIds: [cData.candidates[0]!.id] })
      const unconfirmed = await client.callTool('hiyori_unconfirm', { eventId })
      expect(unconfirmed.isError).toBe(false)
    })
  })

  it('非主催者の edit / delete はサーバー authz で拒否（403）', async () => {
    await withMcpEnabled(async () => {
      const org = new McpTestClient(await loginAsBearer('p2-owner'))
      await org.initialize()
      const created = await org.callTool('hiyori_create_event', {
        title: '他人の会',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      const eventId = (created.data as { event: { id: string } }).event.id

      const intruder = new McpTestClient(await loginAsBearer('p2-intruder'))
      await intruder.initialize()
      const edit = await intruder.callTool('hiyori_edit_event', { eventId, title: '乗っ取り' })
      expect(edit.isError).toBe(true)
      expect(edit.text).toContain('403')
      const del = await intruder.callTool('hiyori_delete_event', { eventId })
      expect(del.isError).toBe(true)
      expect(del.text).toContain('403')
    })
  })

  it('busy / subscription 系（list→add→regen→remove）が本人で動く', async () => {
    await withMcpEnabled(async () => {
      const client = new McpTestClient(await loginAsBearer('p2-sub'))
      await client.initialize()

      const busy = await client.callTool('hiyori_my_busy')
      expect(busy.isError).toBe(false)
      expect(Array.isArray((busy.data as { startAts: unknown[] }).startAts)).toBe(true)

      const added = await client.callTool('hiyori_add_subscription')
      expect(added.isError).toBe(false)
      const subId = (added.data as { subscription: { id: string }; webcalUrl: string }).subscription.id
      expect((added.data as { webcalUrl: string }).webcalUrl).toContain('webcal')

      const list = await client.callTool('hiyori_list_subscriptions')
      expect((list.data as { subscriptions: { id: string }[] }).subscriptions.some((s) => s.id === subId)).toBe(true)

      const regen = await client.callTool('hiyori_regen_subscription', { subscriptionId: subId })
      expect(regen.isError).toBe(false)
      expect((regen.data as { webcalUrl: string }).webcalUrl).toContain('webcal')

      const removed = await client.callTool('hiyori_remove_subscription', { subscriptionId: subId })
      expect(removed.isError).toBe(false)
    })
  })

  it('delete_event が主催者で通り、以後 get_event が 404', async () => {
    await withMcpEnabled(async () => {
      const client = new McpTestClient(await loginAsBearer('p2-deleter'))
      await client.initialize()
      const created = await client.callTool('hiyori_create_event', {
        title: '消す会',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-08-01T09:00:00.000Z' }],
      })
      const eventId = (created.data as { event: { id: string } }).event.id
      const del = await client.callTool('hiyori_delete_event', { eventId })
      expect(del.isError).toBe(false)
      const got = await client.callTool('hiyori_get_event', { eventId })
      expect(got.isError).toBe(true)
      expect(got.text).toContain('404')
    })
  })
})
