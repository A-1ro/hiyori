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
    // Phase 0/1: whoami + コア 8 ツール
    this.registerWhoami()
    this.registerListEvents()
    this.registerGetEvent()
    this.registerTally()
    this.registerCreateEvent()
    this.registerVote()
    this.registerGetMyVotes()
    this.registerConfirm()
    this.registerGetIcs()
    // Phase 2: 残りツール（フル同等）
    this.registerEditEvent()
    this.registerListInvites()
    this.registerAddInvite()
    this.registerRevokeInvite()
    this.registerDeleteEvent()
    this.registerAddCandidate()
    this.registerRemoveCandidate()
    this.registerUnconfirm()
    this.registerMyBusy()
    this.registerListSubscriptions()
    this.registerAddSubscription()
    this.registerRemoveSubscription()
    this.registerRegenSubscription()
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
          'イベント 1 件の詳細（イベント情報 + 候補日時 + あなたが主催者か）を返す。公開イベントまたは本人が許可されたイベントのみ。',
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
          '投票の集計（候補ごとの yes/maybe/no と参加者ごとの○△×表、確定状況）を返す。公開イベントまたは本人が許可されたイベントのみ。',
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
          '確定済みイベントの .ics（iCalendar）本文をテキストで返す。未確定なら 404 エラー。公開イベントまたは本人が許可されたイベントのみ。',
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
          '日程調整イベントを新規作成する（作成者=主催者）。候補日時を 1 件以上指定する。招待限定なら Discord ユーザー名の初期招待も同時に保存できる。共有 URL を返す。',
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
          visibility: z.enum(['public', 'invite_only']).optional().describe('公開範囲。省略時は public。初期招待を指定する場合は invite_only が必須。'),
          invitedDiscordUsernames: z.array(z.string().max(128)).max(500).optional().describe('初期招待の Discord ユーザー名（表示名・数値 ID ではない）。@ 接頭辞は任意。数字だけの名前もユーザー名として扱う。ログイン済みの相手は通常の閲覧で現在の Discord ユーザー名を確認し、受取りが確定する。再ログインは不要。最大 500 件。'),
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

  private registerEditEvent() {
    this.server.registerTool(
      'hiyori_edit_event',
      {
        description:
          'イベントの基本情報（タイトル・説明・締切・所要時間・タイムゾーン・公開範囲）を編集する。主催者のみ。締切を解除するには deadline に null を渡す。招待の追加・取消は専用ツールを使う。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          title: z.string().min(1).max(200).optional().describe('イベント名'),
          description: z.string().max(2000).optional().describe('説明'),
          visibility: z.enum(['public', 'invite_only']).optional().describe('公開範囲。public にすると招待のない人も閲覧・回答できる。省略時は変更しない。'),
          deadline: z
            .string()
            .datetime()
            .nullable()
            .optional()
            .describe('投票締切（ISO8601）。null で締切なしに解除'),
          defaultDurationMinutes: z
            .number()
            .int()
            .min(1)
            .max(60 * 24)
            .optional()
            .describe('各候補のデフォルト所要（分）'),
          timezone: z.string().max(64).optional().describe('表示タイムゾーン（IANA）'),
        },
        annotations: {
          title: 'Edit event',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ eventId, ...patch }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('PATCH', `/api/events/${encodeURIComponent(eventId)}`, patch)
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerListInvites() {
    this.server.registerTool(
      'hiyori_list_invites',
      {
        description:
          '主催するイベントの招待一覧を返す（主催者のみ）。未確定・受取り済みを含み、取消には各招待の id を使う。Discord アカウントの検索や Hiyori 登録有無の確認は行わない。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: { title: 'List invitations', readOnlyHint: true, openWorldHint: false },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', `/api/events/${encodeURIComponent(eventId)}/invites`)
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerAddInvite() {
    this.server.registerTool(
      'hiyori_add_invite',
      {
        description:
          '主催するイベントに Discord ユーザー名で招待を追加する。相手の登録有無を調べず未確定招待を保存する。ログイン済みの相手が閲覧すると現在の Discord ユーザー名を確認し、一度だけ固定 ID に紐付ける。再ログインは不要。照合の一時失敗時はログインしたまま時間をおいて再試行する。初回照合時にその名前を持つアカウントが対象なので、入力間違い・改名に注意する。全招待の合計は最大 500 件。公開イベントでは招待しても閲覧は制限されない。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          discordUsername: z.string().max(128).describe('Discord ユーザー名（表示名・数値 ID ではない）。@ 接頭辞は任意。数字だけの名前もユーザー名として扱う。'),
        },
        annotations: {
          title: 'Add invitation',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ eventId, discordUsername }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('POST', `/api/events/${encodeURIComponent(eventId)}/invites`, { discordUsername })
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerRevokeInvite() {
    this.server.registerTool(
      'hiyori_revoke_invite',
      {
        description:
          '主催するイベントの招待を取り消す。hiyori_list_invites が返した招待レコードの id を指定する（ユーザー名や Discord ユーザー ID ではない）。受取り済みの場合は同じアカウントへの他の招待も取り消す。公開イベントの閲覧は制限されない。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          inviteId: z.string().uuid().describe('招待一覧が返した招待レコードの id（UUID）'),
        },
        annotations: {
          title: 'Revoke invitation',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ eventId, inviteId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('DELETE', `/api/events/${encodeURIComponent(eventId)}/invites/${encodeURIComponent(inviteId)}`)
        if (!res.ok) return apiError(res)
        return textResult({ ok: true, eventId, inviteId })
      },
    )
  }

  private registerDeleteEvent() {
    this.server.registerTool(
      'hiyori_delete_event',
      {
        description:
          'イベントを完全に削除する（候補・投票・参加者・確定も一括削除）。主催者のみ。取り消せない破壊的操作。',
        inputSchema: { eventId: z.string().min(1).describe('削除するイベント ID') },
        annotations: {
          title: 'Delete event',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('DELETE', `/api/events/${encodeURIComponent(eventId)}`)
        if (!res.ok) return apiError(res)
        return textResult({ ok: true, eventId })
      },
    )
  }

  private registerAddCandidate() {
    this.server.registerTool(
      'hiyori_add_candidate',
      {
        description:
          '既存イベントに候補日時（スロット）を 1 件追加する。主催者のみ。endAt 省略時はイベントの既定所要から算出する。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          startAt: z.string().datetime().describe('候補開始（ISO8601）'),
          endAt: z.string().datetime().optional().describe('候補終了（ISO8601, 省略可）'),
        },
        annotations: {
          title: 'Add candidate',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ eventId, startAt, endAt }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'POST',
          `/api/events/${encodeURIComponent(eventId)}/candidates`,
          endAt ? { startAt, endAt } : { startAt },
        )
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerRemoveCandidate() {
    this.server.registerTool(
      'hiyori_remove_candidate',
      {
        description:
          '候補日時（スロット）を 1 件削除する（その候補への投票も削除）。主催者のみ。取り消せない破壊的操作。',
        inputSchema: {
          eventId: z.string().min(1).describe('イベント ID'),
          candidateId: z.string().min(1).describe('削除する候補 ID'),
        },
        annotations: {
          title: 'Remove candidate',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ eventId, candidateId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'DELETE',
          `/api/events/${encodeURIComponent(eventId)}/candidates/${encodeURIComponent(candidateId)}`,
        )
        if (!res.ok) return apiError(res)
        return textResult({ ok: true, eventId, candidateId })
      },
    )
  }

  private registerUnconfirm() {
    this.server.registerTool(
      'hiyori_unconfirm',
      {
        description:
          '確定済みの開催日をすべて取り消す（未確定状態に戻す）。主催者のみ。.ics 配布は無効になる。',
        inputSchema: { eventId: z.string().min(1).describe('イベント ID') },
        annotations: {
          title: 'Unconfirm date',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ eventId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'DELETE',
          `/api/events/${encodeURIComponent(eventId)}/decision`,
        )
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerMyBusy() {
    this.server.registerTool(
      'hiyori_my_busy',
      {
        description:
          'あなたが参加中で確定済みの予定（開始日時の一覧）を返す。他イベントの日程調整で「埋まっている日」を避けるのに使う。',
        inputSchema: {},
        annotations: { title: 'My busy times', readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', '/api/me/busy')
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerListSubscriptions() {
    this.server.registerTool(
      'hiyori_list_subscriptions',
      {
        description:
          'あなたのカレンダー購読（webcal 配信）の一覧を返す。URL はセキュリティ上、発行 / 再生成時にのみ表示される。',
        inputSchema: {},
        annotations: { title: 'List subscriptions', readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const guard = this.scopeGuard('hiyori:read')
        if (guard) return guard
        const res = await this.call('GET', '/api/me/subscriptions')
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerAddSubscription() {
    this.server.registerTool(
      'hiyori_add_subscription',
      {
        description:
          'あなたの確定予定をまとめて配信するカレンダー購読（webcal URL）を発行する。Apple カレンダー等に登録できる。',
        inputSchema: {},
        annotations: {
          title: 'Add subscription',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async () => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call('POST', '/api/subscriptions')
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }

  private registerRemoveSubscription() {
    this.server.registerTool(
      'hiyori_remove_subscription',
      {
        description:
          'カレンダー購読を削除する（本人の購読のみ）。既存の webcal URL は無効になる。取り消せない破壊的操作。',
        inputSchema: { subscriptionId: z.string().min(1).describe('購読 ID') },
        annotations: {
          title: 'Remove subscription',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ subscriptionId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'DELETE',
          `/api/subscriptions/${encodeURIComponent(subscriptionId)}`,
        )
        if (!res.ok) return apiError(res)
        return textResult({ ok: true, subscriptionId })
      },
    )
  }

  private registerRegenSubscription() {
    this.server.registerTool(
      'hiyori_regen_subscription',
      {
        description:
          'カレンダー購読のトークンを再生成する（本人の購読のみ）。旧 URL は無効になり、新しい webcal URL を返す。',
        inputSchema: { subscriptionId: z.string().min(1).describe('購読 ID') },
        annotations: {
          title: 'Regenerate subscription',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ subscriptionId }) => {
        const guard = this.scopeGuard('hiyori:write')
        if (guard) return guard
        const res = await this.call(
          'POST',
          `/api/subscriptions/${encodeURIComponent(subscriptionId)}/regenerate`,
        )
        if (!res.ok) return apiError(res)
        return textResult(res.data)
      },
    )
  }
}
