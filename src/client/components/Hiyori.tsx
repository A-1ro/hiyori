import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession, loginUrl } from '../auth/useSession'
import { HIYORI_GUIDE, HIYORI_MEME, hiyoriReplySchema, isHiyoriMeme, type HiyoriDraft } from '../../shared/hiyori'
import type { ComposerInitial } from './events/EventComposer'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type PendingDraft = { id: string; owner: string; draft: HiyoriDraft }
type Conversation = { owner: string | null; messages: Message[]; draft: HiyoriDraft | null; input: string; consent: boolean; error: string }
type Settings = { hidden: boolean; autoDisplay: false }
const SETTINGS_KEY = 'hiyori:mascot:settings'

function readSettings(): Settings {
  try { return { hidden: JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').hidden === true, autoDisplay: false } }
  catch { return { hidden: false, autoDisplay: false } }
}
const empty = (owner: string | null): Conversation => ({ owner, messages: [], draft: null, input: '', consent: false, error: '' })
const message = (content: string, role: Message['role'] = 'assistant'): Message => ({ id: crypto.randomUUID(), role, content })

const HiyoriContext = createContext<{
  pending: PendingDraft | null
  openSettings: () => void
} | null>(null)
export const useHiyori = () => useContext(HiyoriContext)

export function hiyoriComposerInitial(draft: HiyoriDraft): Partial<ComposerInitial> {
  return { title: draft.title, description: draft.description, defaultDurationMinutes: draft.defaultDurationMinutes,
    visibility: draft.visibility, timezone: draft.timezone, dates: new Set(draft.dates),
    activeBands: new Set(), customTimes: draft.times, slotDur: {}, deadline: '' }
}

export function HiyoriLayout() {
  return <HiyoriProvider><Outlet /></HiyoriProvider>
}

export function HiyoriProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const qc = useQueryClient()
  const owner = session.isSuccess ? session.data.user?.discordUserId ?? null : null
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const [conversation, setConversation] = useState(() => empty(owner))
  // Never render the previous account's state, even before effects run.
  const current = conversation.owner === owner ? conversation : empty(owner)
  const [pending, setPending] = useState<PendingDraft | null>(null)
  const [settings, setSettings] = useState(readSettings)
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const previousPath = useRef(location.pathname)

  function discard() {
    epoch.current++
    active.current?.abort()
    active.current = null
    setBusy(false)
    setPending(null)
    setConversation(empty(ownerRef.current))
  }

  useEffect(() => {
    epoch.current++
    active.current?.abort()
    active.current = null
    setBusy(false)
    setPending(null)
    setConversation(empty(owner))
  }, [owner])
  useEffect(() => () => { active.current?.abort() }, [])
  useEffect(() => {
    if (previousPath.current === '/events/new' && location.pathname !== '/events/new') setPending(null)
    previousPath.current = location.pathname
  }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setAvailable(false)
    void fetch('/api/hiyori/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        const status: unknown = res.ok ? await res.json() : null
        if (!controller.signal.aborted) setAvailable(!!status && typeof status === 'object' && 'available' in status && status.available === true)
      }).catch(() => {})
    return () => controller.abort()
  }, [open])
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      panel.current?.showModal()
      input.current?.focus()
    } else {
      panel.current?.close()
      previousFocus.current?.focus()
    }
  }, [open])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SETTINGS_KEY) { setSettings(readSettings()); setOpen(false) } }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  function saveSettings(next: Settings) {
    setSettings(next)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* Memory fallback when storage is unavailable. */ }
  }
  function close() { setOpen(false) }
  function localReply(content: string) {
    setConversation((old) => ({ ...old, owner, messages: [...(old.owner === owner ? old.messages : []), message(content)].slice(-12), error: '' }))
  }
  async function checkedOwner(signal?: AbortSignal) {
    const result = await session.refetch()
    if (signal?.aborted) return null
    if (!result.isSuccess || result.fetchStatus !== 'idle') throw new Error('ログイン状態を確認できません。接続を確認して再試行してください。')
    const id = result.data.user?.discordUserId
    if (!id || id !== owner || id !== ownerRef.current) { discard(); return null }
    return id
  }
  async function send() {
    const text = current.input.trim()
    if (!text || busy || active.current) return
    if (isHiyoriMeme(text)) {
      setSettingsOpen(true)
      setConversation({ ...current, input: '', messages: [...current.messages, message(text, 'user'), message(HIYORI_MEME)].slice(-12) })
      return
    }
    if (!owner || !available || !current.consent) {
      localReply(!owner ? session.isError ? 'ログイン状態を確認できません。通信状況を確認してください。使い方のボタンはそのまま使えます。' : 'AI での会話と下書きには Discord ログインが必要だよ。使い方のボタンはそのまま使えるよ。'
        : !available ? 'AI はまだ準備中だよ。使い方のボタンや手動フォームを使ってね。'
          : '送信内容の取り扱いを確認して、チェックを入れてから送ってね。')
      return
    }
    const controller = new AbortController()
    active.current = controller
    const turn = ++epoch.current
    setBusy(true)
    setConversation({ ...current, error: '', draft: null })
    try {
      const id = await checkedOwner(controller.signal)
      if (!id || controller.signal.aborted || turn !== epoch.current) return
      const history = [...current.messages.slice(-5), message(text, 'user')]
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch('/api/hiyori/chat', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), expectedDiscordId: id, timezone, consent: true,
          messages: history.map(({ role, content }) => ({ role, content })) }),
      })
      if (res.status === 401 || res.status === 412) {
        discard()
        if (res.status === 401) qc.setQueryData(['session'], { user: null })
        return
      }
      const body: unknown = await res.json()
      if (!res.ok) {
        const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'AI が応答できませんでした。手動フォームをご利用ください。'
        throw new Error(detail)
      }
      const reply = hiyoriReplySchema.parse(body)
      if (reply.draft && reply.draft.timezone !== timezone) throw new Error('日時を安全に読み取れませんでした。手動フォームをご利用ください。')
      if (!await checkedOwner(controller.signal) || controller.signal.aborted || turn !== epoch.current) return
      setConversation({ ...current, input: '', messages: [...history, message(reply.reply)].slice(-12), draft: reply.draft, error: '' })
    } catch (error) {
      if (!controller.signal.aborted && turn === epoch.current && ownerRef.current === owner) {
        setConversation((old) => ({ ...old, draft: null, error: error instanceof Error ? error.message : '応答を確認できませんでした。手動フォームをご利用ください。' }))
      }
    } finally {
      if (turn === epoch.current) { setBusy(false); active.current = null }
    }
  }
  async function transfer() {
    if (!current.draft || !owner || busy) return
    try {
      const turn = epoch.current
      if (!await checkedOwner()) return
      if (turn !== epoch.current) return
      setPending({ id: crypto.randomUUID(), owner, draft: current.draft })
      close()
      navigate('/events/new')
    } catch {
      setConversation((old) => ({ ...old, error: 'ログイン状態を確認できません。接続を確認してください。' }))
    }
  }

  return (
    <HiyoriContext.Provider value={{ pending: pending?.owner === owner ? pending : null, openSettings: () => { setSettingsOpen(true); setOpen(true) } }}>
      {children}
      {!settings.hidden && <button ref={launcher} type="button" className="hiyori-launcher" onClick={() => { setSettingsOpen(false); setOpen(true) }} aria-label="ﾋﾖﾘﾁｬﾝと話す" aria-haspopup="dialog">
        <span className="hiyori-face" aria-hidden="true">☀<span>•ᴗ•</span></span><span>ﾋﾖﾘﾁｬﾝ</span>
      </button>}
      <dialog ref={panel} className="hiyori-panel" aria-labelledby="hiyori-title" onCancel={(event) => { event.preventDefault(); close() }} onClose={close}>
        <div className="hiyori-header"><div><strong id="hiyori-title">☀ ﾋﾖﾘﾁｬﾝ</strong><p>日程調整のお手伝い、呼んだ？</p></div><button type="button" onClick={close} aria-label="チャットを閉じる">閉じる</button></div>
        <div className="hiyori-scroll">
          <p>使い方の案内とイベントの下書きを手伝うよ。保存・招待・日程確定は自分で確認してね。</p>
          <div className="hiyori-actions">
            {(Object.entries(HIYORI_GUIDE) as Array<[keyof typeof HIYORI_GUIDE, string]>).map(([key, content]) => <button key={key} type="button" disabled={busy} onClick={() => localReply(content)}>{({ create: 'つくり方', vote: '回答のしかた', confirm: '確定とカレンダー', draft: '下書きの頼み方' })[key]}</button>)}
          </div>
          <p role="status" className="hiyori-notice">{available ? 'AI 会話を利用できます。内容を確認して送信してください。' : 'AI は準備中です。使い方の案内と手動フォームをご利用ください。'}</p>
          <div className="hiyori-messages" role="log" aria-label="ﾋﾖﾘﾁｬﾝとの会話" aria-live="polite">
            {current.messages.map((item) => <p key={item.id} className={item.role === 'user' ? 'hiyori-user' : 'hiyori-assistant'}><b>{item.role === 'user' ? 'あなた' : 'ﾋﾖﾘﾁｬﾝ'}</b><br />{item.content}</p>)}
          </div>
          {current.error && <p role="alert">{current.error}</p>}
          {busy && <p role="status">下書きを考えています。まだ保存はしていません…</p>}
          {current.draft && <section className="hiyori-draft" aria-label="イベントの下書き">
            <strong>{current.draft.title}</strong><p>{current.draft.description}</p>
            <p>{current.draft.dates.join('、')}<br />各日 {current.draft.times.join('、')} ／ {current.draft.defaultDurationMinutes}分<br />{current.draft.timezone} ／ {current.draft.visibility === 'public' ? '公開（リンクを知る人が閲覧可能）' : '招待限定'}</p>
            <p>日付と時刻の全組合せが候補になります。まだ保存されていません。招待先はフォームで入力してください。</p>
            {location.pathname === '/events/new' && <p>フォームの入力をこの下書きで置き換えます。</p>}
            <button type="button" disabled={busy} onClick={() => { void transfer() }}>{location.pathname === '/events/new' ? '入力を置き換えてフォームで確認' : 'フォームで確認する'}</button>
          </section>}
          <div className="hiyori-actions"><Link to="/help" onClick={close}>詳しい使い方</Link><Link to="/events/new" onClick={close}>手動フォームを開く</Link>{!owner && <a href={loginUrl('/me')}>Discord でログイン</a>}</div>
          <details open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}><summary>表示・会話の設定</summary>
            <p>自動表示は初期状態で無効です。</p>
            <div className="hiyori-actions">
              <button type="button" onClick={() => { saveSettings({ ...settings, autoDisplay: false }); localReply('自動表示しない設定にしたよ。呼ばれたときだけ開くね。') }}>自動表示しない</button>
              <button type="button" onClick={() => { discard(); saveSettings({ hidden: true, autoDisplay: false }); close() }}>マスコットを非表示</button>
              <button type="button" onClick={() => { saveSettings({ hidden: false, autoDisplay: false }); localReply('マスコットを再表示したよ。') }}>マスコットを再表示</button>
              <button type="button" onClick={discard}>会話と下書きを消去</button>
            </div>
            <p>非表示にしてもページ下の「ﾋﾖﾘﾁｬﾝの設定」から戻せます。</p>
          </details>
        </div>
        <form className="hiyori-input" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <label htmlFor="hiyori-message">ﾋﾖﾘﾁｬﾝへのメッセージ</label>
          <textarea ref={input} id="hiyori-message" value={current.input} maxLength={1000} rows={2} disabled={busy} placeholder="例）11月8日と9日の19時から1時間、公開のゲーム会の下書き" onChange={(event) => setConversation({ ...current, input: event.target.value })} />
          <label className="hiyori-consent"><input type="checkbox" checked={current.consent} disabled={busy} onChange={(event) => setConversation({ ...current, consent: event.target.checked })} />AI 利用時、入力した会話を Cloudflare Workers AI に送ることを確認しました。秘密情報は入力しないでください。</label>
          <p>履歴はこのタブのメモリのみ。既存イベント・投票・招待一覧は AI に送りません。<Link to="/privacy" onClick={close}>取り扱い</Link></p>
          <div className="hiyori-actions"><button type="submit" disabled={busy || !current.input.trim()}>送信</button>{busy && <button type="button" onClick={discard}>停止して会話を消去</button>}</div>
        </form>
      </dialog>
    </HiyoriContext.Provider>
  )
}
