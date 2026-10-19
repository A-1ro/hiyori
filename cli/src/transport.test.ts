import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSecureUrl, cliFetch } from './transport.js'

afterEach(() => vi.unstubAllGlobals())

describe('CLI transport policy', () => {
  it.each([
    'https://example.com',
    'https://example.com:8443/api',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://127.2.3.4',
    'http://[::1]:8787',
  ])('allows %s', (url) => {
    expect(() => assertSecureUrl(url)).not.toThrow()
  })

  it.each([
    'http://example.com',
    'http://192.168.1.1',
    'http://0.0.0.0',
    'http://[::]',
    'http://[2001:db8::1]',
    'http://example.local',
    'http://localhost.example.com',
    'http://127.0.0.1.example.com',
    'http://localhost@remote.example.com',
    'ftp://localhost',
    'file:///tmp/example',
    'not-a-url',
  ])('rejects %s before fetch', (url) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(() => cliFetch(url, { headers: { Authorization: 'Bearer fixture-token' } })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not echo credentials in validation errors', () => {
    expect(() => assertSecureUrl('https://fixture-user:fixture-password@example.com')).toThrow(
      'URL にユーザー名やパスワードを含めることはできません',
    )
  })

  it('forces redirect rejection for POST bodies and Request inputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://example.com/api/auth/cli/poll', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: 'fixture-device-code' }),
    })
    await cliFetch(request, { redirect: 'follow' })
    expect(fetchMock).toHaveBeenCalledWith(request, { redirect: 'error' })
    expect(() => cliFetch(new Request('http://example.com'))).toThrow('HTTPS')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
