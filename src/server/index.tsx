/** @jsxImportSource hono/jsx */
import { d1Adapter, nanoka } from '@nanokajs/core'
import type { RowType } from '@nanokajs/core'
import type { BatchItem } from 'drizzle-orm/batch'
import { eq, inArray, and, isNull, ne } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import type { Context } from 'hono'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { applyDecisions, cancelAllDecisions } from './services/decision'
import { eventToVEvent, wrapInVCalendar } from './ics/serialize'
import { notifyDecisionsChanged, announceEventCreated } from './discord/notifier'
import { verifyDiscordSignature } from './discord/verify'
import { signChannelToken, verifyChannelToken } from './discord/channel-token'
import { auditLogFields, auditLogTableName } from '../models/auditLog'
import {
  calendarSubscriptionFields,
  calendarSubscriptionTableName,
} from '../models/calendarSubscription'
import { candidateFields, candidateTableName } from '../models/candidate'
import { decisionFields, decisionTableName } from '../models/decision'
import { eventFields, eventTableName } from '../models/event'
import { participantFields, participantTableName } from '../models/participant'
import { voteFields, voteTableName } from '../models/vote'
import { calendar_subscriptions, candidates, decisions, events, participants, votes, users, sessions } from '../../drizzle/schema'
import { userTableName, userFields } from '../models/user'
import { sessionTableName, sessionFields } from '../models/session'
import { setSessionCookie, clearSessionCookie, getSessionToken, setStateCookie, consumeStateCookie, generateSessionToken, hashToken, isSecureRequest, SESSION_TTL_SECONDS } from './auth/cookies'
import { loadSession, requireSession } from './auth/session'
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordMe } from './auth/discord'

export interface Env {
  DB: D1Database
  ENVIRONMENT: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_PUBLIC_KEY?: string
  DISCORD_APP_ID?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  DISCORD_OAUTH_REDIRECT_URI?: string
  // /hiyori new スラッシュコマンド由来の channel ID を Hiyori が HMAC 署名するための秘密鍵。
  // POST/PATCH /api/events で discordChannelToken の検証に使う。未設定なら Discord 連携不可。
  DISCORD_CHANNEL_TOKEN_SECRET?: string
}

const displayNameSchema = z.string().min(1).max(80).refine(
  (s) => s.trim().length > 0,
  { message: 'displayName cannot be whitespace only' },
).refine(
  (s) => !/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]/.test(s),
  { message: 'displayName contains forbidden control characters' },
)

const createEventBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  defaultDurationMinutes: z.number().int().min(1).max(60 * 24),
  deadline: z.string().datetime().optional(),
  timezone: z.string().max(64).optional(),
  // /hiyori new から発行された HMAC 署名トークン。直接 channel ID を受け付けない。
  discordChannelToken: z.string().min(1).max(1024).optional(),
  candidates: z
    .array(
      z.object({
        startAt: z.string().datetime(),
        endAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(365),
})

const patchEventBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  deadline: z.string().datetime().optional().nullable(),
  defaultDurationMinutes: z.number().int().min(1).max(60 * 24).optional(),
  timezone: z.string().max(64).optional(),
  // 連携を解除する場合は null、新規 / 更新は HMAC 署名トークン。
  discordChannelToken: z.string().min(1).max(1024).optional().nullable(),
})

const addCandidateBody = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
})

const GUEST_COOKIE_PREFIX = 'hiyori_guest_'

const generateGuestToken = generateSessionToken
const hashGuestToken = hashToken

function generateSubscriptionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function buildWebcalUrl(host: string, token: string): string {
  return `webcal://${host}/feeds/${token}.ics`
}

const registerParticipantBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('guest'),
    displayName: displayNameSchema,
  }),
  z.object({
    kind: z.literal('discord'),
    displayName: displayNameSchema,
  }),
])

const createDecisionBody = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(50),
})

