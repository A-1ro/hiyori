// 案 A（Phase 2）の OAuthProvider 合成。
//
// workers-oauth-provider が MCP クライアント向け OAuth 2.1 プロバイダとなり:
//   - apiHandlers['/mcp'] : アクセストークンを検証 → props を注入 → McpAgent に委譲（レート制限を挟む）
//   - defaultHandler      : /oauth/authorize（同意＋Discord上流）と、それ以外の既存 Hono アプリ
//   - authorize/token/register エンドポイントとディスカバリ（.well-known）を提供
//
// grants/tokens は OAUTH_KV に暗号化保存される。MCP_ENABLED が有効なときだけ index.tsx がこの
// provider を使う（無効時は既存挙動のまま・/mcp は 404）。

import { OAuthProvider, type OAuthResourceAuth } from '@cloudflare/workers-oauth-provider'

import { buildApp } from '../index'
import { MCP_ROUTE, jsonRpcError, serveAuthenticatedMcp } from './handler'
import { MCP_AUTHORIZE_PATH, MCP_REGISTER_PATH, MCP_SCOPES, MCP_TOKEN_PATH, handleAuthorize } from './oauth'
import type { McpProps } from './types'
import { addSupportedResourceScopes } from './resource-metadata'
import type { Env } from '../index'

// /mcp の apiHandler。provider がアクセストークンを検証し ctx.props（McpProps）を注入した後に呼ばれる。
// discordUserId をキーに MCP 用レート制限を適用してから McpAgent に委譲する。
const mcpApiHandler = {
  async fetch(request, env, ctx) {
    const oauthCtx = ctx as ExecutionContext & { props?: McpProps; auth?: OAuthResourceAuth }
    const props = oauthCtx.props
    if (props && env.MCP_RATELIMIT) {
      const { success } = await env.MCP_RATELIMIT.limit({ key: `mcp:${props.discordUserId}` })
      if (!success) return jsonRpcError(429, 'Too many requests')
    }
    if (!props) return jsonRpcError(401, 'Missing OAuth auth context')
    // Encrypted props hold the original consent. A refreshed access token may
    // carry fewer scopes, so never let consent props widen that token's rights.
    const tokenScopes = oauthCtx.auth?.scope ?? []
    const effectiveProps = { ...props, scopes: props.scopes.filter((scope) => tokenScopes.includes(scope)) }
    return serveAuthenticatedMcp(request, env, ctx, effectiveProps)
  },
} satisfies ExportedHandler<Env>

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

// 0.x advertised the requested origin + /mcp as its resource. Keep that exact
// audience for existing grants, including on preview and local development hosts.
// Cache only the last origin, so arbitrary Host values cannot grow an unbounded map.
let cached: { origin: string; provider: OAuthProvider<Env> } | undefined

export function getOAuthProvider(requestUrl: string): OAuthProvider<Env> {
  const origin = new URL(requestUrl).origin
  if (cached?.origin === origin) return cached.provider
  const provider = new OAuthProvider<Env>({
    apiHandlers: { [MCP_ROUTE]: mcpApiHandler },
    defaultHandler,
    authorizeEndpoint: MCP_AUTHORIZE_PATH,
    tokenEndpoint: MCP_TOKEN_PATH,
    clientRegistrationEndpoint: MCP_REGISTER_PATH,
    scopesSupported: [...MCP_SCOPES],
    resourceMetadata: { resource: `${origin}${MCP_ROUTE}` },
    // Do not require all supported scopes at the transport: consent can grant
    // read-only access, and individual tools enforce their own scope requirements.
  })
  cached = { origin, provider }
  return provider
}

export async function fetchOAuthProvider(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Keep injected helpers request-local: env may be reused on another hostname.
  const response = await getOAuthProvider(request.url).fetch(request, { ...env, OAUTH_PROVIDER: undefined }, ctx)
  return addSupportedResourceScopes(request, response, `${new URL(request.url).origin}${MCP_ROUTE}`, MCP_SCOPES)
}
