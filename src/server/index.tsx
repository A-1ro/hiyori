/** @jsxImportSource hono/jsx */
import { d1Adapter, nanoka } from '@nanokajs/core'
import type { RowType } from '@nanokajs/core'
import type { BatchItem } from 'drizzle-orm/batch'
import { eq, inArray, and, isNull } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import type { Context } from 'hono'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { applyDecision, cancelDecision } from './services/decision'
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
import { candidates, decisions, events, participants, votes } from '../../drizzle/schema'

export interface Env {
  DB: D1Database
  ENVIRONMENT: string
}

const createEventBody = z.object({
  organizerDiscordId: z.string().regex(/^\d{17,20}$/),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  defaultDurationMinutes: z.number().int().min(1).max(60 * 24),
  deadline: z.string().datetime().optional(),
  timezone: z.string().max(64).optional(),
  discordChannelId: z.string().regex(/^\d{17,20}$/).optional(),
  candidates: z
    .array(
      z.object({
        startAt: z.string().datetime(),
        endAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(50),
})

const patchEventBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  deadline: z.string().datetime().optional().nullable(),
  defaultDurationMinutes: z.number().int().min(1).max(60 * 24).optional(),
  timezone: z.string().max(64).optional(),
  discordChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
})

const addCandidateBody = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
})

const GUEST_COOKIE_PREFIX = 'hiyori_guest_'

function generateGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashGuestToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const registerParticipantBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('guest'),
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('discord'),
    displayName: z.string().min(1).max(80),
    // TODO(F-06): discordUserId はセッションから取得する
    discordUserId: z.string().regex(/^\d{17,20}$/),
  }),
])

const createDecisionBody = z.object({
  candidateId: z.string().uuid(),
  actorDiscordId: z.string().regex(/^\d{17,20}$/), // TODO(F-06): セッション化
})

