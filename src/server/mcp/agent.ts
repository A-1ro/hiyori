// The existing remote MCP transport keeps its Durable Object. The shared tool
// registry is also used in memory by Hiyorichan, without calling this object.
import { McpAgent } from 'agents/mcp'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MCP_AUTH_CONTEXT_HEADER, decodeMcpAuth } from './request-auth'
import { createHiyoriMcpServer } from './tools'
import type { McpProps } from './types'
import type { Env } from '../index'

export class HiyoriMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server!: McpServer
  private readonly requestAuth = new AsyncLocalStorage<McpProps>()

  override async onConnect(...args: Parameters<McpAgent<Env, unknown, McpProps>['onConnect']>): Promise<void> {
    const props = decodeMcpAuth(args[1].request.headers.get(MCP_AUTH_CONTEXT_HEADER))
    if (!props) {
      args[0].close(1008, 'Missing request auth context')
      return
    }
    await this.requestAuth.run(props, () => super.onConnect(...args))
  }

  async init(): Promise<void> {
    this.server = createHiyoriMcpServer(this.env, () => {
      const props = this.requestAuth.getStore()
      if (!props) throw new Error('Missing MCP request authorization')
      return props
    })
  }
}
