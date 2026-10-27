import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createHiyoriMcpServer } from './tools'
import type { McpProps } from './types'
import type { Env } from '../index'

// Use the existing SDK/tools in a fresh request-local transport. No MCP session,
// Durable Object, WebSocket bridge, or mutable identity survives this request.
export async function serveStatelessMcp(request: Request, env: Env, ctx: ExecutionContext, props: McpProps): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== url.origin) return new Response('Forbidden Origin', { status: 403 })
  // Standalone server streams/replay are intentionally unavailable. Clients using
  // Streamable HTTP support 405 here and continue with ordinary POST requests.
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })

  const server = createHiyoriMcpServer(env, () => props, ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  try {
    await server.connect(transport)
    // In JSON mode this resolves after the tool result, so closing the server
    // below cannot interrupt a response stream or an in-flight write.
    const response = await transport.handleRequest(request)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } finally {
    await server.close()
  }
}
