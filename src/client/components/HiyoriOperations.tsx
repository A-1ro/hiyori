import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { hiyoriActionSchema, type HiyoriAction } from '../../shared/hiyori-agent'

export type AgentState = {
  selectedEventId?: string
  toolDataConsent: boolean
  selectEvent?: boolean
  action?: HiyoriAction
  results: Array<{ name: string; data: unknown }>
}
export const emptyAgent = (): AgentState => ({ toolDataConsent: false, results: [] })
const eventSchema = z.object({ id: z.string(), title: z.string() })
const detailSchema = z.object({
  event: eventSchema.extend({ timezone: z.string() }), isOrganizer: z.boolean(),
  candidates: z.array(z.object({ id: z.string(), startAt: z.string(), endAt: z.string() })),
})
type Detail = z.infer<typeof detailSchema>
const choices = { yes: '○', maybe: '△', no: '×' } as const
type Choice = keyof typeof choices
function latest(state: AgentState, name: string) { return [...state.results].reverse().find((r) => r.name === name)?.data }
function date(value: string, timezone?: string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  try { return new Intl.DateTimeFormat('ja-JP', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed) } catch { return value }
}
const labels: Record<string, string> = { title: 'イベント名', description: '説明', visibility: '公開範囲', defaultDurationMinutes: '所要時間（分）', deadline: '締切', timezone: 'タイムゾーン', discordUsername: '招待するユーザー名', invitedDiscordUsernames: '初期招待', startAt: '開始', endAt: '終了', displayName: '回答者名', comment: 'コメント' }

export function ActionSummary({ action, detail }: { action: HiyoriAction; detail?: Detail }) {
  const args = action.arguments
  const candidate = (id: unknown) => { const c = detail?.candidates.find((item) => item.id === id); return c ? `${date(c.startAt, detail?.event.timezone)} ～ ${date(c.endAt, detail?.event.timezone)}` : '候補の最新表示を確認してください' }
  const voteRows = z.array(z.object({ candidateId: z.string(), choice: z.enum(['yes', 'maybe', 'no']), comment: z.string().optional() })).safeParse(args.votes)
  const candidateRows = z.array(z.object({ startAt: z.string(), endAt: z.string().optional() })).safeParse(args.candidates)
  return <>
    {action.eventTitle && <h4>{action.eventTitle}</h4>}{action.subject && <p>{action.subject}</p>}
    <dl>{Object.entries(args).filter(([key]) => key in labels).map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{value === null ? 'なし' : value === 'public' ? '公開' : value === 'invite_only' ? '招待限定' : Array.isArray(value) ? value.join('、') : String(value)}</dd></div>)}</dl>
    {voteRows.success && <ul>{voteRows.data.map((v) => <li key={v.candidateId}>{candidate(v.candidateId)}：{choices[v.choice]}{v.comment && `（${v.comment}）`}</li>)}</ul>}
    {candidateRows.success && <ul>{candidateRows.data.map((c, i) => <li key={i}>{date(c.startAt, typeof args.timezone === 'string' ? args.timezone : undefined)}{c.endAt && ` ～ ${date(c.endAt, typeof args.timezone === 'string' ? args.timezone : undefined)}`}</li>)}</ul>}
    {Array.isArray(args.candidateIds) && <ul>{args.candidateIds.map((id, i) => <li key={i}>{candidate(id)}</li>)}</ul>}
    {typeof args.candidateId === 'string' && <p>{candidate(args.candidateId)}</p>}
    {['hiyori_confirm', 'hiyori_unconfirm'].includes(action.name) && <p>確定状況とカレンダー配信が変わります。Discord連携がある場合は通知されます。</p>}
    {action.name === 'hiyori_remove_candidate' && <p>この候補と候補への回答を削除します。元に戻せません。</p>}
    {action.name === 'hiyori_delete_event' && <p>イベント・候補・回答を削除します。元に戻せません。</p>}
    {['hiyori_remove_subscription', 'hiyori_regen_subscription'].includes(action.name) && <p>選んだ購読の現在のURLは使えなくなります。</p>}
    {action.name === 'hiyori_revoke_invite' && <p>選んだ招待を取り消します。対象を最新の招待一覧で確認してください。</p>}
  </>
}

