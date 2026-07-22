import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Icon } from './primitives'
import { fetchAnnouncements, type AnnouncementResponse } from '../api/client'
import { linkify } from '../utils/linkify'

// 未読管理用の localStorage キー（企画書 §3.3）。
const LAST_SEEN_AT_KEY = 'hiyori:announcements:lastSeenAt'

// カテゴリバッジの表示ラベルと配色。企画書 §3.2。
const CATEGORY_META: Record<
  AnnouncementResponse['category'],
  { label: string; bg: string; fg: string }
> = {
  bug_fix: { label: '修正', bg: 'rgba(255, 138, 76, 0.14)', fg: 'var(--color-fg1)' },
  new_feature: { label: '新機能', bg: 'rgba(76, 175, 108, 0.18)', fg: 'var(--color-fg1)' },
  notice: { label: 'お知らせ', bg: 'rgba(140, 140, 140, 0.2)', fg: 'var(--color-fg1)' },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

function readLastSeenAt(): number {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_AT_KEY)
    if (!raw) return 0
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

function writeLastSeenAt(iso: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_AT_KEY, iso)
  } catch {
    // localStorage が使えない環境（プライベートブラウジング等）は無視
  }
}

// ドロップダウン位置はベルの実座標から JS で決める。
// 以前は親の `inline-flex` + `position: relative` を containing block に
// `position: absolute; right: 0` で吊っていたが、モバイル幅ではベルが
// 画面右端から数百 px 内側にあるため 360px 幅のドロップダウンが
// ビューポート左に大きくはみ出す（実機 iOS Safari で発生）。
// `position: fixed` + `getBoundingClientRect()` で右端を明示的にクリップして
// 常にビューポート内に収める。
const DROPDOWN_WIDTH = 360
const VIEWPORT_MARGIN = 12
const DROPDOWN_GAP = 6

