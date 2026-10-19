import { describe, expect, it } from 'vitest'
import { addSupportedResourceScopes } from '../mcp/resource-metadata'

const resource = 'https://example.com/mcp'
const url = 'https://example.com/.well-known/oauth-protected-resource/mcp'
const scopes = ['hiyori:read', 'hiyori:write']
const original = { resource, authorization_servers: ['https://example.com'], bearer_methods_supported: ['header'], extension: 'preserved' }

function metadataResponse(body: unknown = original, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*',
    'cache-control': 'no-store', 'content-length': '123', etag: 'old-content',
  } })
}

describe('optional MCP resource-scope discovery', () => {
  it('adds the supported catalogue while retaining resource identity, extensions, and CORS', async () => {
    const response = await addSupportedResourceScopes(new Request(url), metadataResponse(), resource, scopes)
    expect(await response.json()).toEqual({ ...original, scopes_supported: scopes })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('content-length')).toBe(false)
    expect(response.headers.has('etag')).toBe(false)
  })

  it.each(['HEAD', 'OPTIONS', 'POST'])('leaves %s responses untouched', async (method) => {
    const response = new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } })
    expect(await addSupportedResourceScopes(new Request(url, { method }), response, resource, scopes)).toBe(response)
  })

  it.each([
    'https://example.com/.well-known/oauth-protected-resource',
    `${url}/`, `${url}?query=1`, 'https://preview.example.com/.well-known/oauth-protected-resource/mcp',
    'https://example.com/.well-known/oauth-authorization-server', 'https://example.com/api/health',
  ])('leaves unrelated or noncanonical URL %s untouched', async (requestUrl) => {
    const response = metadataResponse()
    expect(await addSupportedResourceScopes(new Request(requestUrl), response, resource, scopes)).toBe(response)
  })

  it.each([401, 404, 405, 500])('leaves status %s untouched', async (status) => {
    const response = metadataResponse({ error: 'unchanged' }, status)
    expect(await addSupportedResourceScopes(new Request(url), response, resource, scopes)).toBe(response)
    expect(await response.json()).toEqual({ error: 'unchanged' })
  })

  it('leaves an unexpected resource, malformed JSON, or other content type untouched', async () => {
    for (const response of [
      metadataResponse({ ...original, resource: 'https://other.example/mcp' }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response('unrelated', { headers: { 'content-type': 'text/plain' } }),
    ]) {
      expect(await addSupportedResourceScopes(new Request(url), response, resource, scopes)).toBe(response)
      expect(response.bodyUsed).toBe(false)
    }
  })
})
