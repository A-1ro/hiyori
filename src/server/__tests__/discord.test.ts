import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { loginAs } from './test-helpers'

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

const validEventBase = {
  title: 'Discord テストイベント',
  defaultDurationMinutes: 60,
  discordChannelId: CHANNEL_ID,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
    { startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-02T11:00:00.000Z' },
  ],
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
  ;(env as Record<string, unknown>).DISCORD_BOT_TOKEN = 'test_token'
  organizerCookie = await loginAs(ORGANIZER_ID)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (env as Record<string, unknown>).DISCORD_BOT_TOKEN
  delete (env as Record<string, unknown>).DISCORD_PUBLIC_KEY
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
})

describe('Discord 通知 waitUntil', () => {
  it('T4: POST /decision → fetch モック成功 → discordMessageId 永続化 + AuditLog discord.notify.success', async () => {
    // fetch モックより先にイベントを作成（SELF.fetch を fetch モックの影響前に実行）
    const createRes = await SELF.fetch(`${BASE}/api/events`, {
      method: 'POST',
      body: JSON.stringify(validEventBase),
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

    const res = await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })
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
      body: JSON.stringify(validEventBase),
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

    const res = await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })
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
      body: JSON.stringify(validEventBase),
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

    // 先に確定
    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })

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
