// /mcp エンドポイントの認証・ゲート。
//
// 責務:
//   1. MCP_ENABLED フラグで機能ゲート（無効なら /mcp は 404 = 完全に不可視）。index.tsx が判定。
//   2. 案 B（Bearer パススルー）: 既存 Hiyori セッショントークンを Authorization: Bearer で提示された場合、
//      /api/auth/me で検証して props を組み立て McpAgent に委譲する（Phase 1 互換・CLI/パワーユーザー経路）。
//   3. 案 A（OAuth・Phase 2）: セッショントークンでないトークン（= OAuth アクセストークン）や未提示は、
//      tryLegacyBearerMcp が null を返し、呼び出し側（index.tsx）が workers-oauth-provider に委譲する。
//
// レート制限（MCP_RATELIMIT・key=discordUserId）は案 B 経路でここで、案 A 経路では provider.ts の
// apiHandler ラッパで適用する。McpAgent 側（agent.ts）のツール実装はどちらの経路でも無改造で再利用。

import { HiyoriMcpAgent } from './agent'
import { internalApi } from './internal'
import type { McpProps } from './types'
import type { Env } from '../index'

export const MCP_ROUTE = '/mcp'

// serve ハンドラはリクエストのたびに new する必要はないのでモジュールレベルで 1 度だけ生成。
export const mcpServeHandler = HiyoriMcpAgent.serve(MCP_ROUTE)

export function isMcpEnabled(env: Env): boolean {
  return env.MCP_ENABLED === 'true' || env.MCP_ENABLED === '1'
}

export function jsonRpcError(status: number, message: string): Response {
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

// 案 B: 既存 Hiyori セッション（web/cli/mcp）の Bearer が提示されていればパススルーで処理する。
// 処理した場合は Response を、対象外（Bearer 無し / セッションではない = OAuth トークンの可能性）なら
// null を返す。null のとき呼び出し側は OAuth provider（案 A）へ委譲する。
export async function tryLegacyBearerMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const authHeader = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!match) return null
  const token = match[1]!.trim()

  const me = await internalApi(env, token, 'GET', '/api/auth/me')
  const meBody = me.data as AuthMeResponse | null
  if (!me.ok || !meBody?.user) return null // セッションではない → OAuth へ委譲
  const user = meBody.user

  // レート制限（discordUserId キー）。binding 未設定（ローカル等）ならスキップ。
  if (env.MCP_RATELIMIT) {
    const { success } = await env.MCP_RATELIMIT.limit({ key: `mcp:${user.discordUserId}` })
    if (!success) {
      return jsonRpcError(429, 'Too many requests')
    }
  }

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