const putVotesBody = z.object({
  votes: z
    .array(
      z.object({
        candidateId: z.string().uuid(),
        choice: z.enum(['yes', 'maybe', 'no']),
        comment: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(365),
})

// D1 caps each query at 100 bind parameters. Chunk IN(...) lookups so callers
// can pass arbitrarily long id lists without hitting the cap.
const D1_BIND_CHUNK = 90

async function selectInChunks<TRow>(
  ids: readonly string[],
  fetcher: (chunk: string[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  if (ids.length === 0) return []
  const out: TRow[] = []
  for (let i = 0; i < ids.length; i += D1_BIND_CHUNK) {
    out.push(...(await fetcher(ids.slice(i, i + D1_BIND_CHUNK))))
  }
  return out
}

function chunkIds<T>(ids: readonly string[], build: (chunk: string[]) => T): T[] {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += D1_BIND_CHUNK) {
    out.push(build(ids.slice(i, i + D1_BIND_CHUNK)))
  }
  return out
}

function isAllDay(startAt: Date, endAt: Date): boolean {
  const midnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  const diffMs = endAt.getTime() - startAt.getTime()
  return midnight(startAt) && midnight(endAt) && diffMs >= 24 * 60 * 60 * 1000
}

const buildApp = (env: Env) => {
  const app = nanoka<{ Bindings: Env }>(d1Adapter(env.DB))

  const Event = app.model(eventTableName, eventFields)
  const Candidate = app.model(candidateTableName, candidateFields)
  const Participant = app.model(participantTableName, participantFields)
  const Vote = app.model(voteTableName, voteFields)
  const Decision = app.model(decisionTableName, decisionFields)
  const CalendarSubscription = app.model(calendarSubscriptionTableName, calendarSubscriptionFields)
  const AuditLog = app.model(auditLogTableName, auditLogFields)
  const User = app.model(userTableName, userFields)
  const Session = app.model(sessionTableName, sessionFields)

  // M2: /api/* に同一オリジンのみ許可する CORS チェック
  app.use('/api/*', cors({
    origin: (origin, c) => {
      if (!origin) return origin
      const url = new URL(c.req.url)
      return origin === url.origin ? origin : null
    },
    credentials: true,
  }))

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }
    console.error(err)
    const isDev = c.env.ENVIRONMENT === 'development'
    return c.json({ error: isDev ? (err.message || 'Internal Server Error') : 'Internal Server Error' }, 500)
  })

  const isDev = env.ENVIRONMENT !== 'production'

  // @vitejs/plugin-react が要求する React Refresh preamble。
  // dev 専用。prod では /@react-refresh が存在しないので必ずスキップする。
  const reactRefreshPreamble = `
import RefreshRuntime from '/@react-refresh'
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
`.trim()

  const renderShell = (reqUrl: string) => {
    const u = new URL(reqUrl)
    const ogUrl = `${u.origin}${u.pathname}`
    const ogImage = `${u.origin}/hiyori-ogp.png`
    const siteTitle = 'Hiyori — 時間帯で合わせる日程調整'
    const siteDescription =
      'Discord と使える日程調整ツール。時間帯ごとに○△×で聞くから「この人の○は昼？夜？」の確認がいらない。決まった日はカレンダーに自動で入ります。'
    return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{siteTitle}</title>
        <meta name="description" content={siteDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Hiyori" />
        <meta property="og:title" content={siteTitle} />
        <meta property="og:description" content={siteDescription} />
        <meta property="og:url" content={ogUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1729" />
        <meta property="og:image:height" content="910" />
        <meta property="og:locale" content="ja_JP" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={siteTitle} />
        <meta name="twitter:description" content={siteDescription} />
        <meta name="twitter:image" content={ogImage} />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <ViteClient />
        {isDev && <script type="module" src="/@react-refresh" />}
        {isDev && (
          <script type="module" dangerouslySetInnerHTML={{ __html: reactRefreshPreamble }} />
        )}
        <Link href="/src/styles.css" rel="stylesheet" />
        <Script type="module" src="/src/client/main.tsx" />
      </head>
      <body>
        <div id="root"></div>
      </body>
    </html>
    )
  }

  async function resolveParticipantByCookie(
    c: Context<{ Bindings: Env }>,
    eventId: string,
  ): Promise<RowType<typeof participantFields> | null> {
    const cookieName = `${GUEST_COOKIE_PREFIX}${eventId}`
    const guestToken = getCookie(c, cookieName)
    if (!guestToken) return null
    const hash = await hashGuestToken(guestToken)
    const rows = await Participant.findMany({ where: { eventId, guestTokenHash: hash }, limit: 1 })
    return rows.length > 0 ? rows[0]! : null
  }

  async function resolveParticipantByAnyAuth(
    c: Context<{ Bindings: Env }>,
    eventId: string,
  ): Promise<RowType<typeof participantFields> | null> {
    const guest = await resolveParticipantByCookie(c, eventId)
    if (guest) return guest
    const s = await loadSession(c, app, sessions, users)
    if (!s) return null
    const rows = await Participant.findMany({
      where: { eventId, discordUserId: s.discordUserId },
      limit: 1,
    })
    return rows.length > 0 ? rows[0]! : null
  }

  const routes = app
    .get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))
    .get('/api/auth/discord', async (c) => {
      if (!c.env.DISCORD_CLIENT_ID) return c.json({ error: 'Discord OAuth not configured' }, 503)
      const returnTo = c.req.query('returnTo') ?? '/'
      const safeReturnTo = /^\/[^/]/.test(returnTo) || returnTo === '/' ? returnTo : '/'
      const rawState = crypto.randomUUID()
      const stateBundle = btoa(JSON.stringify({ s: rawState, r: safeReturnTo })).replace(/=+$/, '')
      setStateCookie(c, rawState)
      const url = new URL(c.req.url)
      const redirectUri = c.env.DISCORD_OAUTH_REDIRECT_URI ?? `${url.origin}/api/auth/discord/callback`
      return c.redirect(buildAuthorizeUrl(c.env, stateBundle, redirectUri), 302)
    })
    .get('/api/auth/discord/callback', async (c) => {
      const code = c.req.query('code')
      const stateBundle = c.req.query('state')
      if (!code || !stateBundle) return c.json({ error: 'Missing code or state' }, 400)
      const cookieState = consumeStateCookie(c)
      if (!cookieState) return c.json({ error: 'Missing state cookie' }, 400)
      if (!c.env.DISCORD_CLIENT_ID || !c.env.DISCORD_CLIENT_SECRET) {
        return c.json({ error: 'Discord OAuth not configured' }, 503)
      }
      let parsed: { s: string; r: string }
      try {
        const padding = '==='.slice(0, (4 - stateBundle.length % 4) % 4)
        parsed = JSON.parse(atob(stateBundle + padding)) as { s: string; r: string }
      } catch {
        return c.json({ error: 'Invalid state' }, 400)
      }
      if (parsed.s !== cookieState) return c.json({ error: 'State mismatch' }, 400)
      const safeR = /^\/[^/]/.test(parsed.r) || parsed.r === '/' ? parsed.r : '/'

      const url = new URL(c.req.url)
      const redirectUri = c.env.DISCORD_OAUTH_REDIRECT_URI ?? `${url.origin}/api/auth/discord/callback`
      const tok = await exchangeCodeForToken(c.env, code, redirectUri)
      const me = await fetchDiscordMe(tok.access_token)

      const existing = await User.findMany({ where: { discordUserId: me.id }, limit: 1 })
      let userId: string
      const sessionToken = generateSessionToken()
      const tokenHash = await hashToken(sessionToken)
      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
      const sessionValues = {
        id: crypto.randomUUID(),
        userId: '' as string,
        tokenHash,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt,
      }
      if (existing.length > 0) {
        userId = existing[0]!.id
        sessionValues.userId = userId
        const now = new Date()
        await app.batch([
          app.db.update(users).set({
            username: me.username,
            globalName: me.global_name ?? null,
            avatar: me.avatar ?? null,
            updatedAt: now,
          }).where(eq(users.id, userId)),
          app.db.insert(sessions).values(sessionValues),
        ])
      } else {
        userId = crypto.randomUUID()
        sessionValues.userId = userId
        const now = new Date()
        await app.batch([
          app.db.insert(users).values({
            id: userId,
            discordUserId: me.id,
            username: me.username,
            globalName: me.global_name ?? null,
            avatar: me.avatar ?? null,
            createdAt: now,
            updatedAt: now,
          }),
          app.db.insert(sessions).values(sessionValues),
        ])
      }

      setSessionCookie(c, sessionToken)
      return c.redirect(safeR, 302)
    })
    .post('/api/auth/logout', async (c) => {
      const token = getSessionToken(c)
      if (token) {
        const tokenHash = await hashToken(token)
        await Session.delete({ tokenHash })
      }
      clearSessionCookie(c)
      return c.json({ ok: true })
    })
    .get('/api/auth/me', async (c) => {
      const s = await loadSession(c, app, sessions, users)
      if (!s) return c.json({ user: null })
      return c.json({
        user: {
          userId: s.userId,
          discordUserId: s.discordUserId,
          username: s.username,
          globalName: s.globalName,
          avatar: s.avatar,
          displayName: s.displayName,
        },
      })
    })
    .post(
      '/api/events',
      zValidator('json', createEventBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        const session = await requireSession(c, app, sessions, users)
        const body = c.req.valid('json')

        let resolvedChannelId: string | null = null
        if (body.discordChannelToken) {
          if (!c.env.DISCORD_CHANNEL_TOKEN_SECRET) {
            throw new HTTPException(503, { message: 'Discord channel binding not configured' })
          }
          const verified = await verifyChannelToken(
            c.env.DISCORD_CHANNEL_TOKEN_SECRET,
            body.discordChannelToken,
          )
          if (!verified) {
            throw new HTTPException(400, { message: 'Invalid or expired Discord channel token' })
          }
          resolvedChannelId = verified.channelId
        }

        const candidateInputs = body.candidates.map((cand) => {
          const startAt = new Date(cand.startAt)
          const endAt = cand.endAt ? new Date(cand.endAt) : new Date(startAt.getTime() + body.defaultDurationMinutes * 60000)
          if (isAllDay(startAt, endAt)) {
            throw new HTTPException(400, { message: '終日イベントの候補枠は登録できません' })
          }
          return { startAt, endAt }
        })

        // event と candidates を D1 batch で atomic に挿入する
        const eventId = crypto.randomUUID()
        const eventCreatedAt = new Date()
        const candidateValues = candidateInputs.map((ci) => ({
          id: crypto.randomUUID(),
          eventId,
          startAt: ci.startAt,
          endAt: ci.endAt,
        }))

        // D1 の SQLITE_MAX_VARIABLE_NUMBER 制約を避けるため candidates は分割 INSERT。
        // 1 行 4 列なので 20 行 = 80 params に抑える（同一 batch 内なので atomic は維持）。
        const CHUNK = 20
        const candidateInserts = []
        for (let i = 0; i < candidateValues.length; i += CHUNK) {
          candidateInserts.push(app.db.insert(candidates).values(candidateValues.slice(i, i + CHUNK)))
        }
        await app.batch([
          app.db.insert(events).values({
            id: eventId,
            organizerDiscordId: session.discordUserId,
            title: body.title,
            description: body.description ?? null,
            defaultDurationMinutes: body.defaultDurationMinutes,
            status: 'open',
            deadline: body.deadline ? new Date(body.deadline) : null,
            timezone: body.timezone ?? 'UTC',
            discordChannelId: resolvedChannelId,
            createdAt: eventCreatedAt,
          }),
          ...candidateInserts,
        ])

        const eventRow = await Event.findOne(eventId)
        if (!eventRow) throw new HTTPException(500, { message: 'Internal Server Error' })
        const candidateRows = await Candidate.findMany({ where: { eventId }, limit: 1000 })

        if (eventRow.discordChannelId) {
          const workerHost = new URL(c.req.url).host
          c.executionCtx.waitUntil(
            announceEventCreated(
              { app, workerHost },
              c.env,
              {
                id: eventRow.id,
                title: eventRow.title,
                description: eventRow.description,
                discordChannelId: eventRow.discordChannelId,
              },
            ),
          )
        }

        return c.json(
          {
            event: Event.toResponse(eventRow),
            candidates: Candidate.toResponseMany(candidateRows),
          },
          201,
        )
      },
    )
    .get('/api/events/:id', async (c) => {
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)

      const candidateRows = await Candidate.findMany({
        where: { eventId: id },
        orderBy: { column: 'startAt', direction: 'asc' },
        limit: 1000,
      })

      return c.json({
        event: Event.toResponse(eventRow),
        candidates: Candidate.toResponseMany(candidateRows),
      })
    })
    .patch(
      '/api/events/:id',
      zValidator('json', patchEventBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        const session = await requireSession(c, app, sessions, users)
        const id = c.req.param('id')
        const eventRow = await Event.findOne(id)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)
        if (eventRow.organizerDiscordId !== session.discordUserId) return c.json({ error: 'Forbidden' }, 403)

        const body = c.req.valid('json')

        const updateData: Partial<typeof eventRow> = {}
        if (body.title !== undefined) updateData.title = body.title
        if (body.description !== undefined) updateData.description = body.description
        if (body.deadline !== undefined) updateData.deadline = body.deadline ? new Date(body.deadline) : undefined
        if (body.defaultDurationMinutes !== undefined) updateData.defaultDurationMinutes = body.defaultDurationMinutes
        if (body.timezone !== undefined) updateData.timezone = body.timezone
        if (body.discordChannelToken !== undefined) {
          if (body.discordChannelToken === null) {
            updateData.discordChannelId = undefined
          } else {
            if (!c.env.DISCORD_CHANNEL_TOKEN_SECRET) {
              throw new HTTPException(503, { message: 'Discord channel binding not configured' })
            }
            const verified = await verifyChannelToken(
              c.env.DISCORD_CHANNEL_TOKEN_SECRET,
              body.discordChannelToken,
            )
            if (!verified) {
              throw new HTTPException(400, { message: 'Invalid or expired Discord channel token' })
            }
            updateData.discordChannelId = verified.channelId
          }
        }

        const updated = await Event.update(id, updateData)
        if (!updated) return c.json({ error: 'Not Found' }, 404)

        return c.json({ event: Event.toResponse(updated) })
      },
    )
    .delete('/api/events/:id', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)
      if (eventRow.organizerDiscordId !== session.discordUserId) return c.json({ error: 'Forbidden' }, 403)

      const candidateRows = await Candidate.findMany({ where: { eventId: id }, limit: 10000 })
      const candidateIds = candidateRows.map((r) => r.id)

      // decisions → votes → participants → candidates → events の順で D1 batch により atomic に削除。
      // votes は候補 id が D1 の bind 上限 (100) を超え得るので chunkIds で複数文に分割する。
      const voteDeletes = chunkIds(candidateIds, (chunk) =>
        app.db.delete(votes).where(inArray(votes.candidateId, chunk)),
      )
      await app.batch([
        app.db.delete(decisions).where(eq(decisions.eventId, id)),
        ...voteDeletes,
        app.db.delete(participants).where(eq(participants.eventId, id)),
        app.db.delete(candidates).where(eq(candidates.eventId, id)),
        app.db.delete(events).where(eq(events.id, id)),
      ])

      return new Response(null, { status: 204 })
    })
    .post(
      '/api/events/:id/candidates',
      zValidator('json', addCandidateBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        const session = await requireSession(c, app, sessions, users)
        const id = c.req.param('id')
        const eventRow = await Event.findOne(id)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)
        if (eventRow.organizerDiscordId !== session.discordUserId) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const body = c.req.valid('json')
        const startAt = new Date(body.startAt)
        const endAt = body.endAt
          ? new Date(body.endAt)
          : new Date(startAt.getTime() + eventRow.defaultDurationMinutes * 60000)

        if (isAllDay(startAt, endAt)) {
          return c.json({ error: '終日イベントの候補枠は登録できません' }, 400)
        }

        const candidateRow = await Candidate.create({ eventId: id, startAt, endAt })
        return c.json({ candidate: Candidate.toResponse(candidateRow) }, 201)
      },
    )
    .delete('/api/events/:id/candidates/:candidateId', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const eventId = c.req.param('id')
      const candidateId = c.req.param('candidateId')

      const eventRow = await Event.findOne(eventId)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)
      if (eventRow.organizerDiscordId !== session.discordUserId) {
        return c.json({ error: 'Forbidden' }, 403)
      }

      const candidateRow = await Candidate.findOne(candidateId)
      if (!candidateRow || candidateRow.eventId !== eventId) {
        return c.json({ error: 'Not Found' }, 404)
      }

      await Vote.delete({ candidateId })
      await Candidate.delete(candidateId)

      return new Response(null, { status: 204 })
    })
    .post(
      '/api/events/:id/participants',
      zValidator('json', registerParticipantBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        const eventId = c.req.param('id')
        const eventRow = await Event.findOne(eventId)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)

        if (eventRow.deadline && new Date() > eventRow.deadline) {
          return c.json({ error: 'Deadline passed' }, 403)
        }

        const body = c.req.valid('json')

        if (body.kind === 'discord') {
          const session = await requireSession(c, app, sessions, users)
          const existing = await Participant.findMany({
            where: { eventId, discordUserId: session.discordUserId },
            limit: 1,
          })
          const displayName = body.displayName
          if (existing.length > 0) {
            const updated = await Participant.update(existing[0]!.id, { displayName })
            return c.json({ participant: Participant.toResponse(updated ?? existing[0]!) }, 200)
          }
          const newId = crypto.randomUUID()
          await app.db.insert(participants).values({
            id: newId,
            eventId,
            kind: 'discord',
            discordUserId: session.discordUserId,
            displayName,
            guestTokenHash: null,
            createdAt: new Date(),
          })
          const created = await Participant.findOne(newId)
          if (!created) throw new HTTPException(500, { message: 'Internal Server Error' })
          return c.json({ participant: Participant.toResponse(created) }, 201)
        }

        // kind === 'guest'
        const cookieName = `${GUEST_COOKIE_PREFIX}${eventId}`
        const existingToken = getCookie(c, cookieName)
        if (existingToken) {
          const hash = await hashGuestToken(existingToken)
          const existing = await Participant.findMany({
            where: { eventId, guestTokenHash: hash },
            limit: 1,
          })
          if (existing.length > 0) {
            const updated = await Participant.update(existing[0]!.id, { displayName: body.displayName })
            return c.json({ participant: Participant.toResponse(updated ?? existing[0]!) }, 200)
          }
        }

        const token = generateGuestToken()
        const tokenHash = await hashGuestToken(token)
        const newId = crypto.randomUUID()
        const now = new Date()
        await app.db.insert(participants).values({
          id: newId,
          eventId,
          kind: 'guest',
          displayName: body.displayName,
          guestTokenHash: tokenHash,
          createdAt: now,
        })
        const created = await Participant.findOne(newId)
        if (!created) throw new HTTPException(500, { message: 'Internal Server Error' })
        setCookie(c, cookieName, token, {
          httpOnly: true,
          secure: isSecureRequest(c),
          sameSite: 'Lax',
          path: `/api/events/${eventId}`,
          maxAge: 34560000,
        })
        return c.json({ participant: Participant.toResponse(created) }, 201)
      },
    )
    .put(
      '/api/events/:id/votes',
      zValidator('json', putVotesBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        const eventId = c.req.param('id')
        const eventRow = await Event.findOne(eventId)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)

        if (eventRow.deadline && new Date() > eventRow.deadline) {
          return c.json({ error: 'Deadline passed' }, 403)
        }

        if (eventRow.status !== 'open') {
          return c.json({ error: 'Event is not open' }, 403)
        }

        const body = c.req.valid('json')
        const participantRow = await resolveParticipantByAnyAuth(c, eventId)

        if (!participantRow) {
          return c.json({ error: 'Unauthorized' }, 401)
        }

        // candidateId が全て当該イベントの候補か検証
        const incomingCandidateIds = body.votes.map((v) => v.candidateId)
        const eventCandidates = await Candidate.findMany({ where: { eventId }, limit: 1000 })
        const validCandidateIdSet = new Set(eventCandidates.map((c) => c.id))
        const invalid = incomingCandidateIds.find((id) => !validCandidateIdSet.has(id))
        if (invalid) {
          return c.json({ error: 'Invalid candidateId' }, 400)
        }

        const participantId = participantRow.id
        const now = new Date()
        const upsertStatements = body.votes.map((v) =>
          app.db
            .insert(votes)
            .values({
              id: crypto.randomUUID(),
              candidateId: v.candidateId,
              participantId,
              choice: v.choice,
              comment: v.comment ?? null,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [votes.candidateId, votes.participantId],
              set: { choice: v.choice, comment: v.comment ?? null, updatedAt: now },
            }),
        )

        await app.batch(upsertStatements as unknown as readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

        const voteRows = await Vote.findMany({ where: { participantId }, limit: 1000 })
        return c.json({ votes: Vote.toResponseMany(voteRows) }, 200)
      },
    )
    .get('/api/events/:id/votes/me', async (c) => {
      const eventId = c.req.param('id')
      const eventRow = await Event.findOne(eventId)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)

      const participantRow = await resolveParticipantByAnyAuth(c, eventId)

      if (!participantRow) {
        return c.json({ participant: null, votes: [] }, 200)
      }

      const voteRows = await Vote.findMany({ where: { participantId: participantRow.id }, limit: 1000 })
      return c.json({
        participant: Participant.toResponse(participantRow),
        votes: Vote.toResponseMany(voteRows),
      }, 200)
    })
    .get('/api/events/:id/tally', async (c) => {
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)

      const [candidateRows, participantRows] = await Promise.all([
        Candidate.findMany({ where: { eventId: id }, orderBy: { column: 'startAt', direction: 'asc' }, limit: 1000 }),
        Participant.findMany({ where: { eventId: id }, orderBy: { column: 'createdAt', direction: 'asc' }, limit: 1000 }),
      ])

      const candidateIds = candidateRows.map((r) => r.id)
      // nanoka の findMany が WHERE IN をサポートしないため drizzle 直クエリ
      const voteRows = await selectInChunks(candidateIds, (chunk) =>
        app.db.select().from(votes).where(inArray(votes.candidateId, chunk)),
      )

      const decisionRowsActive = (await app.db
        .select()
        .from(decisions)
        .where(and(eq(decisions.eventId, id), isNull(decisions.cancelledAt)))) as {
        candidateId: string
        decidedAt: Date
      }[]

      const SCORE: Record<string, number> = { yes: 2, maybe: 1, no: 0 }

      type VotesByParticipantId = Record<string, { choice: 'yes' | 'maybe' | 'no'; comment: string | null; updatedAt: string }>
      const votesByCandidateId = new Map<string, VotesByParticipantId>()
      for (const v of voteRows) {
        if (!votesByCandidateId.has(v.candidateId)) {
          votesByCandidateId.set(v.candidateId, {})
        }
        votesByCandidateId.get(v.candidateId)![v.participantId] = {
          choice: v.choice as 'yes' | 'maybe' | 'no',
          comment: v.comment ?? null,
          updatedAt: v.updatedAt.toISOString(),
        }
      }

      const tallyEvent = {
        id: eventRow.id,
        title: eventRow.title,
        status: eventRow.status,
        ...(eventRow.deadline ? { deadline: eventRow.deadline.toISOString() } : {}),
        timezone: eventRow.timezone,
        defaultDurationMinutes: eventRow.defaultDurationMinutes,
      }

      const tallyCandidates = candidateRows.map((cand) => {
        const byParticipant = votesByCandidateId.get(cand.id) ?? {}
        const counts = { yes: 0, maybe: 0, no: 0 }
        let totalScore = 0
        for (const v of Object.values(byParticipant)) {
          const choice = v.choice as 'yes' | 'maybe' | 'no'
          counts[choice]++
          totalScore += SCORE[choice] ?? 0
        }
        return {
          id: cand.id,
          startAt: cand.startAt.toISOString(),
          endAt: cand.endAt.toISOString(),
          totalScore,
          counts,
          votesByParticipantId: byParticipant,
        }
      })

      return c.json({
        event: tallyEvent,
        participants: Participant.toResponseMany(participantRows),
        candidates: tallyCandidates,
        decisions: decisionRowsActive
          .map((d) => ({ candidateId: d.candidateId, decidedAt: d.decidedAt.toISOString() }))
          .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
      })
    })
    .post(
      '/api/events/:id/decision',
      zValidator('json', createDecisionBody, (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
      }),
      async (c) => {
        const session = await requireSession(c, app, sessions, users)
        const eventId = c.req.param('id')
        const body = c.req.valid('json')
        const workerHost = new URL(c.req.url).host
        const result = await applyDecisions(
          { app, Event, Candidate, Decision, workerHost },
          { eventId, candidateIds: body.candidateIds, actorDiscordId: session.discordUserId },
        )
        c.executionCtx.waitUntil(
          notifyDecisionsChanged(
            { app, Decision, workerHost },
            c.env,
            {
              event: result.event,
              added: [...result.added, ...result.reactivated],
              cancelled: result.cancelled,
              participants: result.participants,
            },
          ),
        )
        const status = result.added.length + result.reactivated.length > 0 ? 201 : 200
        return c.json(
          {
            decisions: result.activeDecisions.map((d) => Decision.toResponse(d)),
            event: Event.toResponse(result.event),
          },
          status,
        )
      },
    )
    .delete('/api/events/:id/decision', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const eventId = c.req.param('id')
      const workerHost = new URL(c.req.url).host
      const result = await cancelAllDecisions(
        { app, Event, Candidate, Decision, workerHost },
        { eventId, actorDiscordId: session.discordUserId },
      )
      c.executionCtx.waitUntil(
        notifyDecisionsChanged(
          { app, Decision, workerHost },
          c.env,
          {
            event: result.event,
            added: [],
            cancelled: result.cancelled,
            participants: result.participants,
          },
        ),
      )
      return c.json(
        {
          decisions: result.activeDecisions.map((d) => Decision.toResponse(d)),
          event: Event.toResponse(result.event),
        },
        200,
      )
    })
    .get('/api/events/:id/permissions', async (c) => {
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)
      const s = await loadSession(c, app, sessions, users)
      if (!s) return c.json({ isOrganizer: false })
      const isOrganizer = eventRow.organizerDiscordId === s.discordUserId
      return c.json({ isOrganizer })
    })
    .get('/api/me/events', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const did = session.discordUserId

      const organized = await Event.findMany({
        where: { organizerDiscordId: did },
        orderBy: { column: 'createdAt', direction: 'desc' },
        limit: 200,
      })

      const myParticipants = await Participant.findMany({
        where: { discordUserId: did },
        limit: 500,
      })
      const participatedEventIds = [...new Set(myParticipants.map((p) => p.eventId))]

      let participating: typeof organized = []
      if (participatedEventIds.length > 0) {
        const rows = await selectInChunks(participatedEventIds, (chunk) =>
          app.db.select().from(events).where(inArray(events.id, chunk)),
        )
        participating = rows
          .filter((e) => e.organizerDiscordId !== did)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((e) => ({
            id: e.id,
            organizerDiscordId: e.organizerDiscordId,
            title: e.title,
            description: e.description ?? undefined,
            defaultDurationMinutes: e.defaultDurationMinutes,
            status: e.status,
            deadline: e.deadline ?? undefined,
            timezone: e.timezone,
            discordChannelId: e.discordChannelId ?? undefined,
            createdAt: e.createdAt,
          }))
      }

      return c.json({
        organized: Event.toResponseMany(organized),
        participating: Event.toResponseMany(participating),
      })
    })
    .get('/api/me/busy', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const excludeEventId = c.req.query('excludeEventId')
      const conditions = [
        eq(participants.discordUserId, session.discordUserId),
        isNull(decisions.cancelledAt),
      ]
      if (excludeEventId) conditions.push(ne(decisions.eventId, excludeEventId))
      const rows = await app.db
        .selectDistinct({ startAt: candidates.startAt })
        .from(decisions)
        .innerJoin(candidates, eq(candidates.id, decisions.candidateId))
        .innerJoin(participants, eq(participants.eventId, decisions.eventId))
        .where(and(...conditions))
      return c.json({
        startAts: rows.map((r) => r.startAt.toISOString()),
      })
    })
    .get('/api/me/subscriptions', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const rows = await CalendarSubscription.findMany({
        where: { ownerDiscordId: session.discordUserId },
        orderBy: { column: 'createdAt', direction: 'asc' },
        limit: 50,
      })
      const kept = rows.slice(0, 1)
      for (let i = 1; i < rows.length; i++) {
        await CalendarSubscription.delete(rows[i]!.id)
      }
      const host = new URL(c.req.url).host
      return c.json({
        subscriptions: kept.map((row) => ({
          id: row.id,
          ownerDiscordId: row.ownerDiscordId,
          scope: row.scope,
          createdAt: row.createdAt.toISOString(),
          lastAccessedAt: row.lastAccessedAt ? row.lastAccessedAt.toISOString() : null,
          webcalUrl: buildWebcalUrl(host, row.token),
        })),
      })
    })
    .post('/api/subscriptions', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const host = new URL(c.req.url).host
      const existing = await CalendarSubscription.findMany({
        where: { ownerDiscordId: session.discordUserId },
        orderBy: { column: 'createdAt', direction: 'asc' },
        limit: 50,
      })
      if (existing.length > 0) {
        const keep = existing[0]!
        for (let i = 1; i < existing.length; i++) {
          await CalendarSubscription.delete(existing[i]!.id)
        }
        const webcalUrl = buildWebcalUrl(host, keep.token)
        return c.json({ subscription: CalendarSubscription.toResponse(keep), webcalUrl }, 200)
      }
      const token = generateSubscriptionToken()
      const id = crypto.randomUUID()
      const createdAt = new Date()
      await app.db.insert(calendar_subscriptions).values({
        id, ownerDiscordId: session.discordUserId, token, scope: 'user-all', createdAt,
      })
      const row = await CalendarSubscription.findOne(id)
      if (!row) throw new HTTPException(500, { message: 'Subscription creation failed' })
      const webcalUrl = buildWebcalUrl(host, token)
      return c.json({ subscription: CalendarSubscription.toResponse(row), webcalUrl }, 201)
    })
    .delete('/api/subscriptions/:id', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const id = c.req.param('id')
      const row = await CalendarSubscription.findOne(id)
      if (!row || row.ownerDiscordId !== session.discordUserId) {
        return c.json({ error: 'Not Found' }, 404)
      }
      await CalendarSubscription.delete(id)
      return new Response(null, { status: 204 })
    })
    .post('/api/subscriptions/:id/regenerate', async (c) => {
      const session = await requireSession(c, app, sessions, users)
      const id = c.req.param('id')
      const row = await CalendarSubscription.findOne(id)
      if (!row || row.ownerDiscordId !== session.discordUserId) {
        return c.json({ error: 'Not Found' }, 404)
      }
      const newToken = generateSubscriptionToken()
      await CalendarSubscription.update(id, { token: newToken })
      const updated = await CalendarSubscription.findOne(id)
      if (!updated) throw new HTTPException(500, { message: 'Regenerate failed' })
      const webcalUrl = buildWebcalUrl(new URL(c.req.url).host, newToken)
      return c.json({ subscription: CalendarSubscription.toResponse(updated), webcalUrl })
    })
    .get('/api/events/:id/decision.ics', async (c) => {
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)

      // 取消済みも含めて出力（SEQUENCE+STATUS:CANCELLED が iCal クライアントに削除指示を伝える）
      const decisionRows = await app.db.select().from(decisions)
        .where(eq(decisions.eventId, id))
      if (decisionRows.length === 0) return c.json({ error: 'Not Found' }, 404)

      const candIds = [...new Set(decisionRows.map((d) => d.candidateId))]
      const candRows = await selectInChunks(candIds, (chunk) =>
        app.db.select().from(candidates).where(inArray(candidates.id, chunk)),
      )
      const candById = new Map(candRows.map((c) => [c.id, c]))

      const vevents: string[][] = []
      for (const d of decisionRows) {
        const cand = candById.get(d.candidateId)
        if (!cand) continue
        vevents.push(eventToVEvent({
          event: { id: eventRow.id, title: eventRow.title, description: eventRow.description },
          decision: {
            icsUid: d.icsUid,
            icsSequence: d.icsSequence,
            decidedAt: d.decidedAt,
            cancelledAt: d.cancelledAt,
          },
          candidate: { startAt: cand.startAt, endAt: cand.endAt },
        }))
      }

      const body = wrapInVCalendar(vevents)

      const safeTitle = eventRow.title
        .replace(/[^A-Za-z0-9_\-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 100)
      const filename = safeTitle && safeTitle.length > 0 ? `${safeTitle}.ics` : `event-${id}.ics`

      return c.body(body, 200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      })
    })
    .get('/feeds/:filename', async (c) => {
      const filename = c.req.param('filename')
      const match = filename.match(/^([0-9a-f]{64})\.ics$/)
      if (!match) return c.json({ error: 'Not Found' }, 404)
      const token = match[1]!

      const subs = await CalendarSubscription.findMany({ where: { token }, limit: 1 })
      if (subs.length === 0) return c.json({ error: 'Not Found' }, 404)
      const sub = subs[0]!

      const myParticipants = await app.db.select().from(participants)
        .where(eq(participants.discordUserId, sub.ownerDiscordId))
      const eventIds = [...new Set(myParticipants.map((p) => p.eventId))]

      const decisionRows = await selectInChunks(eventIds, (chunk) =>
        app.db.select().from(decisions)
          .where(and(inArray(decisions.eventId, chunk), isNull(decisions.cancelledAt))),
      )

      const vevents: string[][] = []
      for (const d of decisionRows) {
        const ev = await Event.findOne(d.eventId)
        const cand = await Candidate.findOne(d.candidateId)
        if (!ev || !cand) continue
        vevents.push(eventToVEvent({
          event: { id: ev.id, title: ev.title, description: ev.description },
          decision: {
            icsUid: d.icsUid,
            icsSequence: d.icsSequence,
            decidedAt: d.decidedAt,
            cancelledAt: d.cancelledAt,
          },
          candidate: { startAt: cand.startAt, endAt: cand.endAt },
        }))
      }

      const body = wrapInVCalendar(vevents)

      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
      const etag = `"${Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}"`

      c.executionCtx.waitUntil(CalendarSubscription.update(sub.id, { lastAccessedAt: new Date() }))

      if (c.req.header('If-None-Match') === etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Cache-Control': 'private, max-age=300' },
        })
      }

      return c.body(body, 200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        ETag: etag,
      })
    })
    .post('/api/discord/interactions', async (c) => {
      const publicKey = c.env.DISCORD_PUBLIC_KEY
      if (!publicKey) return c.json({ error: 'Discord not configured' }, 503)

      const cl = Number(c.req.header('content-length') ?? 0)
      if (cl > 64 * 1024) return c.json({ error: 'Payload too large' }, 413)

      const signature = c.req.header('X-Signature-Ed25519')
      const timestamp = c.req.header('X-Signature-Timestamp')
      if (!signature || !timestamp) return c.json({ error: 'Missing signature' }, 401)

      const ts = Number(timestamp)
      if (!Number.isFinite(ts)) return c.json({ error: 'Invalid timestamp' }, 401)
      const skewSec = Math.abs(Math.floor(Date.now() / 1000) - ts)
      if (skewSec > 5 * 60) return c.json({ error: 'Stale signature' }, 401)

      const rawBody = await c.req.text()
      const isValid = await verifyDiscordSignature(rawBody, signature, timestamp, publicKey)
      if (!isValid) return c.json({ error: 'Invalid signature' }, 401)

      const body = JSON.parse(rawBody) as {
        type: number
        member?: { user?: { id?: string } }
        user?: { id?: string }
        channel_id?: string
        channel?: { id?: string }
        data?: { custom_id?: string; name?: string; options?: Array<{ name?: string }> }
      }
      if (body.type === 1) return c.json({ type: 1 })
      if (body.type === 2) {
        const actorId = body.member?.user?.id ?? body.user?.id ?? null
        const channelId = body.channel?.id ?? body.channel_id ?? null
        const commandName = body.data?.name
        const subName = body.data?.options?.[0]?.name

        await AuditLog.create({
          actorDiscordId: actorId ?? undefined,
          action: 'discord.command.received',
          payload: { name: commandName, sub: subName, channelId },
        })

        if (commandName === 'hiyori' && subName === 'new') {
          const host = new URL(c.req.url).host
          // Discord はこのチャンネルでスラッシュコマンドが実行された事実を保証する（実行者は
          // チャンネルメンバーに限られる）。その事実を Hiyori 側で HMAC 署名して短命トークン化し、
          // クライアントから create event API へ提示させる。
          let path = '/events/new'
          if (channelId && c.env.DISCORD_CHANNEL_TOKEN_SECRET) {
            const channelToken = await signChannelToken(
              c.env.DISCORD_CHANNEL_TOKEN_SECRET,
              channelId,
            )
            path = `/events/new?channelToken=${encodeURIComponent(channelToken)}`
          }
          const createUrl = `https://${host}${path}`
          const returnTo = encodeURIComponent(path)
          const loginUrl = `https://${host}/api/auth/discord?returnTo=${returnTo}`

          return c.json({
            type: 4,
            data: {
              flags: 64,
              content: channelId
                ? `このチャンネルに連携した状態で日程調整を作成できます。\n${createUrl}\n\nHiyori にログインしていない場合: ${loginUrl}`
                : `日程調整を作成: ${createUrl}\n\nHiyori にログインしていない場合: ${loginUrl}`,
            },
          })
        }

        return c.json({
          type: 4,
          data: { flags: 64, content: '未対応のコマンドです' },
        })
      }
      if (body.type === 3) {
        await AuditLog.create({
          actorDiscordId: body.member?.user?.id ?? undefined,
          action: 'discord.interaction.received',
          payload: { type: 3, custom_id: body.data?.custom_id },
        })
        return c.json({ type: 6 })
      }
      return c.json({ type: 6 })
    })

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Not Found' }, 404)
    }
    if (c.req.method !== 'GET') {
      return c.json({ error: 'Not Found' }, 404)
    }
    return c.html(renderShell(c.req.url))
  })

  return routes
}

export type AppType = ReturnType<typeof buildApp>

export default {
  async fetch(req, env, ctx) {
    return buildApp(env).fetch(req, env, ctx)
  },
} satisfies ExportedHandler<Env>
