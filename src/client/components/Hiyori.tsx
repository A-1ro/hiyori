import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession, loginUrl } from '../auth/useSession'
import { HIYORI_GUIDE, HIYORI_MEME, hiyoriReplySchema, isHiyoriMeme, type HiyoriDraft } from '../../shared/hiyori'
import type { ComposerInitial } from './events/EventComposer'
import { Icon } from './primitives'
import hiyoriCharacter from '../assets/images/hiyori-bot.webp'
import './Hiyori.css'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type PendingDraft = { id: string; owner: string; draft: HiyoriDraft }
type Conversation = { owner: string | null; messages: Message[]; draft: HiyoriDraft | null; input: string; consent: boolean; error: string }
type Settings = { hidden: boolean; autoDisplay: false }
const SETTINGS_KEY = 'hiyori:mascot:settings'
const GUIDE_CARDS = [
  { key: 'create', icon: 'calendar', label: 'つくり方' },
  { key: 'vote', icon: 'users', label: '回答のしかた' },
  { key: 'confirm', icon: 'check-circle', label: '確定とカレンダー' },
  { key: 'draft', icon: 'message-square', label: '下書きの頼み方' },
] as const

function HiyoriAvatar({ className = '' }: { className?: string }) {
  return <span className={`hiyori-avatar ${className}`} aria-hidden="true"><img src={hiyoriCharacter} alt="" width={384} height={384} decoding="async" /></span>
}

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
  const [guidesOpen, setGuidesOpen] = useState(true)
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const restoreTitle = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const settingsPanel = useRef<HTMLDetailsElement>(null)
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
    setGuidesOpen(true)
  }

  useEffect(() => {
    epoch.current++
    active.current?.abort()
    active.current = null
    setBusy(false)
    setPending(null)
    setConversation(empty(owner))
    setGuidesOpen(true)
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
    const viewport = window.visualViewport
    if (!open || !viewport) return
    const update = () => {
      panel.current?.style.setProperty('--hy-viewport-height', `${viewport.height}px`)
      panel.current?.style.setProperty('--hy-viewport-top', `${viewport.offsetTop}px`)
      panel.current?.style.setProperty('--hy-viewport-width', `${viewport.width}px`)
      panel.current?.style.setProperty('--hy-viewport-left', `${viewport.offsetLeft}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update) }
  }, [open])
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : launcher.current
      panel.current?.showModal()
      // Focus the dialog title without opening a phone's software keyboard.
      ;(settings.hidden ? restoreTitle.current : title.current)?.focus()
    } else {
      panel.current?.close()
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
      else if (previousFocus.current) document.querySelector<HTMLButtonElement>('[data-hiyori-settings-trigger]')?.focus()
    }
  }, [open, settings.hidden])
  useEffect(() => {
    if (open && scroller.current && (current.messages.length || current.draft || busy)) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [open, current.messages.length, current.draft, busy])
  useEffect(() => {
    if (open && settingsOpen) {
      settingsPanel.current?.scrollIntoView?.({ block: 'nearest' })
      settingsPanel.current?.querySelector('summary')?.focus()
    }
  }, [open, settingsOpen])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SETTINGS_KEY) { setSettings(readSettings()); setOpen(false) } }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  function saveSettings(next: Settings) {
    setSettings(next)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* Memory fallback when storage is unavailable. */ }
  }
  function close() {
    // Close while the native dialog is still connected. Hiding the mascot may
    // unmount it, so an effect after rendering would no longer have this ref.
    panel.current?.close()
    setOpen(false)
  }
  function hide() { previousFocus.current ??= launcher.current; discard(); saveSettings({ hidden: true, autoDisplay: false }); close() }
  function localReply(content: string) {
    setGuidesOpen(false)
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
      setGuidesOpen(false)
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
    setGuidesOpen(false)
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
      {!settings.hidden && <div className="hiyori-dock">
        <button ref={launcher} type="button" className="hiyori-launcher" onClick={() => { setSettingsOpen(false); setOpen(true) }} aria-label="ﾋﾖﾘﾁｬﾝと話す" aria-haspopup="dialog">
        <HiyoriAvatar /><span className="hiyori-launcher-label"><strong>ﾋﾖﾘﾁｬﾝ</strong></span>
        </button>
        <button type="button" className="hiyori-dismiss" onClick={hide} aria-label="ﾋﾖﾘﾁｬﾝを非表示" title="ﾋﾖﾘﾁｬﾝを非表示"><span aria-hidden="true"><Icon name="x" size={20} /></span></button>
      </div>}
      {(!settings.hidden || open) && <dialog ref={panel} className="hiyori-panel" aria-labelledby="hiyori-title" onCancel={(event) => { event.preventDefault(); close() }} onClose={() => { if (!panel.current?.open) close() }}>
        {settings.hidden ? <>
          <header className="hiyori-header"><h2 ref={restoreTitle} tabIndex={-1} id="hiyori-title">ﾋﾖﾘﾁｬﾝの表示設定</h2><button type="button" className="hiyori-icon-button" onClick={close} aria-label="設定を閉じる"><span aria-hidden="true"><Icon name="x" size={20} /></span></button></header>
          <div className="hiyori-scroll hiyori-restore"><p>ﾋﾖﾘﾁｬﾝ本体と起動ボタンを非表示にしています。</p><button type="button" className="hiyori-primary-button" onClick={() => { saveSettings({ hidden: false, autoDisplay: false }); setSettingsOpen(false) }}>マスコットを再表示</button><p>自動では話しかけません。</p></div>
        </> : <>
        <header className="hiyori-header">
          <HiyoriAvatar />
          <div className="hiyori-identity"><h2 ref={title} tabIndex={-1} id="hiyori-title">ﾋﾖﾘﾁｬﾝ</h2></div>
          <div className="hiyori-header-controls">
            <button type="button" className="hiyori-icon-button" onClick={() => setSettingsOpen(!settingsOpen)} aria-label="ﾋﾖﾘﾁｬﾝの設定を開く" aria-expanded={settingsOpen} aria-controls="hiyori-settings"><span aria-hidden="true"><Icon name="chevron-down" size={19} /></span></button>
            <button type="button" className="hiyori-icon-button" onClick={close} aria-label="チャットを閉じる"><span aria-hidden="true"><Icon name="x" size={20} /></span></button>
          </div>
        </header>
        <div ref={scroller} className="hiyori-scroll">
          {!current.messages.length && !current.draft && !busy && <section className="hiyori-welcome" aria-label="ﾋﾖﾘﾁｬﾝのごあいさつ">
            <div className="hiyori-welcome-art"><img src={hiyoriCharacter} alt="手を振る小さなカレンダー型 Bot、ﾋﾖﾘﾁｬﾝ" width={384} height={384} decoding="async" /></div>
          </section>}
          <details className="hiyori-guides" open={guidesOpen} onToggle={(event) => setGuidesOpen(event.currentTarget.open)}>
            <summary>使い方<span aria-hidden="true"><Icon name="chevron-down" size={16} /></span></summary>
            <div className="hiyori-guide-grid">
              {GUIDE_CARDS.map((item) => <button key={item.key} type="button" className="hiyori-guide-card" aria-label={item.label} disabled={busy} onClick={() => localReply(HIYORI_GUIDE[item.key])}><span className="hiyori-guide-icon" aria-hidden="true"><Icon name={item.icon} size={20} /></span><strong>{item.label}</strong></button>)}
            </div>
          </details>
          <div role="status" className={`hiyori-notice ${available ? 'hiyori-notice-ready' : ''}`}><p>{available ? 'AI 会話を利用できます。内容を確認して送信してください。' : 'AI は準備中です。使い方の案内と手動フォームをご利用ください。'}</p></div>
          <div className="hiyori-messages" role="log" aria-label="ﾋﾖﾘﾁｬﾝとの会話" aria-live="polite">
            {current.messages.map((item) => <div key={item.id} className={`hiyori-message ${item.role === 'user' ? 'hiyori-user' : 'hiyori-assistant'}`}>{item.role === 'assistant' && <HiyoriAvatar className="hiyori-message-avatar" />}<div><span className="hiyori-message-name">{item.role === 'user' ? 'あなた' : 'ﾋﾖﾘﾁｬﾝ'}</span><p>{item.content}</p></div></div>)}
            {current.messages.some((item) => item.role === 'assistant' && item.content === HIYORI_MEME) && <div className="hiyori-meme-action"><button type="button" className="hiyori-primary-button" onClick={hide}>ﾋﾖﾘﾁｬﾝを非表示にする</button><p>本体も起動ボタンも消えます。ページ下の「ﾋﾖﾘﾁｬﾝの設定」から戻せます。</p></div>}
          </div>
          {current.error && <p className="hiyori-error" role="alert">{current.error}</p>}
          {busy && <p className="hiyori-thinking" role="status"><span aria-hidden="true">・ ・ ・</span>下書きを考えています。まだ保存はしていません…</p>}
          {current.draft && <section className="hiyori-draft" aria-label="イベントの下書き">
            <div className="hiyori-draft-heading"><span aria-hidden="true"><Icon name="calendar" size={22} /></span><span className="hiyori-draft-badge">下書き・未保存</span></div>
            <h3>{current.draft.title}</h3>{current.draft.description && <p className="hiyori-draft-description">{current.draft.description}</p>}
            <dl><div><dt>候補日</dt><dd className="hiyori-date-chips">{current.draft.dates.map((date) => <span key={date}>{date.replaceAll('-', '/')}</span>)}</dd></div><div><dt>開始・所要時間</dt><dd>各日 {current.draft.times.join('、')}<span className="hiyori-draft-duration">{current.draft.defaultDurationMinutes}分</span></dd></div><div><dt>タイムゾーン</dt><dd>{current.draft.timezone}</dd></div><div><dt>公開範囲</dt><dd>{current.draft.visibility === 'public' ? '公開（リンクを知る人が閲覧可能）' : '招待限定'}</dd></div></dl>
            <p className="hiyori-draft-note">候補は日付と時刻の全組合せです。招待先は次のフォームで入力してください。</p>
            {location.pathname === '/events/new' && <p>フォームの入力をこの下書きで置き換えます。</p>}
            <button type="button" className="hiyori-primary-button" disabled={busy} onClick={() => { void transfer() }}>{location.pathname === '/events/new' ? '入力を置き換えてフォームで確認' : 'フォームで確認する'}<span aria-hidden="true"><Icon name="arrow-right" size={17} /></span></button>
          </section>}
          <div className="hiyori-support-links"><Link to="/help" onClick={close}>詳しい使い方</Link><Link to="/events/new" onClick={close}>手動フォームを開く<span aria-hidden="true"><Icon name="arrow-right" size={13} /></span></Link>{!owner && <a href={loginUrl('/me')}>Discord でログイン</a>}</div>
          <details ref={settingsPanel} id="hiyori-settings" className="hiyori-settings" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}><summary>表示・会話の設定<span aria-hidden="true"><Icon name="chevron-down" size={16} /></span></summary>
            <p>自動表示は初期状態で無効です。</p>
            <div className="hiyori-settings-actions">
              <button type="button" onClick={() => { saveSettings({ ...settings, autoDisplay: false }); localReply('自動表示しない設定にしたよ。呼ばれたときだけ開くね。') }}>自動表示しない</button>
              <button type="button" onClick={hide}>マスコットを非表示</button>
              <button type="button" onClick={() => { saveSettings({ hidden: false, autoDisplay: false }); localReply('マスコットを再表示したよ。') }}>マスコットを再表示</button>
              <button type="button" onClick={discard}>会話と下書きを消去</button>
            </div>
            <p>非表示にしてもページ下の「ﾋﾖﾘﾁｬﾝの設定」から戻せます。</p>
          </details>
        </div>
        <form className="hiyori-input" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <label htmlFor="hiyori-message" className="hiyori-sr-only">ﾋﾖﾘﾁｬﾝへのメッセージ</label>
          <div className="hiyori-compose"><textarea ref={input} id="hiyori-message" value={current.input} maxLength={1000} rows={2} disabled={busy} placeholder="メッセージを入力" onChange={(event) => setConversation({ ...current, input: event.target.value })} onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
          }} /><button type="submit" className="hiyori-send" aria-label="送信" disabled={busy || !current.input.trim()}><span aria-hidden="true"><Icon name="arrow-right" size={20} /></span></button></div>
          {available && <label className="hiyori-consent"><input type="checkbox" checked={current.consent} disabled={busy} onChange={(event) => setConversation({ ...current, consent: event.target.checked })} /><span>入力した会話の AI 送信を確認しました<small>送信先は Cloudflare Workers AI。秘密情報は入力しないでね。</small></span></label>}
          <div className="hiyori-input-footnote"><p>会話はこのタブだけ。既存イベントは送信しません。<Link to="/privacy" onClick={close}>取り扱い</Link></p><span className="hiyori-shortcut">Ctrl / ⌘ + Enter</span></div>
          {busy && <button type="button" className="hiyori-stop" onClick={discard}>停止して会話を消去</button>}
        </form>
        </>}
      </dialog>}
    </HiyoriContext.Provider>
  )
}
