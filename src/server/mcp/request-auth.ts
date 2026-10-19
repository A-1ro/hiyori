// Trusted only on the Worker → Durable Object hop. Both public auth routes
// overwrite this header; client-supplied values must never reach the agent.
import { Buffer } from 'node:buffer'
import type { McpProps } from './types'

export const MCP_AUTH_CONTEXT_HEADER = 'x-hiyori-internal-mcp-auth'

export function encodeMcpAuth(props: McpProps): string {
  return Buffer.from(JSON.stringify(props), 'utf8').toString('base64')
}

export function decodeMcpAuth(header: string | null): McpProps | null {
  if (!header) return null
  try {
    const value = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<McpProps>
    if (!value || typeof value !== 'object') return null
    for (const key of ['userId', 'discordUserId', 'username', 'displayName', 'apiToken'] as const) {
      if (typeof value[key] !== 'string') return null
    }
    if (value.globalName !== null && typeof value.globalName !== 'string') return null
    if (value.avatar !== null && typeof value.avatar !== 'string') return null
    if (!Array.isArray(value.scopes) || value.scopes.some((scope) => scope !== 'hiyori:read' && scope !== 'hiyori:write')) return null
    return value as McpProps
  } catch {
    return null
  }
}