const dropdownStyleBase: CSSProperties = {
  position: 'fixed',
  width: `min(${DROPDOWN_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
  maxHeight: '70vh',
  overflowY: 'auto',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-lg)',
  zIndex: 100,
  padding: 4,
}

const rowStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'inherit',
  color: 'var(--color-fg1)',
}

const badgeBaseStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
  marginRight: 6,
}

export function AnnouncementBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AnnouncementResponse[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lastSeenAt, setLastSeenAt] = useState<number>(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // 初回マウント時に localStorage の lastSeenAt を読む（SSR/CSR ミスマッチを避けるため useEffect 内）
  useEffect(() => {
    setLastSeenAt(readLastSeenAt())
  }, [])

  // 初回マウントとドロップダウン展開時にお知らせを取得。
  const loadItems = useCallback(async () => {
    try {
      const data = await fetchAnnouncements({ limit: 5 })
      setItems(data.announcements)
    } catch {
      // ネットワーク失敗時は静かに空扱い（ヘッダの雑音を減らす）
      setItems([])
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  // ドロップダウンを開くたびに最新化。
  useEffect(() => {
    if (open) void loadItems()
  }, [open, loadItems])

  // 外側クリック / Esc で閉じる。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // ドロップダウンの実座標を計算。ベル要素の bounding rect からビューポート
  // 相対の top/right を決め、右端は最低 VIEWPORT_MARGIN だけ余白を残して
  // クリップする。position: fixed なのでヘッダの sticky や祖先の containing
  // block 事情に影響されない。
  // useLayoutEffect で描画前に座標を確定させることで、開き直したときに前回の
  // 古い座標で一瞬レンダリングされる不具合を防ぐ。
  useLayoutEffect(() => {
    if (!open) {
      // 閉じている間は古い座標を残さない（次回開いたとき再計算まで表示しない）
      setDropdownPos(null)
      return
    }
    const update = () => {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const top = rect.bottom + DROPDOWN_GAP
      // ベルの右端に合わせる（デスクトップの通常挙動と一致）。ただし、
      // ベルがモバイル幅で画面右端から数百 px 内側にあるとき、ベル右端揃えの
      // ままだと 360px 幅のドロップダウンが左にはみ出す（今回の iOS Safari
      // 事象）ため、左端がビューポートから 12px 以内に食い込まない上限で
      // クランプする。width の実効値は CSS `min(360, layoutWidth - 24)` と
      // 一致させて JS 側でも計算する。
      // clientWidth はスクロールバーを除いた layout viewport（innerWidth は
      // スクロールバー幅を含むため、右端計算にはこちらを使う）。
      const layoutWidth = document.documentElement.clientWidth
      const width = Math.min(DROPDOWN_WIDTH, layoutWidth - VIEWPORT_MARGIN * 2)
      const maxRight = Math.max(VIEWPORT_MARGIN, layoutWidth - width - VIEWPORT_MARGIN)
      const bellRightAlign = layoutWidth - rect.right
      const right = Math.max(VIEWPORT_MARGIN, Math.min(maxRight, bellRightAlign))
      // モバイルのスクロール bounce で毎フレーム同じ値を書かないよう、
      // 値が変わっていないときは state を差し替えない（再レンダ抑止）。
      setDropdownPos((prev) => (prev && prev.top === top && prev.right === right ? prev : { top, right }))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const unreadCount = useMemo(() => {
    if (!items) return 0
    return items.filter((a) => Date.parse(a.publishedAt) > lastSeenAt).length
  }, [items, lastSeenAt])

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString()
    writeLastSeenAt(now)
    setLastSeenAt(Date.parse(now))
  }, [])

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setExpandedId(null)
    // ドロップダウンを閉じた時点で全件既読扱い（企画書 §3.3）
    markAllSeen()
  }, [markAllSeen])

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="お知らせ"
        title="お知らせ"
        onClick={() => {
          if (open) closeDropdown()
          else setOpen(true)
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 'var(--radius-sm)',
          color: unreadCount > 0 ? 'var(--color-fg1)' : 'var(--color-fg2)',
          position: 'relative',
          minWidth: 32,
          minHeight: 32,
        }}
      >
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-no-ink, #e5484d)',
              border: '2px solid var(--color-surface)',
              boxSizing: 'content-box',
            }}
          />
        )}
      </button>

      {open && dropdownPos && (
        <div
          role="dialog"
          aria-label="お知らせ一覧"
          style={{ ...dropdownStyleBase, top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px 4px',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-fg1)',
              }}
            >
              お知らせ
            </h3>
            <button
              type="button"
              onClick={markAllSeen}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-blurple-ink, var(--color-fg2))',
              }}
            >
              すべて既読にする
            </button>
          </div>

          {items === null ? (
            <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--color-fg3)' }}>
              読み込み中...
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--color-fg3)' }}>
              まだお知らせはありません
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((a) => {
                const meta = CATEGORY_META[a.category] ?? CATEGORY_META.notice
                const expanded = expandedId === a.id
                const unread = Date.parse(a.publishedAt) > lastSeenAt
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      style={{
                        ...rowStyle,
                        background: expanded ? 'var(--color-surface-hover, transparent)' : 'transparent',
                      }}
                      onClick={() => setExpandedId(expanded ? null : a.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ ...badgeBaseStyle, background: meta.bg, color: meta.fg }}>
                          {meta.label}
                        </span>
                        {unread && (
                          <span
                            role="status"
                            aria-label="未読"
                            style={{
                              display: 'inline-block',
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--color-no-ink, #e5484d)',
                              marginLeft: 2,
                            }}
                          />
                        )}
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 11,
                            color: 'var(--color-fg3)',
                          }}
                        >
                          {formatDate(a.publishedAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{a.title}</div>
                      {expanded ? (
                        <div
                          style={{
                            fontSize: 13,
                            lineHeight: 1.7,
                            color: 'var(--color-fg2)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {linkify(a.body).map((seg, i) =>
                            seg.type === 'url' ? (
                              // React が JSX 変数直渡しで href を組み立てる。scheme allowlist は
                              // linkify() 内で二重チェック済み。target="_blank" + rel は XSS/tabnabbing 対策。
                              <a
                                key={i}
                                href={seg.value}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                style={{ color: 'var(--color-blurple-ink, currentColor)' }}
                              >
                                {seg.value}
                              </a>
                            ) : (
                              <span key={i}>{seg.value}</span>
                            ),
                          )}
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 12.5,
                            lineHeight: 1.55,
                            color: 'var(--color-fg3)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {a.body}
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
