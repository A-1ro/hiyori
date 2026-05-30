/** @jsxImportSource hono/jsx */
import { d1Adapter, nanoka } from '@nanokajs/core'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

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

export interface Env {
  DB: D1Database
  ENVIRONMENT: string
}

const buildApp = (env: Env) => {
  const app = nanoka<{ Bindings: Env }>(d1Adapter(env.DB))

  // モデル登録（API ルート実装時に Model wrapper が必要になるが、現状は登録のみ）
  app.model(eventTableName, eventFields)
  app.model(candidateTableName, candidateFields)
  app.model(participantTableName, participantFields)
  app.model(voteTableName, voteFields)
  app.model(decisionTableName, decisionFields)
  app.model(calendarSubscriptionTableName, calendarSubscriptionFields)
  app.model(auditLogTableName, auditLogFields)

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

  const routes = app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

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
