import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://example.com'

function preflight(origin: string, requestedHeaders: string) {
  return SELF.fetch(`${BASE}/api/events`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': requestedHeaders,
    },
  })
}

describe('API CORS preflight', () => {
  it.each(['missing', 'missing%0A', 'missing%0D', 'missing%E2%80%A8', 'missing%E2%80%A9'])(
    'keeps wildcard middleware on an unknown API path: %s',
    async (suffix) => {
      // GHSA-h7mg-cq63-vhpq: encoded line terminators must not skip /api/*.
      const response = await SELF.fetch(`${BASE}/api/${suffix}`, {
        headers: { Origin: BASE },
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not Found' })
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(BASE)
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    },
  )

  it('allows the same origin and normalizes requested header names', async () => {
    const response = await preflight(BASE, 'content-type,   authorization')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(BASE)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type,authorization')
  })

  it('does not allow a different origin', async () => {
    const response = await preflight('https://other.example', 'content-type')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('handles whitespace-heavy requested headers', async () => {
    // Exercise the parser affected by GHSA-8j4g-w8fx-2239 without a timing assertion.
    const response = await preflight(BASE, `content-type,${' '.repeat(8000)}authorization`)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type,authorization')
  })
})
