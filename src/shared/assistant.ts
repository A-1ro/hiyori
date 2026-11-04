export const ASSISTANT_MODEL = '@cf/qwen/qwen3.8-27b'

export interface AssistantStep {
  tool: string
  label: string
  status: 'done' | 'error'
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps?: AssistantStep[]
  eventId?: string
}

export interface AssistantAction {
  id: string
  tool: string
  label: string
  arguments: Record<string, unknown>
  expiresAt: number
  context?: { title: string; candidates: Array<{ id: string; startAt: string; endAt: string }> }
}

export interface AssistantState {
  messages: AssistantMessage[]
  pending: AssistantAction | null
  busy: boolean
  // Returned once to the caller of an approved action; never stored in history
  // or sent to the model (calendar subscription results can contain secret URLs).
  result?: unknown
}

export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  hiyori_whoami: 'アカウントを確認',
  hiyori_list_events: 'イベントを確認',
  hiyori_get_event: 'イベントの詳細を確認',
  hiyori_tally: '回答を集計',
  hiyori_get_my_votes: '自分の回答を確認',
  hiyori_get_ics: 'カレンダー用データを取得',
  hiyori_my_busy: '自分の予定を確認',
  hiyori_list_invites: '招待を確認',
  hiyori_list_subscriptions: 'カレンダー購読を確認',
  hiyori_create_event: 'イベントを作成',
  hiyori_edit_event: 'イベントを編集',
  hiyori_delete_event: 'イベントを削除',
  hiyori_vote: '候補日に回答',
  hiyori_confirm: '開催日を確定',
  hiyori_unconfirm: '開催日の確定を解除',
  hiyori_add_candidate: '候補日時を追加',
  hiyori_remove_candidate: '候補日時を削除',
  hiyori_add_invite: '招待を追加',
  hiyori_revoke_invite: '招待を取り消し',
  hiyori_add_subscription: 'カレンダー購読を作成',
  hiyori_remove_subscription: 'カレンダー購読を削除',
  hiyori_regen_subscription: 'カレンダー購読URLを再生成',
}

// Fail closed: annotations alone never authorize an automatically executed tool.
export const ASSISTANT_READ_TOOLS = new Set([
  'hiyori_whoami', 'hiyori_list_events', 'hiyori_get_event', 'hiyori_tally',
  'hiyori_get_my_votes', 'hiyori_get_ics', 'hiyori_my_busy',
  'hiyori_list_invites', 'hiyori_list_subscriptions',
])
