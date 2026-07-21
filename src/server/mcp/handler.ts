// /mcp エンドポイントの前段ミドルウェア（Phase 0/1・案 B Bearer パススルー）。
//
// 責務:
//   1. MCP_ENABLED フラグで機能ゲート（無効なら /mcp は 404 = 完全に不可視）。
//   2. 認証（案 B）: Authorization: Bearer <token> を既存 /api/auth/me で検証し本人を確定。
//   3. レート制限: MCP_RATELIMIT を discordUserId キーで適用（AI は同一 IP から大量に叩きうる）。
//   4. props（McpProps）を ctx にセットして McpAgent.serve('/mcp') に委譲。
//
// ★案 A（OAuth）への差し替え: この handler を workers-oauth-provider の apiHandler 合成に置き換え、
//   props.discordUserId を Discord 上流認証から確定させ、apiToken に kind:'mcp' 短命セッションを入れる。
//   McpAgent 側（agent.ts）のツール実装は無改造で再利用できる。

import { HiyoriMcpAgent } from './agent'
import { internalApi } from './internal'
import type { McpProps } from './types'
import type { Env } from '../index'

export const MCP_ROUTE = '/mcp'

// serve ハンドラはリクエストのたびに new する必要はないのでモジュールレベルで 1 度だけ生成。
const mcpServeHandler = HiyoriMcpAgent.serve(MCP_ROUTE)

export function isMcpEnabled(env: Env): boolean {
  return env.MCP_ENABLED === 'true' || env.MCP_ENABLED === '1'
}

function jsonRpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

interface AuthMeResponse {
  user: null | {
    userId: string
    discordUserId: string
    username: string
    globalName: string | null
    avatar: string | null
    displayName: string
  }
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 1. フラグ off なら存在しないものとして 404（既存機能に一切影響しない）。
  if (!isMcpEnabled(env)) {
    return new Response('Not Found', { status: 404 })
  }

  // 2. 認証（案 B: Bearer パススルー）。
  const authHeader = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!match) {
    return jsonRpcError(401, 'Authentication required: Authorization: Bearer <token>')
  }
  const token = match[1]!.trim()

  const me = await internalApi(env, token, 'GET', '/api/auth/me')
  const meBody = me.data as AuthMeResponse | null
  if (!me.ok || !meBody?.user) {
    return jsonRpcError(401, 'Invalid or expired token')
  }
  const user = meBody.user

  // 3. レート制限（discordUserId キー）。binding 未設定（ローカル等）ならスキップ。
  if (env.MCP_RATELIMIT) {
    const { success } = await env.MCP_RATELIMIT.limit({ key: `mcp:${user.discordUserId}` })
    if (!success) {
      return jsonRpcError(429, 'Too many requests')
    }
  }

  // 4. props を組み立てて McpAgent に委譲。
  const props: McpProps = {
    userId: user.userId,
    discordUserId: user.discordUserId,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    displayName: user.displayName,
    apiToken: token,
    // 案 B は full セッション = read/write 両方。案 A では同意スコープに応じて絞る。
    scopes: ['hiyori:read', 'hiyori:write'],
  }
  ;(ctx as ExecutionContext & { props?: McpProps }).props = props

  return mcpServeHandler.fetch(request, env, ctx)
}
