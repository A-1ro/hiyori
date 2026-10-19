// Publish optional capabilities without configuring the provider's baseline
// requiredScopes (which also controls its WWW-Authenticate scope challenge).
export async function addSupportedResourceScopes(
  request: Request,
  response: Response,
  resource: string,
  scopes: readonly string[],
): Promise<Response> {
  const canonicalResource = new URL(resource)
  const metadataUrl = `${canonicalResource.origin}/.well-known/oauth-protected-resource${canonicalResource.pathname}`
  if (request.method !== 'GET' || request.url !== metadataUrl || response.status !== 200) return response
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return response
  let metadata: Record<string, unknown>
  try {
    metadata = await response.clone().json() as Record<string, unknown>
  } catch {
    return response
  }
  if (!metadata || metadata.resource !== resource || !Array.isArray(metadata.authorization_servers)
    || !metadata.authorization_servers.every((issuer) => typeof issuer === 'string')) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('etag')
  return new Response(JSON.stringify({ ...metadata, scopes_supported: [...scopes] }), {
    status: response.status, statusText: response.statusText, headers,
  })
}
