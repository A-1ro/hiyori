// 案 A（Phase 2）の OAuthProvider 合成。
//
// workers-oauth-provider が MCP クライアント向け OAuth 2.1 プロバイダとなり:
//   - apiHandlers['/mcp'] : アクセストークンを検証 → props を注入 → McpAgent に委譲（レート制限を挟む）
//   - defaultHandler      : /oauth/authorize（同意＋Discord上流）と、それ以外の既存 Hono アプリ
//   - authorize/token/register エンドポイントとディスカバリ（.well-known）を提供
//
// grants/tokens は OAUTH_KV に暗号化保存される。MCP_ENABLED が有効なときだけ index.tsx がこの
// provider を使う（無効時は既存挙動のまま・/mcp は 404）。

import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

import { buildApp } from '../index'
import { jsonRpcError, mcpServeHandler } from './handler'
import { MCP_AUTHORIZE_PATH, MCP_REGISTER_PATH, MCP_SCOPES, MCP_TOKEN_PATH, handleAuthorize } from './oauth'
import type { McpProps } from './types'
import type { Env } from '../index'

// /mcp の apiHandler。provider がアクセストークンを検証し ctx.props（McpProps）を注入した後に呼ばれる。
// discordUserId をキーに MCP 用レート制限を適用してから McpAgent に委譲する。
const mcpApiHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: McpProps }).props
    if (props && env.MCP_RATELIMIT) {
      const { success } = await env.MCP_RATELIMIT.limit({ key: `mcp:${props.discordUserId}` })
      if (!success) return jsonRpcError(429, 'Too many requests')
    }
    return mcpServeHandler.fetch(request, env, ctx)
  },
}

// OAuth 以外の全リクエストを受ける defaultHandler。/oauth/authorize だけ自前で処理し、
// それ以外は既存 Hono アプリ（SSR + /api/* + Web Discord OAuth）へ委譲する。
const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === MCP_AUTHORIZE_PATH) {
      return handleAuthorize(request, env)
    }
    return buildApp(env).fetch(request, env, ctx)
  },
}

let cached: OAuthProvider | null = null

export function getOAuthProvider(): OAuthProvider {
  if (cached) return cached
  // apiHandlers / defaultHandler は fetch 必須の内部型を期待するが、ExportedHandler の fetch は
  // 任意扱いのため構造的に不一致になる。両ハンドラとも fetch を実装しているので options 全体を
  // コンストラクタのパラメータ型へ束ねてキャストする。
  const options = {
    apiHandlers: { '/mcp': mcpApiHandler },
    defaultHandler,
    authorizeEndpoint: MCP_AUTHORIZE_PATH,
    tokenEndpoint: MCP_TOKEN_PATH,
    clientRegistrationEndpoint: MCP_REGISTER_PATH,
    scopesSupported: [...MCP_SCOPES],
  } as unknown as ConstructorParameters<typeof OAuthProvider>[0]
  cached = new OAuthProvider(options)
  return cached
}
