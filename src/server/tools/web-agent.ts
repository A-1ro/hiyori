import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import type { Env } from '../index'
import type { SessionUser } from '../auth/session'
import { getSessionToken } from '../auth/cookies'
import { sessionToolApi } from './session-api'
import { hiyoriAgentChatSchema, hiyoriToolRequestSchema, hiyoriConfirmSchema } from '../../shared/hiyori-agent'
import { runHiyoriAgent } from '../services/hiyori-agent'
import { readHiyoriTool, prepareHiyoriAction, confirmHiyoriAction } from '../services/hiyori-actions'

type WebContext = Context<{ Bindings: Env }>
export function webAgentRoutes(authenticate: (c: WebContext) => Promise<SessionUser>) {
  async function actor(c: WebContext, expectedDiscordId: string) {
    const token = getSessionToken(c)
    if (!token) throw new HTTPException(401, { message: 'ログインが必要です。' })
    const user = await authenticate(c)
    if (user.kind !== 'web') throw new HTTPException(403, { message: 'サイトのセッションが必要です。' })
    if (expectedDiscordId !== user.discordUserId) throw new HTTPException(412, { message: 'アカウントが変わりました。会話を消去してください。' })
    return { env: c.env, user, sessionToken: token, call: sessionToolApi(c.env, token, new URL(c.req.url).origin, c.executionCtx, c.req.header('CF-Connecting-IP')) }
  }
  return new Hono<{ Bindings: Env }>()
    .use('*', bodyLimit({ maxSize: 300000, onError: (c) => c.json({ error: '入力が長すぎます。' }, 413) }))
    .use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== new URL(c.req.url).origin) return c.json({ error: 'Forbidden origin' }, 403)
      if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required' }, 415)
      const ip = c.req.header('CF-Connecting-IP')
      if (ip && c.env.CLI_AUTH_RATELIMIT && !(await c.env.CLI_AUTH_RATELIMIT.limit({ key: `hiyori-agent:ip:${ip}` })).success) return c.json({ error: '短時間に送りすぎました。少し待ってください。' }, 429)
      await next()
    })
    .onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
      // Never expose model output, signed tokens, input values or private API errors.
      const message = error instanceof ZodError || error instanceof SyntaxError ? '入力・応答を安全に読み取れませんでした。内容を確認してください。'
        : error instanceof Error && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(error.message) ? error.message : '操作を完了できませんでした。対象と現在の状態を確認してください。'
      return c.json({ error: message }, 400)
    })
    .post('/chat', async (c) => {
      const body = hiyoriAgentChatSchema.parse(await c.req.json())
      const person = await actor(c, body.expectedDiscordId)
      const result = await runHiyoriAgent(person, body)
      // Revalidate after inference; a revoked session cannot receive its result.
      await actor(c, body.expectedDiscordId)
      if ('error' in result) return c.json({ error: result.error }, result.status as 400 | 429 | 502 | 503)
      return c.json(result.result)
    })
    .post('/read', async (c) => {
      const body = hiyoriToolRequestSchema.parse(await c.req.json())
      return c.json(await readHiyoriTool(await actor(c, body.expectedDiscordId), body.name, body.arguments))
    })
    .post('/prepare', async (c) => {
      const body = hiyoriToolRequestSchema.parse(await c.req.json())
      return c.json(await prepareHiyoriAction(await actor(c, body.expectedDiscordId), body.name, body.arguments))
    })
    .post('/confirm', async (c) => {
      const body = hiyoriConfirmSchema.parse(await c.req.json())
      return c.json(await confirmHiyoriAction(await actor(c, body.expectedDiscordId), body.token))
    })
}
