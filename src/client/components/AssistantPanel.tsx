import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, clearAssistantHistory, fetchAssistantHistory, resolveAssistantAction, sendAssistantMessage, type EventResponse } from '../api/client'
import type { AssistantAction, AssistantState } from '../../shared/assistant'
import { ConfirmDialog, Icon } from './primitives'
import mascot from '../assets/images/hiyorichan.png'
import './assistant.css'

const FIELD_LABELS: Record<string, string> = {
  title: 'イベント名', description: '説明', defaultDurationMinutes: '所要時間（分）',
  visibility: '公開範囲', deadline: '回答締切', timezone: 'タイムゾーン',
  candidates: '候補日時', candidateIds: '開催日時', candidateId: '候補日時',
  eventId: 'イベント', votes: '回答', choice: '回答', comment: 'コメント',
  invitedDiscordUsernames: '招待するユーザー名', discordUsernames: '招待するユーザー名',
  discordUsername: 'Discordユーザー名', inviteId: '取り消す招待', subscriptionId: 'カレンダー購読',
  startAt: '開始', endAt: '終了', name: '名前',
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

function actionValue(action: AssistantAction, key: string, value: unknown): string {
  if (key === 'eventId' && action.context) return action.context.title
  if ((key === 'candidateId' || key === 'candidateIds') && action.context) {
    const ids = Array.isArray(value) ? value : [value]
    return ids.map(id => {
      const candidate = action.context!.candidates.find(candidate => candidate.id === id)
      return candidate ? `${formatDate(candidate.startAt)} – ${formatDate(candidate.endAt)}` : String(id)
    }).join('\n')
  }
  if (key === 'visibility') return value === 'invite_only' ? '招待限定' : '公開'
  if (['startAt', 'endAt', 'deadline'].includes(key) && typeof value === 'string') return formatDate(value)
  if (key === 'choice') return ({ yes: '○', maybe: '△', no: '×' })[String(value)] ?? String(value)
  if (Array.isArray(value)) return value.map(item => actionValue(action, key === 'candidateIds' ? 'candidateId' : '', item)).join('\n')
  if (value && typeof value === 'object') return Object.entries(value).map(([field, item]) => `${FIELD_LABELS[field] ?? field}：${actionValue(action, field, item)}`).join('\n')
  return value === null ? '指定なし' : String(value)
}

export function AssistantPanel({ userId, events }: { userId: string; events: EventResponse[] }) {
  const qc = useQueryClient()
  const key = ['assistant', userId]
  const [mobileOpen, setMobileOpen] = useState(false)
  const [input, setInput] = useState('')
  const [eventId, setEventId] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [result, setResult] = useState<unknown>()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  // Keep the same ID when retrying a failed submission. The API deduplicates it.
  const requestRef = useRef<{ text: string; eventId: string; id: string } | null>(null)
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchAssistantHistory(userId, signal), retry: false, refetchInterval: query => query.state.data?.busy ? 3000 : false })
  const receive = (state: AssistantState) => {
    const { result: output, ...saved } = state
    qc.setQueryData(key, saved)
    setResult(output)
    void qc.invalidateQueries({ queryKey: ['myEvents'] })
    void qc.invalidateQueries({ queryKey: ['mySubscriptions'] })
  }
  const send = useMutation({
    mutationFn: (data: { message: string; requestId: string; eventId?: string }) => sendAssistantMessage(userId, data),
    onSuccess: state => { receive(state); setInput(''); requestRef.current = null },
    onError: () => { void qc.invalidateQueries({ queryKey: key }) },
  })
  const resolve = useMutation({
    mutationFn: (data: { id: string; decision: 'approve' | 'cancel' }) => resolveAssistantAction(userId, data.id, data.decision),
    onSuccess: receive,
    onError: () => { void qc.invalidateQueries({ queryKey: key }) },
  })
  const clear = useMutation({ mutationFn: () => clearAssistantHistory(userId), onSuccess: state => { receive(state); setConfirmClear(false); requestRef.current = null } })
  const busy = send.isPending || resolve.isPending || clear.isPending || query.data?.busy === true
  const error = send.error ?? resolve.error ?? clear.error ?? query.error
  const pending = query.data?.pending
  const messageCount = query.data?.messages.length ?? 0

  useEffect(() => {
    if (messageCount || pending || busy) messagesRef.current?.scrollTo?.({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messageCount, pending, busy])
  useEffect(() => {
    if (!mobileOpen) return
    const old = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'
    if (inputRef.current?.disabled) panelRef.current?.querySelector<HTMLElement>('.assistant-mobile-close')?.focus()
    else inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-label="会話を削除しますか？"]')) return
      if (event.key === 'Escape') setMobileOpen(false)
      if (event.key !== 'Tab') return
      const targets = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary') ?? []).filter(element => element.getClientRects().length > 0)
      const first = targets[0]
      const last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      else if (!panelRef.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus() }
    }
    const onResize = () => { if (window.innerWidth > 960) setMobileOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => { document.body.style.overflow = old; window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus() }
  }, [mobileOpen])

  const submit = () => {
    const message = input.trim()
    if (!message || busy || pending) return
    if (requestRef.current?.text !== message || requestRef.current.eventId !== eventId) requestRef.current = { text: message, eventId, id: crypto.randomUUID() }
    send.mutate({ message, requestId: requestRef.current.id, ...(eventId ? { eventId } : {}) })
  }
  const suggest = (text: string) => { setInput(text); inputRef.current?.focus() }
  const actionDisabled = busy || (pending ? pending.expiresAt <= Date.now() : false)

  return <>
    <button className="assistant-launcher" type="button" onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} aria-controls="hiyorichan-panel"><img src={mascot} alt="" />ﾋﾖﾘﾁｬﾝ</button>
    <section ref={panelRef} id="hiyorichan-panel" className={`assistant-panel ${mobileOpen ? 'assistant-panel-open' : ''}`} role="dialog" aria-modal={mobileOpen ? true : undefined} aria-label="ﾋﾖﾘﾁｬﾝ">
      <div className="assistant-heading"><img src={mascot} alt="" /><h2>ﾋﾖﾘﾁｬﾝ</h2><span>AI</span><button type="button" className="assistant-icon-button" disabled={busy || !messageCount} onClick={() => setConfirmClear(true)} aria-label="会話を削除"><Icon name="trash" size={16} /></button><button type="button" className="assistant-mobile-close assistant-icon-button" onClick={() => setMobileOpen(false)} aria-label="会話を閉じる"><Icon name="x" size={19} /></button></div>
      <div className="assistant-context"><Icon name="calendar" size={14} /><label htmlFor="assistant-event" className="assistant-sr-only">相談するイベント</label><select id="assistant-event" value={eventId} disabled={busy || !!pending} onChange={event => setEventId(event.target.value)}><option value="">イベントを選択（任意）</option>{events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>
      <div className="assistant-messages" ref={messagesRef} role="log" aria-label="会話履歴" aria-live="polite" aria-busy={busy}>
        {query.isLoading && <p className="assistant-muted">読み込み中…</p>}
        {!query.isLoading && !messageCount && !query.error && <div className="assistant-empty"><img src={mascot} alt="ﾋﾖﾘﾁｬﾝ" /><div className="assistant-suggestions"><button type="button" onClick={() => suggest('自分の予定を教えて')} disabled={busy}>予定を確認</button><button type="button" onClick={() => suggest('新しい日程調整を作りたい')} disabled={busy}>日程調整を作成</button></div></div>}
        {query.data?.messages.map(message => <div className={`assistant-message assistant-message-${message.role}`} key={message.id}>
          {message.role === 'assistant' && <div className="assistant-author"><img src={mascot} alt="" />ﾋﾖﾘﾁｬﾝ</div>}
          {!!message.steps?.length && <details className="assistant-steps"><summary><Icon name="check-circle" size={13} />確認した情報</summary><ul>{message.steps.map((step, index) => <li key={`${step.tool}-${index}`}>{step.label}{step.status === 'error' ? '：取得できませんでした' : '：完了'}</li>)}</ul></details>}
          <p>{message.content}</p>
          {message.eventId && <Link className="assistant-event-link" to={`/events/${encodeURIComponent(message.eventId)}`}>イベントを開く <Icon name="arrow-right" size={13} /></Link>}
        </div>)}
        {send.isPending && <div className="assistant-message assistant-message-user"><p>{send.variables?.message}</p></div>}
        {busy && <p className="assistant-processing" role="status"><span />{resolve.isPending ? '実行中…' : '確認中…'}</p>}
        {pending && <section className="assistant-action" aria-label="操作内容の確認"><h3>{pending.label}</h3><dl>{Object.entries(pending.arguments).map(([field, value]) => <div key={field}><dt>{FIELD_LABELS[field] ?? field}</dt><dd>{actionValue(pending, field, value)}</dd></div>)}{pending.tool === 'hiyori_create_event' && pending.arguments.visibility === undefined && <div><dt>公開範囲</dt><dd>公開</dd></div>}</dl>{pending.tool === 'hiyori_confirm' && <p className="assistant-action-note">連携済みの通知先や、公開イベントのカレンダー購読にも反映されます。</p>}<p className="assistant-action-note">日本時間で表示 · 確認期限10分</p><div className="assistant-action-buttons"><button type="button" className="assistant-primary" disabled={actionDisabled} onClick={() => resolve.mutate({ id: pending.id, decision: 'approve' })}>この内容で実行</button><button type="button" disabled={busy} onClick={() => resolve.mutate({ id: pending.id, decision: 'cancel' })}>取り消す</button></div></section>}
        {result !== undefined && <details className="assistant-result"><summary>実行結果</summary><pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre></details>}
      </div>
      <div className="assistant-compose">
        {error && <div className="assistant-error" role="alert">{error instanceof ApiError && error.status === 401 ? 'ログイン状態を確認してください。' : error.message}<button type="button" onClick={() => { send.reset(); resolve.reset(); clear.reset(); void query.refetch() }}>再読み込み</button></div>}
        <form onSubmit={event => { event.preventDefault(); submit() }}><label className="assistant-sr-only" htmlFor="assistant-input">メッセージ</label><textarea id="assistant-input" ref={inputRef} value={input} onChange={event => setInput(event.target.value)} maxLength={4000} rows={2} placeholder={pending ? '操作内容を確認してください' : 'メッセージを入力'} disabled={busy || !!pending || query.isLoading || !!query.error} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() } }} /><div className="assistant-compose-bottom"><span>AIの回答は内容を確認してください</span><button type="submit" className="assistant-send" aria-label="送信" disabled={!input.trim() || busy || !!pending || query.isLoading || !!query.error}><Icon name="arrow-right" size={16} /></button></div></form>
      </div>
    </section>
    {confirmClear && <ConfirmDialog title="会話を削除しますか？" message="確認待ちの操作も取り消します。" confirmLabel={clear.isPending ? '削除中…' : '削除する'} danger onConfirm={() => { if (!clear.isPending) clear.mutate() }} onCancel={() => { if (!clear.isPending) setConfirmClear(false) }} />}
  </>
}