export function HiyoriOperations({ owner, state, onChange, checkedOwner, disabled, onBusyChange }: {
  owner: string; state: AgentState; onChange: (state: AgentState) => void
  checkedOwner: (signal?: AbortSignal) => Promise<string | null>; disabled: boolean; onBusyChange?: (busy: boolean) => void
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [target, setTarget] = useState('')
  const [votes, setVotes] = useState<Record<string, { choice: Choice; comment: string }>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null)
  const confirmed = !!state.action && confirmedToken === state.action.token
  const active = useRef<AbortController | null>(null)
  const stateRef = useRef(state); stateRef.current = state
  const busy = working || disabled
  const parsed = detailSchema.safeParse(latest(state, 'hiyori_get_event'))
  const detail = parsed.success ? parsed.data : undefined
  const list = z.object({ organized: z.array(eventSchema), participating: z.array(eventSchema) }).safeParse(latest(state, 'hiyori_list_events'))
  const events = list.success ? [...new Map([...list.data.organized, ...list.data.participating].map((e) => [e.id, e])).values()] : []
  useEffect(() => () => { active.current?.abort(); onBusyChange?.(false) }, [onBusyChange])
  const ownVotesData = latest(state, 'hiyori_get_my_votes')
  useEffect(() => {
    const mine = z.object({ votes: z.array(z.object({ candidateId: z.string(), choice: z.enum(['yes', 'maybe', 'no']), comment: z.string().nullable().optional() })) }).safeParse(ownVotesData)
    setVotes(mine.success ? Object.fromEntries(mine.data.votes.map((v) => [v.candidateId, { choice: v.choice, comment: v.comment ?? '' }])) : {})
    setSelected([])
  }, [ownVotesData])
  async function request(path: string, body: Record<string, unknown>, signal: AbortSignal) {
    if (await checkedOwner(signal) !== owner || signal.aborted) throw new Error('アカウントが変わりました。')
    const res = await fetch(`/api/hiyori/agent/${path}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedDiscordId: owner, ...body }) })
    const json: unknown = await res.json()
    if (!res.ok) throw new Error(z.object({ error: z.string() }).safeParse(json).data?.error ?? '操作を完了できませんでした。再送前に現在の状態を確認してください。')
    if (await checkedOwner(signal) !== owner || signal.aborted) throw new Error('アカウントが変わりました。')
    return json
  }
  async function work(operation: (signal: AbortSignal) => Promise<void>) {
    if (active.current || busy) return
    const controller = new AbortController(); active.current = controller
    setWorking(true); onBusyChange?.(true); setError(''); setNotice('')
    try { await operation(controller.signal) } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '操作できませんでした。') }
    finally { if (!controller.signal.aborted) { setWorking(false); onBusyChange?.(false); active.current = null } }
  }
  async function read(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    return z.object({ name: z.string(), data: z.unknown() }).parse(await request('read', { name, arguments: args }, signal))
  }
  function choose(eventId: string) {
    void work(async (signal) => {
      const detail = await read('hiyori_get_event', { eventId }, signal)
      const mine = await read('hiyori_get_my_votes', { eventId }, signal)
      onChange({ ...stateRef.current, selectedEventId: eventId, toolDataConsent: stateRef.current.selectedEventId === eventId && stateRef.current.toolDataConsent, selectEvent: false, action: undefined, results: [detail, mine] })
    })
  }
  function load(name: string, args: Record<string, unknown> = {}) { void work(async (signal) => { const result = await read(name, args, signal); onChange({ ...stateRef.current, results: [...stateRef.current.results.filter((r) => r.name !== name), result] }) }) }
  function prepare(name: string, args: Record<string, unknown>) { void work(async (signal) => { const action = hiyoriActionSchema.parse(await request('prepare', { name, arguments: args }, signal)); onChange({ ...stateRef.current, action }) }) }
  function confirm() {
    if (!state.action || !confirmed) return
    const action = state.action
    // Consume the UI proposal before sending. An uncertain response is never retried.
    void work(async (signal) => {
      onChange({ ...stateRef.current, action: undefined })
      const result = z.object({ name: z.string(), data: z.unknown() }).parse(await request('confirm', { token: action.token, confirmed: true }, signal))
      const refreshed = stateRef.current.selectedEventId && !['hiyori_delete_event', 'hiyori_remove_candidate'].includes(action.name)
        ? [await read('hiyori_get_event', { eventId: stateRef.current.selectedEventId }, signal), await read('hiyori_get_my_votes', { eventId: stateRef.current.selectedEventId }, signal)] : []
      onChange({ ...stateRef.current, action: undefined, results: [...refreshed, result], ...(['hiyori_delete_event'].includes(action.name) ? { selectedEventId: undefined } : {}) })
      setNotice('送信が完了しました。')
    })
  }
  return <section className="hiyori-operations" aria-label="イベントの操作">
    <div className="hiyori-operation-toolbar"><button type="button" disabled={busy} onClick={() => load('hiyori_list_events')}>イベントを選ぶ</button><button type="button" disabled={busy} onClick={() => load('hiyori_list_subscriptions')}>カレンダー購読</button></div>
    {(state.selectEvent || list.success) && <div className="hiyori-event-picker"><ul>{events.map((event) => <li key={event.id}><button type="button" disabled={busy} onClick={() => choose(event.id)}>{event.title}</button></li>)}</ul>{list.success && !events.length && <p>主催・参加中のイベントはありません。</p>}<label>イベントのURLまたはID<input value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} /></label><button type="button" disabled={busy || !target.trim()} onClick={() => { const text = target.trim(); try { const url = new URL(text, location.origin); if (url.origin !== location.origin) throw new Error(); const id = /^\/events\/([^/]+)\/?$/.exec(url.pathname)?.[1]; choose(id ? decodeURIComponent(id) : text) } catch { setError('このサイトのイベントを指定してください。') } }}>このイベントを開く</button></div>}
    {detail && <section aria-label="選択中のイベント"><h3>{detail.event.title}</h3><p>{detail.event.timezone}</p><label className="hiyori-consent"><input type="checkbox" checked={state.toolDataConsent} disabled={busy} onChange={(e) => onChange({ ...state, toolDataConsent: e.target.checked, action: undefined })} /><span>このイベント名・候補日時・自分の回答・集計のAI送信を確認しました</span></label>
      <fieldset disabled={busy}><legend>参加できる日を回答</legend>{detail.candidates.map((c) => <div key={c.id} className="hiyori-vote-row"><strong>{date(c.startAt, detail.event.timezone)} ～ {date(c.endAt, detail.event.timezone)}</strong><fieldset aria-label={`${date(c.startAt, detail.event.timezone)}の回答`}>{Object.entries(choices).map(([value, label]) => <button key={value} type="button" aria-pressed={votes[c.id]?.choice === value} onClick={() => setVotes({ ...votes, [c.id]: { choice: value as Choice, comment: votes[c.id]?.comment ?? '' } })}>{label}</button>)}</fieldset><label>コメント<input maxLength={500} value={votes[c.id]?.comment ?? ''} disabled={!votes[c.id]} onChange={(e) => setVotes({ ...votes, [c.id]: { ...votes[c.id]!, comment: e.target.value } })} /></label></div>)}<button type="button" disabled={!Object.keys(votes).length} onClick={() => prepare('hiyori_vote', { eventId: state.selectedEventId, votes: Object.entries(votes).map(([candidateId, value]) => ({ candidateId, ...value })) })}>回答内容を確認する</button></fieldset>
      <button type="button" disabled={busy} onClick={() => load('hiyori_tally', { eventId: state.selectedEventId })}>集計を表示</button>
      {detail.isOrganizer && <details><summary>主催者の操作</summary><fieldset disabled={busy}><legend>確定する候補</legend>{detail.candidates.map((c) => <label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))} />{date(c.startAt, detail.event.timezone)}</label>)}<button type="button" disabled={!selected.length} onClick={() => prepare('hiyori_confirm', { eventId: state.selectedEventId, candidateIds: selected })}>確定内容を確認する</button><button type="button" onClick={() => prepare('hiyori_unconfirm', { eventId: state.selectedEventId })}>確定取消を確認する</button></fieldset></details>}
    </section>}
    <ToolResults state={state} detail={detail} onPrepare={prepare} disabled={busy} />
    {state.action && <section className="hiyori-action-review" aria-label="送信前の確認"><h3>{state.action.label}・未送信</h3><ActionSummary action={state.action} detail={detail} /><p>5分以内に確認してください。内容が変わった場合は再確認が必要です。</p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmedToken(e.target.checked ? state.action!.token : null)} />この内容で実行することを確認しました</label><div><button type="button" disabled={busy || !confirmed || state.action.expiresAt <= Date.now()} onClick={confirm}>{state.action.label}</button><button type="button" disabled={busy} onClick={() => onChange({ ...state, action: undefined })}>取り消す</button></div></section>}
    {working && <p role="status">処理中…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="hiyori-error">{error}</p>}
  </section>
}

function ToolResults({ state, detail, onPrepare, disabled }: { state: AgentState; detail?: Detail; onPrepare: (name: string, args: Record<string, unknown>) => void; disabled: boolean }) {
  const tally = z.object({ candidates: z.array(z.object({ id: z.string(), startAt: z.string(), counts: z.object({ yes: z.number(), maybe: z.number(), no: z.number() }) })) }).safeParse(latest(state, 'hiyori_tally'))
  const subscriptions = z.object({ subscriptions: z.array(z.object({ id: z.string(), createdAt: z.string().optional() })) }).safeParse(latest(state, 'hiyori_list_subscriptions'))
  const invites = z.object({ invites: z.array(z.object({ id: z.string(), discordUsername: z.string().nullable().optional(), discordUserId: z.string().nullable().optional() })) }).safeParse(latest(state, 'hiyori_list_invites'))
  const busy = z.object({ startAts: z.array(z.string()) }).safeParse(latest(state, 'hiyori_my_busy'))
  const ics = latest(state, 'hiyori_get_ics')
  const subscription = z.object({ webcalUrl: z.string().nullable().optional(), url: z.string().nullable().optional() }).safeParse(latest(state, 'hiyori_add_subscription') ?? latest(state, 'hiyori_regen_subscription'))
  return <>
    {tally.success && <section aria-label="集計"><h3>集計</h3><ul>{tally.data.candidates.map((c) => <li key={c.id}>{date(c.startAt, detail?.event.timezone)}：○ {c.counts.yes}　△ {c.counts.maybe}　× {c.counts.no}</li>)}</ul></section>}
    {subscriptions.success && <section aria-label="購読一覧"><h3>カレンダー購読</h3>{subscriptions.data.subscriptions.map((s, i) => <div key={s.id}><span>購読 {i + 1}（識別末尾 {s.id.slice(-6)}）{s.createdAt && `（${date(s.createdAt)}）`}</span><button type="button" disabled={disabled} onClick={() => onPrepare('hiyori_regen_subscription', { subscriptionId: s.id })}>URL再生成を確認</button><button type="button" disabled={disabled} onClick={() => onPrepare('hiyori_remove_subscription', { subscriptionId: s.id })}>削除を確認</button></div>)}<button type="button" disabled={disabled} onClick={() => onPrepare('hiyori_add_subscription', {})}>購読の作成を確認</button></section>}
    {invites.success && <section aria-label="招待一覧"><h3>招待</h3>{invites.data.invites.map((invite) => <div key={invite.id}><span>{invite.discordUsername ?? `旧形式 ID: ${invite.discordUserId ?? '不明'}`}</span><button type="button" disabled={disabled} onClick={() => onPrepare('hiyori_revoke_invite', { eventId: state.selectedEventId, inviteId: invite.id })}>この招待の取消を確認</button></div>)}</section>}
    {busy.success && <section aria-label="確定済みの予定"><h3>確定済みの予定</h3><ul>{busy.data.startAts.map((start, i) => <li key={i}>{date(start)}</li>)}</ul></section>}
    {typeof ics === 'string' && <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); const a = document.createElement('a'); a.href = url; a.download = 'hiyori.ics'; a.click(); URL.revokeObjectURL(url) }}>ICSを保存</button>}
    {subscription.success && (subscription.data.webcalUrl || subscription.data.url) && <label>カレンダーへ登録するURL<input readOnly value={subscription.data.webcalUrl ?? subscription.data.url ?? ''} onFocus={(e) => e.target.select()} /></label>}
  </>
}