const deleteDecisionBody = z.object({
  actorDiscordId: z.string().regex(/^\d{17,20}$/), // TODO(F-06): セッション化
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
    .max(50),
})

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
  app.model(calendarSubscriptionTableName, calendarSubscriptionFields)
  app.model(auditLogTableName, auditLogFields)

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
    const isDev = c.env.ENVIRONMENT !== 'production'
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

  const renderShell = () => (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hiyori</title>
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

  const routes = app
    .get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))
    .post(
      '/api/events',
      zValidator('json', createEventBody, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        }
      }),
      async (c) => {
        // TODO(F-06): organizerDiscordId はセッションから取得する
        const body = c.req.valid('json')

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

        await app.batch([
          app.db.insert(events).values({
            id: eventId,
            organizerDiscordId: body.organizerDiscordId,
            title: body.title,
            description: body.description ?? null,
            defaultDurationMinutes: body.defaultDurationMinutes,
            status: 'open',
            deadline: body.deadline ? new Date(body.deadline) : null,
            timezone: body.timezone ?? 'UTC',
            discordChannelId: body.discordChannelId ?? null,
            createdAt: eventCreatedAt,
          }),
          app.db.insert(candidates).values(candidateValues),
        ])

        const eventRow = await Event.findOne(eventId)
        if (!eventRow) throw new HTTPException(500, { message: 'Internal Server Error' })
        const candidateRows = await Candidate.findMany({ where: { eventId }, limit: 1000 })

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
        // TODO(F-06): organizer 以外は 403
        const id = c.req.param('id')
        const eventRow = await Event.findOne(id)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)

        const body = c.req.valid('json')
        const updateData: Partial<typeof eventRow> = {}
        if (body.title !== undefined) updateData.title = body.title
        if (body.description !== undefined) updateData.description = body.description
        if (body.deadline !== undefined) updateData.deadline = body.deadline ? new Date(body.deadline) : undefined
        if (body.defaultDurationMinutes !== undefined) updateData.defaultDurationMinutes = body.defaultDurationMinutes
        if (body.timezone !== undefined) updateData.timezone = body.timezone
        if (body.discordChannelId !== undefined) updateData.discordChannelId = body.discordChannelId ?? undefined

        const updated = await Event.update(id, updateData)
        if (!updated) return c.json({ error: 'Not Found' }, 404)

        return c.json({ event: Event.toResponse(updated) })
      },
    )
    .delete('/api/events/:id', async (c) => {
      // TODO(F-06): organizer 以外は 403
      const id = c.req.param('id')
      const eventRow = await Event.findOne(id)
      if (!eventRow) return c.json({ error: 'Not Found' }, 404)

      const candidateRows = await Candidate.findMany({ where: { eventId: id }, limit: 10000 })
      const candidateIds = candidateRows.map((r) => r.id)

      // votes → decisions → participants → candidates → events の順で D1 batch により atomic に削除
      await app.batch([
        app.db.delete(votes).where(inArray(votes.candidateId, candidateIds)),
        app.db.delete(decisions).where(eq(decisions.eventId, id)),
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
        const id = c.req.param('id')
        const eventRow = await Event.findOne(id)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)

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
      const eventId = c.req.param('id')
      const candidateId = c.req.param('candidateId')

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
          // TODO(F-06): Discord セッション経由で participant を作成する
          return c.json({ error: 'Discord participants require F-06 OAuth, not yet implemented' }, 501)
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
          secure: true,
          sameSite: 'Lax',
          path: '/',
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

        // TODO(F-06): Discord 参加者の認証は Cookie ベースに置き換える
        const body = c.req.valid('json')
        const participantRow = await resolveParticipantByCookie(c, eventId)

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

      // TODO(F-06): Discord 参加者の解決はセッションが入るまでサポートしない
      const participantRow = await resolveParticipantByCookie(c, eventId)

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
      const voteRows = candidateIds.length > 0
        ? await app.db.select().from(votes).where(inArray(votes.candidateId, candidateIds))
        : []

      let decisionRow: { candidateId: string; decidedAt: Date } | null = null
      {
        const decisionRows = await app.db
          .select()
          .from(decisions)
          .where(and(eq(decisions.eventId, id), isNull(decisions.cancelledAt)))
          .limit(1) as { candidateId: string; decidedAt: Date }[]
        if (decisionRows.length > 0) {
          decisionRow = { candidateId: decisionRows[0]!.candidateId, decidedAt: decisionRows[0]!.decidedAt }
        }
      }

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
        decision: decisionRow
          ? { candidateId: decisionRow.candidateId, decidedAt: decisionRow.decidedAt.toISOString() }
          : null,
      })
    })
    .post(
      '/api/events/:id/decision',
      zValidator('json', createDecisionBody, (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
      }),
      async (c) => {
        const eventId = c.req.param('id')
        const body = c.req.valid('json')
        const workerHost = new URL(c.req.url).host
        const result = await applyDecision(
          { app, Event, Candidate, Decision, workerHost },
          { eventId, candidateId: body.candidateId, actorDiscordId: body.actorDiscordId },
        )
        return c.json(
          { decision: Decision.toResponse(result.decision), event: Event.toResponse(result.event) },
          result.kind === 'created' ? 201 : 200,
        )
      },
    )
    .delete(
      '/api/events/:id/decision',
      zValidator('json', deleteDecisionBody, (result, c) => {
        if (!result.success) return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
      }),
      async (c) => {
        const eventId = c.req.param('id')
        const body = c.req.valid('json')
        const result = await cancelDecision(
          { app, Event, Candidate, Decision, workerHost: new URL(c.req.url).host },
          { eventId, actorDiscordId: body.actorDiscordId },
        )
        return c.json({ decision: Decision.toResponse(result.decision), event: Event.toResponse(result.event) }, 200)
      },
    )
    .get(
      '/api/events/:id/permissions',
      zValidator(
        'query',
        z.object({ actorDiscordId: z.string().regex(/^\d{17,20}$/) }),
        (result, c) => {
          if (!result.success)
            return c.json({ error: 'Invalid request', issues: result.error.issues }, 400)
        },
      ),
      async (c) => {
        const id = c.req.param('id')
        const { actorDiscordId } = c.req.valid('query')
        const eventRow = await Event.findOne(id)
        if (!eventRow) return c.json({ error: 'Not Found' }, 404)
        const isOrganizer = eventRow.organizerDiscordId === actorDiscordId
        return c.json({ isOrganizer })
      },
    )

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Not Found' }, 404)
    }
    if (c.req.method !== 'GET') {
      return c.json({ error: 'Not Found' }, 404)
    }
    return c.html(renderShell())
  })

  return routes
}

export type AppType = ReturnType<typeof buildApp>

export default {
  async fetch(req, env, ctx) {
    return buildApp(env).fetch(req, env, ctx)
  },
} satisfies ExportedHandler<Env>
