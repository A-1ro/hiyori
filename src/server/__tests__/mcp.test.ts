import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAsBearer } from './test-helpers'

// MCP サーバー（Phase 0/1・案 B Bearer パススルー）の統合テスト。
// - MCP_ENABLED off で /mcp が 404・既存機能無傷
// - 認証（Bearer 必須・無効トークン拒否）
// - whoami + コア 8 ツールの一連（作成→投票→集計→確定→ics）

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

// SSE 応答本文から JSON-RPC メッセージ（data: 行）を取り出す。
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
          /* keepalive など非 JSON はスキップ */
        }
      }
    }
  }
  return out
}

type JsonRpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }

// Streamable HTTP 越しに MCP と会話する最小クライアント。
class McpTestClient {
  sessionId: string | null = null
  private nextId = 1
  constructor(private bearer: string) {}

  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: this.bearer,
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    return res
  }

  async initialize(): Promise<void> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'mcp-test', version: '1.0.0' },
      },
    })
    expect(res.status).toBe(200)
    // initialized 通知（レスポンス body は無い / 202）
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async listTools(): Promise<string[]> {
    const res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} })
    const msgs = parseSse(await res.text()) as JsonRpc[]
    const result = msgs.find((m) => m.result)?.result as { tools?: { name: string }[] } | undefined
    return (result?.tools ?? []).map((t) => t.name)
  }

  // ツールを呼び、テキストコンテンツを JSON パースして返す（isError も返す）。
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ isError: boolean; data: unknown; text: string }> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    })
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

beforeEach(async () => {
  await applyMigrations()
})

describe('MCP: feature flag gate', () => {
  it('MCP_ENABLED 未設定なら /mcp は 404（機能不可視）', async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(res.status).toBe(404)
  })

  it('MCP off でも既存 API は無傷（/api/health が 200）', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('MCP: 認証（案 B Bearer）', () => {
  it('Authorization ヘッダなしは 401', async () => {
    await withMcpEnabled(async () => {
      const res = await SELF.fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })
      expect(res.status).toBe(401)
    })
  })

  it('無効な Bearer トークンは 401', async () => {
    await withMcpEnabled(async () => {
      const res = await SELF.fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer not-a-real-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })
      expect(res.status).toBe(401)
    })
  })
})

describe('MCP: ツール', () => {
  it('tools/list に whoami + コア 8 ツールが並ぶ', async () => {
    await withMcpEnabled(async () => {
      const bearer = await loginAsBearer('mcp-user-1')
      const client = new McpTestClient(bearer)
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
      ]) {
        expect(tools).toContain(name)
      }
    })
  })

  it('whoami が本人（discordUserId）を返す', async () => {
    await withMcpEnabled(async () => {
      const bearer = await loginAsBearer('mcp-user-2')
      const client = new McpTestClient(bearer)
      await client.initialize()
      const { isError, data } = await client.callTool('hiyori_whoami')
      expect(isError).toBe(false)
      expect((data as { discordUserId: string }).discordUserId).toBe('mcp-user-2')
    })
  })

  it('作成→投票→集計→確定→ics の一連が通る', async () => {
    await withMcpEnabled(async () => {
      const bearer = await loginAsBearer('mcp-organizer')
      const client = new McpTestClient(bearer)
      await client.initialize()

      // 作成
      const created = await client.callTool('hiyori_create_event', {
        title: 'MCP 飲み会',
        defaultDurationMinutes: 120,
        candidates: [
          { startAt: '2026-08-01T09:00:00.000Z' },
          { startAt: '2026-08-02T09:00:00.000Z' },
        ],
      })
      expect(created.isError).toBe(false)
      const createdData = created.data as {
        event: { id: string }
        candidates: { id: string }[]
      }
      const eventId = createdData.event.id
      const candIds = createdData.candidates.map((c) => c.id)
      expect(candIds.length).toBe(2)

      // list_events に主催として出る
      const list = await client.callTool('hiyori_list_events')
      const listData = list.data as { organized: { id: string }[] }
      expect(listData.organized.some((e) => e.id === eventId)).toBe(true)

      // 投票（第1候補 yes / 第2候補 no）
      const voted = await client.callTool('hiyori_vote', {
        eventId,
        votes: [
          { candidateId: candIds[0], choice: 'yes' },
          { candidateId: candIds[1], choice: 'no' },
        ],
      })
      expect(voted.isError).toBe(false)

      // 自分の票
      const myVotes = await client.callTool('hiyori_get_my_votes', { eventId })
      expect((myVotes.data as { votes: unknown[] }).votes.length).toBe(2)

      // 集計
      const tally = await client.callTool('hiyori_tally', { eventId })
      const tallyData = tally.data as { candidates: { id: string; counts: { yes: number; no: number } }[] }
      const c0 = tallyData.candidates.find((c) => c.id === candIds[0])
      expect(c0?.counts.yes).toBe(1)

      // 確定（第1候補）
      const confirmed = await client.callTool('hiyori_confirm', {
        eventId,
        candidateIds: [candIds[0]!],
      })
      expect(confirmed.isError).toBe(false)

      // ics（確定済みなので本文が返る）
      const ics = await client.callTool('hiyori_get_ics', { eventId })
      expect(ics.isError).toBe(false)
      expect(ics.text).toContain('BEGIN:VCALENDAR')
    })
  })

  it('get_event が isOrganizer=true を含む（主催者本人）', async () => {
    await withMcpEnabled(async () => {
      const bearer = await loginAsBearer('mcp-org-2')
      const client = new McpTestClient(bearer)
      await client.initialize()
      const created = await client.callTool('hiyori_create_event', {
        title: '権限テスト',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-09-01T09:00:00.000Z' }],
      })
      const eventId = (created.data as { event: { id: string } }).event.id
      const got = await client.callTool('hiyori_get_event', { eventId })
      expect((got.data as { isOrganizer: boolean }).isOrganizer).toBe(true)
    })
  })

  it('非主催者の confirm は 403 相当のツールエラー', async () => {
    await withMcpEnabled(async () => {
      // 主催者がイベント作成
      const orgBearer = await loginAsBearer('mcp-owner')
      const org = new McpTestClient(orgBearer)
      await org.initialize()
      const created = await org.callTool('hiyori_create_event', {
        title: '他人の会',
        defaultDurationMinutes: 60,
        candidates: [{ startAt: '2026-10-01T09:00:00.000Z' }],
      })
      const cData = created.data as { event: { id: string }; candidates: { id: string }[] }

      // 別ユーザーが確定を試みる → サーバー側 authz で拒否
      const otherBearer = await loginAsBearer('mcp-intruder')
      const other = new McpTestClient(otherBearer)
      await other.initialize()
      const attempt = await other.callTool('hiyori_confirm', {
        eventId: cData.event.id,
        candidateIds: [cData.candidates[0]!.id],
      })
      expect(attempt.isError).toBe(true)
      expect(attempt.text).toContain('403')
    })
  })
})
