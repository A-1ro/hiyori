// Hiyori MCP エージェント（Agents SDK McpAgent / Durable Object）。
//
// Phase 0: whoami の 1 ツール + 足場。
// Phase 1: コア 8 ツール（list_events / get_event / tally / create_event / vote /
//          get_my_votes / confirm / get_ics）。
//
// 全ツールは internalApi 経由で既存 /api/* を Bearer で叩き、権限判定・バリデーション・
// レート制限をサーバー側に委ねる（二重実装しない）。認証は案 B（Bearer パススルー）。
// props（McpProps）に本人情報と内部呼び出し用 apiToken が入る。案 A への差し替えは
// handler.ts / props の組み立てだけで済み、本ファイルのツール実装は無改造。

import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { internalApi, type InternalResponse } from './internal'
import type { McpProps, McpScope } from './types'
import type { Env } from '../index'

const SERVER_NAME = 'hiyori'
const SERVER_VERSION = '0.1.0'

function textResult(payload: unknown): CallToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// 内部 API エラーを MCP ツールエラーへ整形。
function apiError(res: InternalResponse): CallToolResult {
  const body = res.data as { error?: string } | null
  const detail = body?.error ?? res.text ?? 'request failed'
  return errorResult(`Hiyori API error (${res.status}): ${detail}`)
}

