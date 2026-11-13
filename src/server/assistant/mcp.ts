import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createHiyoriMcpServer } from '../mcp/tools'
import type { McpProps } from '../mcp/types'
import type { Env } from '../index'
import { ASSISTANT_TOOL_LABELS } from '../../shared/assistant'
import type { ExecutionContext } from 'hono'

export async function withAssistantMcp<T>(env: Env, props: McpProps, context: ExecutionContext, fn: (client: Client) => Promise<T>): Promise<T> {
  const server = createHiyoriMcpServer(env, () => props, context)
  const client = new Client({ name: 'hiyorichan', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return await fn(client)
  } finally {
    await Promise.allSettled([client.close(), server.close()])
  }
}

export async function assistantTools(client: Client) {
  const result = await client.listTools()
  // Explicit allowlist excludes assistant_* tools, preventing recursion and
  // preventing newly registered tools from gaining automatic model access.
  return result.tools.filter(tool => Object.hasOwn(ASSISTANT_TOOL_LABELS, tool.name))
}

export async function callAssistantTool(client: Client, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30_000 })
  return { content: result.content as CallToolResult['content'], isError: result.isError === true }
}
