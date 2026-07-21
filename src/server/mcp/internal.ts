// 既存 Hono アプリ（/api/*）を「同一 Worker 内で」内部呼び出しするためのブリッジ。
//
// MCP ツールはこの internalApi を通して既存 API を Bearer で叩く。これにより
// isOrganizer 判定・zod バリデーション・締切/公開チェック・レート制限といった
// サーバー側の認可ロジックを一切二重実装しない（CLI が Bearer で叩くのと同じ経路）。
//
// buildApp(env) は index.tsx がリクエストごとに Hono アプリを構築するのと同じもの。
// ネットワークホップを挟まず in-process で app.fetch する。

import { buildApp } from '../index'
import type { Env } from '../index'

// 内部呼び出しでは実ネットワークに出ないが、一部ハンドラが new URL(c.req.url) で
// host を参照する（ics のファイル名生成など）ため、有効な絶対 URL を与える。
const INTERNAL_ORIGIN = 'http://mcp.internal'

// c.executionCtx.waitUntil を使うハンドラ（decision の Discord 通知など）向けの
// 最小 ExecutionContext。MCP 発イベントは Discord チャンネル未連携なので通知は実質 no-op。
function stubExecutionCtx(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      // fire-and-forget。失敗しても内部呼び出し全体は落とさない。
      void Promise.resolve(promise).catch(() => {})
    },
    passThroughOnException() {},
    props: undefined,
  } as unknown as ExecutionContext
}

export interface InternalResponse {
  ok: boolean
  status: number
  // JSON ボディ（パースできなければ null）
  data: unknown
  // 生テキスト（text/calendar など JSON でない応答向け）
  text: string
}

export async function internalApi(
  env: Env,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<InternalResponse> {
  const app = buildApp(env)
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  const init: RequestInit = { method }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  init.headers = headers

  const request = new Request(`${INTERNAL_ORIGIN}${path}`, init)
  const res = await app.fetch(request, env, stubExecutionCtx())
  const text = await res.text()
  let data: unknown = null
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  return { ok: res.ok, status: res.status, data, text }
}
