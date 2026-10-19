import { describe, expect, it } from 'vitest'
import { decodeMcpAuth, encodeMcpAuth } from '../mcp/request-auth'
import type { McpProps } from '../mcp/types'

const props: McpProps = {
  userId: 'test-user', discordUserId: '123456789', username: 'test',
  globalName: '日和', avatar: null, displayName: '日和 🌤️',
  apiToken: 'synthetic-test-token', scopes: ['hiyori:read'],
}

describe('request-local MCP auth context', () => {
  it('preserves Unicode identity and exact scopes on the internal hop', () => {
    expect(decodeMcpAuth(encodeMcpAuth(props))).toEqual(props)
  })

  it.each([null, '', 'invalid-base64', btoa('null'), btoa('{}')])('fails closed on missing or malformed context %s', (header) => {
    expect(decodeMcpAuth(header)).toBeNull()
  })

  it('rejects unknown scopes and a missing API token', () => {
    expect(decodeMcpAuth(btoa(JSON.stringify({ ...props, globalName: null, displayName: 'test', scopes: ['admin'] })))).toBeNull()
    expect(decodeMcpAuth(btoa(JSON.stringify({ ...props, globalName: null, displayName: 'test', apiToken: null })))).toBeNull()
  })
})
