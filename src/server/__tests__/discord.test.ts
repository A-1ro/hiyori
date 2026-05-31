import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'
import { signChannelToken } from '../discord/channel-token'

const CHANNEL_TOKEN_SECRET = 'test-secret-for-channel-token'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  })
  return res
}

async function del(path: string, headers?: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
}

const ORGANIZER_ID = '12345678901234567'
const CHANNEL_ID = '99999999999999999'

const baseCandidates = [
  { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
  { startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-02T11:00:00.000Z' },
]

async function buildValidEventBase() {
  return {
    title: 'Discord テストイベント',
    defaultDurationMinutes: 60,
    discordChannelToken: await signChannelToken(CHANNEL_TOKEN_SECRET, CHANNEL_ID),
    candidates: baseCandidates,
  }
}

let organizerCookie: string

async function generateEd25519KeyPair(): Promise<{ privateKey: CryptoKey; publicKeyHex: string }> {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const privateKey = (keyPair as CryptoKeyPair).privateKey
  const publicKey = (keyPair as CryptoKeyPair).publicKey
  const rawPublicKey = await crypto.subtle.exportKey('raw', publicKey)
  const publicKeyHex = Array.from(new Uint8Array(rawPublicKey))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { privateKey, publicKeyHex }
}

async function signInteraction(
  privateKey: CryptoKey,
  body: string,
  timestamp: string,
): Promise<{ signature: string; timestamp: string }> {
  const message = new TextEncoder().encode(timestamp + body)
  const sig = await crypto.subtle.sign('Ed25519', privateKey, message)
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { signature, timestamp }
}

beforeEach(async () => {
  await applyMigrations()
  organizerCookie = await loginAs(ORGANIZER_ID)
  ;(env as Record<string, unknown>).DISCORD_CHANNEL_TOKEN_SECRET = CHANNEL_TOKEN_SECRET
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (env as Record<string, unknown>).DISCORD_BOT_TOKEN
  delete (env as Record<string, unknown>).DISCORD_PUBLIC_KEY
  delete (env as Record<string, unknown>).DISCORD_CHANNEL_TOKEN_SECRET
})

describe('POST /api/discord/interactions', () => {
  it('T0: DISCORD_PUBLIC_KEY 未設定 → 503', async () => {
    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': 'deadbeef',
        'X-Signature-Timestamp': '1234567890',
      },
      body: JSON.stringify({ type: 1 }),
    })
    expect(res.status).toBe(503)
  })

  it('T2: PING + 有効署名 → {type:1}', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({ type: 1 })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const { signature } = await signInteraction(privateKey, body, timestamp)

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { type: number }
    expect(json.type).toBe(1)
  })

  it('T1: 不正署名 → 401', async () => {
    const { publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({ type: 1 })
    const timestamp = String(Math.floor(Date.now() / 1000))

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        'X-Signature-Timestamp': timestamp,
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  it('T1b: timestamp が 6 分前 → 401 Stale signature', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({ type: 1 })
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60)
    const { signature } = await signInteraction(privateKey, body, staleTimestamp)

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': staleTimestamp,
      },
      body,
    })
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Stale signature')
  })

  it('T1c: timestamp が NaN → 401 Invalid timestamp', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({ type: 1 })
    const { signature } = await signInteraction(privateKey, body, 'not-a-number')

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': 'not-a-number',
      },
      body,
    })
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Invalid timestamp')
  })

  it('T3: MESSAGE_COMPONENT + 有効署名 → {type:6} + AuditLog discord.interaction.received', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({
      type: 3,
      data: { custom_id: 'test_button' },
      member: { user: { id: '11111111111111111' } },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const { signature } = await signInteraction(privateKey, body, timestamp)

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { type: number }
    expect(json.type).toBe(6)

    const db = (env as { DB: D1Database }).DB
    const row = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.interaction.received'")
      .first()
    expect(row).not.toBeNull()
  })

  it('TS1: APPLICATION_COMMAND /hiyori new → ephemeral リンク (channel pre-fill)', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({
      type: 2,
      data: { name: 'hiyori', options: [{ name: 'new' }] },
      channel_id: CHANNEL_ID,
      member: { user: { id: '11111111111111111' } },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const { signature } = await signInteraction(privateKey, body, timestamp)

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { type: number; data: { flags: number; content: string } }
    expect(json.type).toBe(4)
    expect(json.data.flags).toBe(64)
    // channelToken=<HMAC> 形式で channel ID を直接埋めない（手動偽造防止）
    expect(json.data.content).toMatch(/\/events\/new\?channelToken=[A-Za-z0-9_\-=%]+/)
    expect(json.data.content).not.toContain(`channel=${CHANNEL_ID}`)

    const db = (env as { DB: D1Database }).DB
    const row = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.command.received'")
      .first()
    expect(row).not.toBeNull()
  })

  it('TS2: APPLICATION_COMMAND 未対応コマンド → ephemeral 「未対応」', async () => {
    const { privateKey, publicKeyHex } = await generateEd25519KeyPair()
    ;(env as Record<string, unknown>).DISCORD_PUBLIC_KEY = publicKeyHex

    const body = JSON.stringify({
      type: 2,
      data: { name: 'unknown' },
      channel_id: CHANNEL_ID,
      member: { user: { id: '11111111111111111' } },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const { signature } = await signInteraction(privateKey, body, timestamp)

    const res = await SELF.fetch(`${BASE}/api/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': timestamp,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { type: number; data: { flags: number; content: string } }
    expect(json.type).toBe(4)
    expect(json.data.flags).toBe(64)
    expect(json.data.content).toContain('未対応')
  })
})

describe('Discord 通知 waitUntil', () => {
  it('T4: POST /decision → fetch モック成功 → discordMessageId 永続化 + AuditLog discord.notify.success', async () => {
    // fetch モックより先にイベントを作成（SELF.fetch を fetch モックの影響前に実行）
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        return new Response(JSON.stringify({ id: 'mock_message_id_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    const db = (env as { DB: D1Database }).DB

    const successLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.notify.success'")
      .first()
    expect(successLog).not.toBeNull()

    const decisionRow = await db
      .prepare('SELECT discordMessageId FROM decisions WHERE eventId = ?')
      .bind(eventId)
      .first()
    expect(decisionRow).not.toBeNull()
    expect((decisionRow as { discordMessageId: string | null }).discordMessageId).toBe('mock_message_id_123')
  })

  it('T5: POST /decision → fetch モック 403 → 決定 201 のまま + AuditLog discord.notify.failure', async () => {
    // fetch モックより先にイベントを作成
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        return new Response(JSON.stringify({ code: 50013, message: 'Missing Permissions' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const res = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    const db = (env as { DB: D1Database }).DB
    const failureLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.notify.failure'")
      .first()
    expect(failureLog).not.toBeNull()
  })

  it('T6: DELETE /decision → PATCH URL に発火 + AuditLog discord.notify.success', async () => {
    // fetch モックより先にイベントを作成
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    let patchUrl: string | null = null

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method === 'POST') {
          return new Response(JSON.stringify({ id: 'msg_for_cancel_test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'PATCH') {
          patchUrl = urlStr
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    // 先に確定
    await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })

    // waitUntil を消化して discordMessageId を永続化
    await new Promise((r) => setTimeout(r, 50))

    // 取り消し
    const deleteRes = await del(`/api/events/${eventId}/decision`, { Cookie: organizerCookie })
    expect(deleteRes.status).toBe(200)

    await new Promise((r) => setTimeout(r, 50))

    expect(patchUrl).not.toBeNull()
    expect(patchUrl).toMatch(
      new RegExp(`^https://discord\\.com/api/v10/channels/${CHANNEL_ID}/messages/msg_for_cancel_test$`),
    )

    const db = (env as { DB: D1Database }).DB
    const successLogs = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.notify.success'")
      .all()
    expect(successLogs.results.length).toBeGreaterThanOrEqual(1)
  })
})

describe('調整リンクのチャンネル投稿 waitUntil', () => {
  it('T7: イベント作成 + DISCORD_BOT_TOKEN + channelId → POST 成功 → discord.announce.success', async () => {
    let postUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        postUrl = urlStr
        return new Response(JSON.stringify({ id: 'announce_msg_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(createRes.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    expect(postUrl).toMatch(
      new RegExp(`^https://discord\\.com/api/v10/channels/${CHANNEL_ID}/messages$`),
    )

    const db = (env as { DB: D1Database }).DB
    const successLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.announce.success'")
      .first()
    expect(successLog).not.toBeNull()
  })

  it('T8: 作成 + fetch モック 403 → イベントは 201 + discord.announce.failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        return new Response(JSON.stringify({ code: 50013, message: 'Missing Permissions' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(createRes.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    const db = (env as { DB: D1Database }).DB
    const failureLog = await db
      .prepare("SELECT * FROM audit_logs WHERE action = 'discord.announce.failure'")
      .first()
    expect(failureLog).not.toBeNull()
  })

  it('T9: discordChannelToken 未指定 → fetch 呼ばれない / announce ログなし', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch should not be called')
    })
    vi.stubGlobal('fetch', fetchMock)
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const { discordChannelToken: _omit, ...withoutChannel } = await buildValidEventBase()
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(withoutChannel),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(createRes.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('cross-tenant 投稿防止（HMAC 署名トークン検証）', () => {
  it('SEC3: 不正な discordChannelToken → 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: '攻撃',
        defaultDurationMinutes: 60,
        discordChannelToken: 'forged.token',
        candidates: baseCandidates,
      }),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Invalid or expired/)
  })

  it('SEC4: 異なる秘密鍵で署名されたトークン → 400', async () => {
    const otherToken = await signChannelToken('other-secret-not-server', CHANNEL_ID)
    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: '攻撃',
        defaultDurationMinutes: 60,
        discordChannelToken: otherToken,
        candidates: baseCandidates,
      }),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(res.status).toBe(400)
  })

  it('SEC5: 期限切れトークン → 400', async () => {
    const expired = await signChannelToken(CHANNEL_TOKEN_SECRET, CHANNEL_ID, { ttlSeconds: -10 })
    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: '攻撃',
        defaultDurationMinutes: 60,
        discordChannelToken: expired,
        candidates: baseCandidates,
      }),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(res.status).toBe(400)
  })

  it('SEC6: DISCORD_CHANNEL_TOKEN_SECRET 未設定でトークン提示 → 503', async () => {
    const validToken = await signChannelToken(CHANNEL_TOKEN_SECRET, CHANNEL_ID)
    delete (env as Record<string, unknown>).DISCORD_CHANNEL_TOKEN_SECRET

    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'テスト',
        defaultDurationMinutes: 60,
        discordChannelToken: validToken,
        candidates: baseCandidates,
      }),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(res.status).toBe(503)
  })

  it('SEC7: 有効トークンで作成 → 201 + announce 発火（解決された channel ID にPOST）', async () => {
    let postUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        postUrl = urlStr
        return new Response(JSON.stringify({ id: 'announce_ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))
    expect(postUrl).toMatch(
      new RegExp(`^https://discord\\.com/api/v10/channels/${CHANNEL_ID}/messages$`),
    )
  })
})

describe('Discord embed のマークダウン/メンションエスケープ', () => {
  it('SEC1: ゲスト displayName の masked link が embed description でエスケープされる', async () => {
    const postBodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        if (init?.body) postBodies.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 'mock_msg' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    // 攻撃者制御の displayName でゲスト登録 → 投票 → organizer が確定
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    // ゲスト参加（masked link を含む displayName）
    const guestRegRes = await SELF.fetch(`${BASE}/api/events/${eventId}/participants`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'guest', displayName: '[クリック](https://attacker.example)' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(guestRegRes.status).toBe(201)
    const setCookie = guestRegRes.headers.get('set-cookie') ?? ''
    const guestCookie = setCookie.split(';')[0]!

    // ゲストの投票
    await SELF.fetch(`${BASE}/api/events/${eventId}/votes`, {
      method: 'PUT',
      body: JSON.stringify({ votes: [{ candidateId, choice: 'yes' }] }),
      headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    })

    // organizer 確定
    const decisionRes = await post(`/api/events/${eventId}/decision`, { candidateIds: [candidateId] }, { Cookie: organizerCookie })
    expect(decisionRes.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    // 確定通知のメッセージ body を探す（announce の後に decision の POST がある）
    const decisionPost = postBodies.find((b) => {
      const body = b as { embeds?: Array<{ description?: string; title?: string }> }
      return body.embeds?.[0]?.description?.includes('参加者:')
    }) as { embeds?: Array<{ description?: string }> } | undefined

    expect(decisionPost).toBeTruthy()
    const description = decisionPost!.embeds![0]!.description!
    // masked link が無効化されていることを確認
    expect(description).not.toContain('[クリック](https://attacker.example)')
    expect(description).toContain('\\[クリック\\]\\(https://attacker.example\\)')
  })

  it('SEC2: postDecisionMessage は allowed_mentions: { parse: [] } を必ず送る', async () => {
    const postBodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.startsWith('https://discord.com/')) {
        if (init?.body) postBodies.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 'mock_msg' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }))
    ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'

    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(await buildValidEventBase()),
      headers: { 'Content-Type': 'application/json', Cookie: organizerCookie },
    })
    expect(createRes.status).toBe(201)

    await new Promise((r) => setTimeout(r, 50))

    expect(postBodies.length).toBeGreaterThanOrEqual(1)
    for (const body of postBodies) {
      const b = body as { allowed_mentions?: { parse: unknown[] } }
      expect(b.allowed_mentions).toEqual({ parse: [] })
    }
  })
})