export class HiyoriMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  // ---- 内部ヘルパ ---------------------------------------------------------

  private requireProps(): McpProps {
    if (!this.props) throw new Error('MCP auth context is missing (props not set)')
    return this.props
  }

  private hasScope(scope: McpScope): boolean {
    return this.props?.scopes?.includes(scope) ?? false
  }

  // スコープ不足なら CallToolResult(error) を返す。満たしていれば null。
  private scopeGuard(scope: McpScope): CallToolResult | null {
    if (!this.hasScope(scope)) {
      return errorResult(`Insufficient scope: this operation requires "${scope}".`)
    }
    return null
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<InternalResponse> {
    const props = this.requireProps()
    return internalApi(this.env, props.apiToken, method, path, body)
  }

  // ---- ツール登録 ---------------------------------------------------------

  async init(): Promise<void> {
    this.registerWhoami()
    this.registerListEvents()
    this.registerGetEvent()
    this.registerTally()
    this.registerCreateEvent()
    this.registerVote()
    this.registerGetMyVotes()
    this.registerConfirm()
    this.registerGetIcs()
  }

  // --- 認証 / プロフィール ---

  private registerWhoami() {
    this.server.registerTool(
      'hiyori_whoami',
      {
        description:
          '現在 Hiyori に接続している Discord ユーザー（あなた）の情報を返す。認証確認に使う。',
        inputSchema: {},
        annotations: { title: 'Who am I', readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', '/api/auth/me')
        if (!res.ok) return apiError(res)
        const body = res.data as { user: unknown } | null
        if (!body?.user) return errorResult('Not authenticated.')
        return textResult(body.user)
      },
    )
  }

  // --- イベント read ---

  private registerListEvents() {
    this.server.registerTool(
      'hiyori_list_events',
      {
        description:
          'あなたが主催 / 参加しているイベント一覧を返す（{ organized[], participating[] }）。',
        inputSchema: {},
        annotations: { title: 'List events', readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', '/api/me/events')
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerGetEvent() {
    this.server.registerTool(
      'hiyori_get_event',
      {
        description:
          'イベント 1 件の詳細（イベント情報 + 候補日時 + あなたが主催者か）を返す。公開読み取り。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: { title: 'Get event', readOnlyHint: true, openWorldHint: false },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', `/api/events/${encodeURIComponent(eventId)}`)
        if (!res.ok) return apiError(res)
        const perm = await this.call(
          'GET',
          `/api/events/${encodeURIComponent(eventId)}/permissions`,
        )
        const isOrganizer =
          perm.ok && (perm.data as { isOrganizer?: boolean } | null)?.isOrganizer === true
        const body = res.data as Record<string, unknown>
        return textResult({ ...body, isOrganizer })
      },
    )
  }

  private registerTally() {
    this.server.registerTool(
      'hiyori_tally',
      {
        description:
          '投票の集計（候補ごとの yes/maybe/no と参加者ごとの○△×表、確定状況）を返す。公開読み取り。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: { title: 'Tally votes', readOnlyHint: true, openWorldHint: false },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', `/api/events/${encodeURIComponent(eventId)}/tally`)
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerGetMyVotes() {
    this.server.registerTool(
      'hiyori_get_my_votes',
      {
        description: '指定イベントでのあなた自身の投票（候補ごとの yes/maybe/no）を返す。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: { title: 'Get my votes', readOnlyHint: true, openWorldHint: false },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', `/api/events/${encodeURIComponent(eventId)}/votes/me`)
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerGetIcs() {
    this.server.registerTool(
      'hiyori_get_ics',
      {
        description:
          '確定済みイベントの .ics（iCalendar）本文をテキストで返す。未確定なら 404 エラー。公開読み取り。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: { title: 'Get .ics', readOnlyHint: true, openWorldHint: false },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call(
          'GET',
          `/api/events/${encodeURIComponent(eventId)}/decision.ics`,
        )
        if (!res.ok) return apiError(res)
        return textResult(res.text)
      },
    )
  }

  // --- イベント write ---

  private registerCreateEvent() {
    this.server.registerTool(
      'hiyori_create_event',
      {
        description:
          '日程調整イベントを新規作成する（作成者=主催者）。候補日時を 1 件以上指定する。共有 URL を返す。',
        inputSchema: {
          title: z.string().min(1).max(200).describe('イベント名'),
          defaultDurationMinutes: z
            .number()
            .int()
            .min(1)
            .max(60 * 24)
            .describe('各候補のデフォルト所要（分）。endAt 省略時に使う'),
          candidates: z
            .array(
              z.object({
                startAt: z.string().datetime().describe('候補開始（ISO8601, 例 2026-08-01T18:00:00Z）'),
                endAt: z.string().datetime().optional().describe('候補終了（ISO8601, 省略可）'),
              }),
            )
            .min(1)
            .max(365)
            .describe('候補日時スロット'),
          description: z.string().max(2000).optional().describe('説明（任意）'),
          deadline: z.string().datetime().optional().describe('投票締切（ISO8601, 任意）'),
          timezone: z.string().max(64).optional().describe('表示タイムゾーン（IANA, 任意）'),
        },
        annotations: {
          title: 'Create event',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('POST', '/api/events', input)
        if (!res.ok) return apiError(res)
        const body = res.data as { event?: { id?: string } } | null
        const eventId = body?.event?.id
        return textResult({
          ...(body ?? {}),
          shareHint: eventId ? `イベント ID: ${eventId}（共有 URL は /events/${eventId}）` : undefined,
        })
      },
    )
  }

  private registerVote() {
    this.server.registerTool(
      'hiyori_vote',
      {
        description:
          '指定イベントにあなた自身として投票する（未参加なら自動で参加登録）。各候補に yes/maybe/no を付ける。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          displayName: z
            .string()
            .min(1)
            .max(80)
            .optional()
            .describe('参加者表示名（省略時はあなたの Discord 表示名）'),
          votes: z
            .array(
              z.object({
                candidateId: z.string().min(1).describe('候補 ID'),
                choice: z.enum(['yes', 'maybe', 'no']).describe('○=yes / △=maybe / ×=no'),
                comment: z.string().max(500).optional().describe('コメント（任意）'),
              }),
            )
            .min(1)
            .max(365)
            .describe('候補ごとの投票'),
        },
        annotations: {
          title: 'Vote',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ eventId, displayName, votes }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const props = this.requireProps()
        // 参加者として自己登録（既存なら displayName 更新のみ・冪等）。
        const reg = await this.call(
          'POST',
          `/api/events/${encodeURIComponent(eventId)}/participants`,
          { kind: 'discord', displayName: displayName ?? props.displayName },
        )
        if (!reg.ok) return apiError(reg)
        const res = await this.call('PUT', `/api/events/${encodeURIComponent(eventId)}/votes`, {
          votes,
        })
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerConfirm() {
    this.server.registerTool(
      'hiyori_confirm',
      {
        description:
          '主催者としてイベントの開催日を確定する（候補 ID を 1 件以上指定）。確定すると .ics 配布が有効になる。主催者のみ。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          candidateIds: z
            .array(z.string().min(1))
            .min(1)
            .max(50)
            .describe('確定する候補 ID（複数可）'),
        },
        annotations: {
          title: 'Confirm date',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ eventId, candidateIds }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'POST',
          `/api/events/${encodeURIComponent(eventId)}/decision`,
          { candidateIds },
        )
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }
}
