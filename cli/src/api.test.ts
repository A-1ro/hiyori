import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createCliApi, HiyoriApiError, unwrap } from './api.js'

describe('createCliApi — Authorization ヘッダ付与', () => {
  let capturedInit: RequestInit | undefined

  beforeEach(() => {
    capturedInit = undefined
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('token あり: Authorization: Bearer <token> が送信される', async () => {
    const api = createCliApi('https://example.com', 'my-secret-token')
    await api.api.health.$get()
    const headers = capturedInit?.headers
    const authHeader = headers instanceof Headers
      ? headers.get('Authorization')
      : (headers as Record<string, string> | undefined)?.Authorization
    expect(authHeader).toBe('Bearer my-secret-token')
  })

  it('token なし: Authorization ヘッダが送信されない', async () => {
    const api = createCliApi('https://example.com')
    await api.api.health.$get()
    const headers = capturedInit?.headers
    const authHeader = headers instanceof Headers
      ? headers.get('Authorization')
      : (headers as Record<string, string> | undefined)?.Authorization
    expect(authHeader).toBeFalsy()
  })
})

describe('unwrap', () => {
  it('ok なら JSON を返す', async () => {
    const res = {
      ok: true,
      status: 200,
      json: async () => ({ data: 'value' }),
    }
    const result = await unwrap<{ data: string }>(res)
    expect(result.data).toBe('value')
  })

  it('!ok なら HiyoriApiError を throw する', async () => {
    const res = {
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }
    await expect(unwrap(res)).rejects.toThrow(HiyoriApiError)
    await expect(unwrap(res)).rejects.toMatchObject({ status: 403, message: 'Forbidden' })
  })
})
