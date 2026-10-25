// Hiyori MCP エージェント（Agents SDK McpAgent / Durable Object）。
//
// Phase 0: whoami の 1 ツール + 足場。
// Phase 1: コア 8 ツール（list_events / get_event / tally / create_event / vote /
//          get_my_votes / confirm / get_ics）。
//
// 全ツールは internalApi 経由で既存 /api/* を Bearer で叩き、権限判定・バリデーション・
// レート制限をサーバー側に委ねる（二重実装しない）。認証は案 B（Bearer パススルー）。
// props（McpProps）に本人情報と内部呼び出し用 apiToken が入る。案 A への差し替えは
// handler.ts / props の組み立てだけで済み、本ファイルのツール実装は無改造。

import { McpAgent } from 'agents/mcp'
import { AsyncLocalStorage } from 'node:async_hooks'
import { MCP_AUTH_CONTEXT_HEADER, decodeMcpAuth } from './request-auth'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { internalApi, type InternalResponse } from './internal'
import { HiyoriTools } from '../tools/hiyori-tools'
import type { McpProps } from './types'
import type { Env } from '../index'

const SERVER_NAME = 'hiyori'
const SERVER_VERSION = '0.1.0'

export class HiyoriMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  private readonly requestAuth = new AsyncLocalStorage<McpProps>()

  // The SDK keeps its initial props for a live MCP session. Tool authorization
  // instead follows each authenticated HTTP request, including concurrent calls
  // or a different token/user reusing that session. No shared props are mutated.
  override async onConnect(...args: Parameters<McpAgent<Env, unknown, McpProps>['onConnect']>): Promise<void> {
    const [connection, { request }] = args
    const props = decodeMcpAuth(request.headers.get(MCP_AUTH_CONTEXT_HEADER))
    if (!props) {
      connection.close(1008, 'Missing request auth context')
      return
    }
    await this.requestAuth.run(props, () => super.onConnect(...args))
  }

  // ---- 内部ヘルパ ---------------------------------------------------------

  private requireProps(): McpProps {
    const props = this.requestAuth.getStore()
    if (!props) throw new Error('MCP request auth context is missing')
    return props
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<InternalResponse> {
    const props = this.requireProps()
    return internalApi(this.env, props.apiToken, method, path, body)
  }

  // ---- ツール登録 ---------------------------------------------------------

  async init(): Promise<void> {
    new HiyoriTools({ registerTool: (name, config, handler) => {
      const schema = z.object(config.inputSchema)
      return this.server.registerTool<z.ZodRawShape, typeof schema>(name, { ...config, inputSchema: schema }, async (input) => handler(schema.parse(input)))
    } }, {
      hasScope: (scope) => this.requestAuth.getStore()?.scopes.includes(scope) ?? false,
      principal: () => this.requireProps(),
      call: (method, path, body) => this.call(method, path, body),
    }).registerAll()
  }
}
