/** @jsxImportSource hono/jsx */
import { d1Adapter, nanoka } from '@nanokajs/core'
import { eq, inArray } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

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
