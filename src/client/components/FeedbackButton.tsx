import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon } from './primitives'
import { useSession } from '../auth/useSession'
import { submitFeedback, ApiError, type FeedbackCategory } from '../api/client'

// 現在のパスから /events/:id のイベント ID を拾う（イベント画面からの報告の再現性向上）。
function currentEventId(pathname: string): string | undefined {
  const m = pathname.match(/^\/events\/([^/]+)/)
  return m ? m[1] : undefined
}

const CATEGORY_OPTS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: '不具合' },
  { value: 'feature', label: '要望' },
  { value: 'other', label: 'その他' },
]

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  // ヘッダー（sticky, z-index:20）や他の stacking context より確実に上に出す。
  zIndex: 1000,
  background: 'rgba(0,0,0,0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-lg)',
  padding: 20,
  maxHeight: '90vh',
  overflowY: 'auto',
}

const fieldInputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 14,
  color: 'var(--color-fg1)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-fg2)',
  marginBottom: 6,
}

export function FeedbackButton({ variant = 'icon' }: { variant?: 'icon' | 'link' }) {
  const { data: sessionData } = useSession()
  const user = sessionData?.user ?? null

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<FeedbackCategory | ''>('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const openModal = () => {
    setDone(false)
    setError(undefined)
    setOpen(true)
  }
  // done が変わったときだけ identity を更新（useEffect の依存を安定させる）。
  const close = useCallback(() => {
    setOpen(false)
    // 次に開くときのために入力をリセット（送信済みなら特に）。
    if (done) {
      setMessage('')
      setCategory('')
      setName('')
    }
  }, [done])

  // Esc で閉じる。開いている間だけリスナを張る。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const handleSubmit = async () => {
    if (message.trim().length === 0 || submitting) return
    setSubmitting(true)
    setError(undefined)
    try {
      // ログイン状態を submitter に織り込む（名前未入力なら Discord 表示名＋ログイン明示）。
      const submitter =
        name.trim().length > 0
          ? name.trim()
          : user
            ? `${user.displayName}（Discordログイン）`
            : undefined
      await submitFeedback({
        message: message.trim(),
        category: category || undefined,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        eventId:
          typeof window !== 'undefined'
            ? currentEventId(window.location.pathname)
            : undefined,
        submitter,
      })
      setDone(true)
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? '短時間に送りすぎました。少し待ってからお試しください。'
          : '送信できませんでした。通信状況を確認して、もう一度お試しください。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={openModal}
          aria-label="不具合報告・フィードバック"
          title="不具合報告・フィードバック"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'transparent',
            border: '1px solid var(--color-border-strong)',
            cursor: 'pointer',
            padding: '5px 10px',
            borderRadius: 'var(--radius-pill)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            color: 'var(--color-fg2)',
          }}
        >
          <Icon name="message-square" size={15} />
          不具合報告
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-blurple-ink)',
          }}
        >
          <Icon name="message-square" size={16} />
          フィードバック・不具合を報告する
        </button>
      )}

      {open &&
        createPortal(
          <div style={overlayStyle} onClick={close}>
          <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-fg1)' }}>
                フィードバック・不具合報告
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: 'var(--color-fg3)',
                  display: 'flex',
                }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {done ? (
              <div style={{ padding: '18px 0 6px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--color-yes-ink)',
                    marginBottom: 14,
                  }}
                >
                  <Icon name="check" size={18} color="currentColor" />
                  報告ありがとうございます！
                </div>
                <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--color-fg2)', lineHeight: 1.7 }}>
                  いただいた内容は開発の参考にさせていただきます。
                </p>
                <Button variant="primary" size="md" full onClick={close}>
                  閉じる
                </Button>
              </div>
            ) : (
              <>
                <p style={{ margin: '4px 0 16px', fontSize: 13, color: 'var(--color-fg3)', lineHeight: 1.7 }}>
                  お気づきの点・不具合をお知らせください。送信時に
                  <b style={{ color: 'var(--color-fg2)' }}>現在のページ情報（URL・イベントID・ブラウザ情報）</b>
                  を一緒に添付します。
                </p>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle} htmlFor="fb-message">
                    内容 <span style={{ color: 'var(--color-no-ink)' }}>*</span>
                  </label>
                  <textarea
                    id="fb-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={5}
                    maxLength={4000}
                    placeholder="例）締切を空に戻せませんでした／こういう機能がほしい など"
                    style={{ ...fieldInputStyle, resize: 'vertical', minHeight: 96, lineHeight: 1.6 }}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle} htmlFor="fb-category">
                    種別（任意）
                  </label>
                  <select
                    id="fb-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FeedbackCategory | '')}
                    style={fieldInputStyle}
                  >
                    <option value="">選択しない</option>
                    {CATEGORY_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle} htmlFor="fb-name">
                    お名前・連絡先（任意）
                  </label>
                  <input
                    id="fb-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    placeholder={user ? 'ひより（未入力ならDiscordの表示名）' : 'ひより（任意・匿名でもOK）'}
                    style={fieldInputStyle}
                  />
                </div>

                {error && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 12,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--color-no-ink)',
                    }}
                  >
                    <Icon name="alert-circle" size={15} color="currentColor" />
                    {error}
                  </div>
                )}

                <Button
                  variant="primary"
                  size="md"
                  full
                  disabled={message.trim().length === 0 || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? '送信中...' : '送信する'}
                </Button>
              </>
            )}
          </div>
          </div>,
          document.body,
        )}
    </>
  )
}
