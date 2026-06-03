import { useState, type CSSProperties } from 'react'
import { Button, Field, Icon, Input } from '../primitives'
import { MonthCalendar, WD } from '../MonthCalendar'

const HOUR_OPTS = Array.from({ length: 13 }, (_, i) => i) // 0〜12 時間
const MIN_OPTS = [0, 10, 20, 30, 40, 50] // 10 分刻み
const durLabel = (m: number) =>
  m < 60
    ? `${m}分`
    : m % 60 === 0
      ? `${m / 60}時間`
      : `${Math.floor(m / 60)}時間${m % 60}分`

const BANDS = [
  { key: 'morning', label: '朝', time: '09:00' },
  { key: 'noon', label: '昼', time: '12:00' },
  { key: 'evening', label: '夕方', time: '17:00' },
  { key: 'night', label: '夜', time: '19:00' },
] as const
export type BandKey = (typeof BANDS)[number]['key']

const BAND_TIME_TO_KEY: Record<string, BandKey> = Object.fromEntries(
  BANDS.map((b) => [b.time, b.key]),
) as Record<string, BandKey>

const chipStyle = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '8px 15px',
  borderRadius: 'var(--radius-pill)',
  fontSize: 14,
  fontWeight: 600,
  background: on ? 'var(--color-ink)' : 'var(--color-surface)',
  color: on ? '#fff' : 'var(--color-fg1)',
  border: on ? '1px solid var(--color-ink)' : '1px solid var(--color-border-strong)',
  transition: 'all 130ms var(--ease-out)',
})

const dateInputStyle: CSSProperties = {
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  color: 'var(--color-fg1)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
}

const pad2 = (n: number) => String(n).padStart(2, '0')

const parseDate = (ds: string) => {
  const parts = ds.split('-').map(Number) as [number, number, number]
  return { y: parts[0], m: parts[1], d: parts[2] }
}

const fmtDate = (ds: string) => {
  const { y, m, d } = parseDate(ds)
  const dt = new Date(y, m - 1, d)
  return { md: `${m}/${d}`, wd: WD[dt.getDay()], wday: dt.getDay() }
}

const slotKey = (ds: string, t: string) => `${ds}__${t}`

const buildLocalISO = (ds: string, hhmm: string, durMin: number) => {
  const { y, m, d } = parseDate(ds)
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number]
  const start = new Date(y, m - 1, d, hh, mm, 0, 0)
  const end = new Date(start.getTime() + durMin * 60_000)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

const splitDur = (m: number) => ({ h: Math.floor(m / 60), min: m % 60 })
// 0 分はモデルの min(1) 制約に反するため、最小 10 分にクランプする。
const combineDur = (h: number, min: number) => Math.max(10, h * 60 + min)

function DurColumn({
  label,
  opts,
  active,
  fmt,
  onPick,
}: {
  label: string
  opts: readonly number[]
  active: number
  fmt: (v: number) => string
  onPick: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 60 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-fg3)',
          padding: '2px 10px 6px',
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 176,
          overflowY: 'auto',
        }}
      >
        {opts.map((o) => {
          const on = o === active
          return (
            <button
              key={o}
              type="button"
              onClick={() => onPick(o)}
              style={{
                fontFamily: 'inherit',
                fontSize: 14,
                textAlign: 'left',
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-xs)',
                cursor: 'pointer',
                background: on ? 'var(--color-ink-soft)' : 'transparent',
                color: 'var(--color-fg1)',
                fontWeight: on ? 600 : 400,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmt(o)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 時間・分を別々に選ぶ所要時間ピッカー。最終値は分単位（number）。
 * 時間は 0〜12、分は 10 分刻み。open / onToggle / onClose は
 * 親が単一オープン制御＋バックドロップを保持するために受け取る。
 */
function DurationPicker({
  value,
  onChange,
  open,
  onToggle,
  onClose,
  variant,
  prefix,
  highlight = false,
}: {
  value: number
  onChange: (m: number) => void
  open: boolean
  onToggle: () => void
  onClose: () => void
  variant: 'field' | 'pill'
  prefix?: string
  highlight?: boolean
}) {
  const { h, min } = splitDur(value)

  return (
    <div style={{ position: 'relative', zIndex: open ? 20 : undefined }}>
      {variant === 'field' ? (
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            fontSize: 15,
            color: 'var(--color-fg1)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <span>{durLabel(value)}</span>
          <Icon name="chevron-down" size={18} color="var(--color-fg4)" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          title="所要時間を変更"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'inherit',
            cursor: 'pointer',
            fontSize: 12.5,
            fontWeight: 600,
            color: highlight ? 'var(--color-blurple-ink)' : 'var(--color-fg2)',
            background: highlight ? 'var(--color-blurple-soft)' : 'var(--color-surface)',
            border: open
              ? '1px solid var(--color-blurple-ink)'
              : highlight
                ? '1px solid var(--color-blurple-border)'
                : '1px solid var(--color-border)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 8px 4px 11px',
            fontVariantNumeric: 'tabular-nums',
            transition: 'border-color 130ms var(--ease-out)',
          }}
        >
          {prefix}
          <span style={{ opacity: 0.55 }}>{durLabel(value)}</span>
          <Icon name="chevron-down" size={13} color="currentColor" />
        </button>
      )}
      {open && (
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 15 }} />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 21,
              display: 'flex',
              gap: 4,
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-md)',
              padding: 6,
            }}
          >
            <DurColumn
              label="時間"
              opts={HOUR_OPTS}
              active={h}
              fmt={(v) => String(v)}
              onPick={(v) => onChange(combineDur(v, min))}
            />
            <div style={{ width: 1, background: 'var(--color-border)', margin: '4px 0' }} />
            <DurColumn
              label="分"
              opts={MIN_OPTS}
              active={min}
              fmt={pad2}
              onPick={(v) => onChange(combineDur(h, v))}
            />
          </div>
        </>
      )}
    </div>
  )
}

export interface ComposerInitial {
  title: string
  description: string
  defaultDurationMinutes: number
  deadline: string
  timezone: string
  dates: Set<string>
  activeBands: Set<BandKey>
  customTimes: string[]
  slotDur: Record<string, number>
}

export interface ComposerPayload {
  title: string
  description?: string
  defaultDurationMinutes: number
  deadline?: string
  timezone: string
  // Discord 連携は /hiyori new スラッシュコマンド由来の HMAC 署名トークン経由のみ。
  discordChannelToken?: string
  candidates: Array<{ startAt: string; endAt: string }>
}

export interface EventComposerProps {
  mode: 'create' | 'edit'
  initial?: Partial<ComposerInitial>
  // 既にチャンネル連携済みの場合は表示用 ID（編集ページで「連携中」表記に使う）。
  linkedDiscordChannelId?: string
  // /hiyori new から渡された HMAC 署名済みトークン。指定時はチャンネル連携付きで作成。
  discordChannelToken?: string
  submitLabel: string
  submittingLabel: string
  isSubmitting: boolean
  errorMessage?: string
  onSubmit: (payload: ComposerPayload) => void
}

/**
 * 既存イベント＋候補から ComposerInitial を逆算する。
 * BANDS にマッチする時刻は band、それ以外は customTimes として復元。
 * default 所要時間と異なる候補のみ slotDur に保存（UI のハイライト用）。
 */
export function buildComposerInitial(
  event: {
    title: string
    description?: string
    defaultDurationMinutes: number
    deadline?: string
    timezone: string
  },
  candidates: ReadonlyArray<{ startAt: string; endAt: string }>,
): ComposerInitial {
  const dates = new Set<string>()
  const activeBands = new Set<BandKey>()
  const customSet = new Set<string>()
  const slotDur: Record<string, number> = {}

  for (const cand of candidates) {
    const start = new Date(cand.startAt)
    const end = new Date(cand.endAt)
    const ds = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`
    const t = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
    dates.add(ds)
    const band = BAND_TIME_TO_KEY[t]
    if (band) activeBands.add(band)
    else customSet.add(t)
    const durMin = Math.round((end.getTime() - start.getTime()) / 60000)
    if (durMin !== event.defaultDurationMinutes) {
      slotDur[slotKey(ds, t)] = durMin
    }
  }

  return {
    title: event.title,
    description: event.description ?? '',
    defaultDurationMinutes: event.defaultDurationMinutes,
    deadline: event.deadline ? event.deadline.replace('Z', '').slice(0, 16) : '',
    timezone: event.timezone,
    dates,
    activeBands,
    customTimes: [...customSet].sort(),
    slotDur,
  }
}

export function EventComposer({
  mode,
  initial,
  linkedDiscordChannelId,
  discordChannelToken,
  submitLabel,
  submittingLabel,
  isSubmitting,
  errorMessage,
  onSubmit,
}: EventComposerProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [memo, setMemo] = useState(initial?.description ?? '')
  const [dur, setDur] = useState(initial?.defaultDurationMinutes ?? 90)
  const [durOpen, setDurOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(initial?.dates ?? new Set())
  const [activeBands, setActiveBands] = useState<Set<BandKey>>(
    initial?.activeBands ?? new Set<BandKey>(['noon', 'night']),
  )
  const [customTimes, setCustomTimes] = useState<string[]>(initial?.customTimes ?? [])
  const [customOpen, setCustomOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('20:30')
  const [slotDur, setSlotDur] = useState<Record<string, number>>(initial?.slotDur ?? {})
  const [openDurSlot, setOpenDurSlot] = useState<string | null>(null)
  const [deadline, setDeadline] = useState(initial?.deadline ?? '')
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial?.deadline))

  const timezone = initial?.timezone ?? 'Asia/Tokyo'

  const durOf = (ds: string, t: string) => slotDur[slotKey(ds, t)] ?? dur
  const setSlotDuration = (ds: string, t: string, m: number) =>
    setSlotDur((s) => ({ ...s, [slotKey(ds, t)]: m }))

  const dates = [...selected].sort()
  const bandTimes = [
    ...new Set([
      ...BANDS.filter((b) => activeBands.has(b.key)).map((b) => b.time),
      ...customTimes,
    ]),
  ].sort()
  const totalSlots = dates.length * bandTimes.length
  const valid = title.trim() && dates.length > 0 && bandTimes.length > 0

  const removeDate = (ds: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.delete(ds)
      return n
    })
  const toggleBand = (k: BandKey) =>
    setActiveBands((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const addCustom = () => {
    if (customDraft) setCustomTimes((t) => [...new Set([...t, customDraft])])
  }
  const removeCustom = (t: string) => setCustomTimes((arr) => arr.filter((x) => x !== t))

  const handleSubmit = () => {
    const candidates = dates.flatMap((ds) =>
      bandTimes.map((t) => buildLocalISO(ds, t, durOf(ds, t))),
    )
    onSubmit({
      title: title.trim() || '無題のイベント',
      description: memo || undefined,
      defaultDurationMinutes: dur,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      timezone,
      discordChannelToken,
      candidates,
    })
  }

  return (
    <>
      {errorMessage && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-no-soft)',
            color: 'var(--color-no-ink)',
            fontSize: 13,
          }}
        >
          {errorMessage}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
          padding: 24,
        }}
      >
        <Field label="イベント名" hint="参加者の回答ページに表示されます">
          <Input value={title} onChange={setTitle} placeholder="例）年末の打ち上げ" />
        </Field>

        <Field label="ひとことメモ（任意）">
          <Input value={memo} onChange={setMemo} placeholder="場所や持ち物など" />
        </Field>

        <div style={{ width: 200 }}>
          <Field label="所要時間" hint="各枠の初期値（枠ごとに変更できます）">
            <DurationPicker
              variant="field"
              value={dur}
              onChange={setDur}
              open={durOpen}
              onToggle={() => setDurOpen((o) => !o)}
              onClose={() => setDurOpen(false)}
            />
          </Field>
        </div>

        <Field
          label="時間帯テンプレ"
          hint="選んだ時間帯ごとに候補をつくります（複数選択OK）"
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {BANDS.map((b) => {
              const on = activeBands.has(b.key)
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => toggleBand(b.key)}
                  style={chipStyle(on)}
                >
                  {b.label}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      opacity: 0.65,
                      marginLeft: 2,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {b.time}
                  </span>
                </button>
              )
            })}
            {customTimes.map((t) => (
              <span
                key={t}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '8px 8px 8px 14px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 14,
                  fontWeight: 600,
                  background: 'var(--color-blurple-soft)',
                  color: 'var(--color-blurple-ink)',
                  border: '1px solid var(--color-blurple-border)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeCustom(t)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-blurple-ink)',
                    display: 'flex',
                    padding: 2,
                    borderRadius: 6,
                  }}
                >
                  <Icon name="plus" size={13} style={{ transform: 'rotate(45deg)' }} />
                </button>
              </span>
            ))}
            {customOpen ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="time"
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  style={{
                    ...dateInputStyle,
                    width: 116,
                    padding: '7px 9px',
                    fontSize: 14,
                  }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    addCustom()
                    setCustomOpen(false)
                  }}
                >
                  追加
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                style={{
                  ...chipStyle(false),
                  color: 'var(--color-fg2)',
                  borderStyle: 'dashed',
                }}
              >
                <Icon name="plus" size={14} />
                カスタム
              </button>
            )}
          </div>
        </Field>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg2)' }}>
              候補日
            </label>
            <span style={{ fontSize: 12, color: 'var(--color-fg3)' }}>
              タップで選択、
              <b style={{ color: 'var(--color-fg2)' }}>範囲モード</b>でまとめて選択
            </span>
          </div>
          <MonthCalendar selected={selected} onChange={setSelected} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '14px 2px 8px',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg1)' }}>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-blurple-ink)',
                }}
              >
                {dates.length}
              </span>{' '}
              日 ×{' '}
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-blurple-ink)',
                }}
              >
                {bandTimes.length}
              </span>{' '}
              枠 ＝ 候補{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalSlots}</span> 件
            </span>
            {dates.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                すべてクリア
              </Button>
            )}
          </div>

          {dates.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '20px 0',
                fontSize: 13,
                color: 'var(--color-fg3)',
                background: 'var(--color-surface-sunken)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              カレンダーから候補日を選んでください
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dates.map((ds) => {
                const f = fmtDate(ds)
                return (
                  <div
                    key={ds}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: 'var(--color-surface-sunken)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 10px 10px 14px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--color-fg1)',
                        fontVariantNumeric: 'tabular-nums',
                        minWidth: 62,
                        flex: 'none',
                      }}
                    >
                      {f.md}{' '}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color:
                            f.wday === 0
                              ? 'var(--color-no-ink)'
                              : f.wday === 6
                                ? 'var(--color-blue)'
                                : 'var(--color-fg3)',
                        }}
                      >
                        {f.wd}
                      </span>
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        flex: 1,
                      }}
                    >
                      {bandTimes.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--color-fg4)' }}>
                          時間帯を選んでください
                        </span>
                      ) : (
                        bandTimes.map((t) => {
                          const k = slotKey(ds, t)
                          const d = durOf(ds, t)
                          const isOpen = openDurSlot === k
                          const custom = slotDur[k] != null && slotDur[k] !== dur
                          return (
                            <DurationPicker
                              key={t}
                              variant="pill"
                              prefix={t}
                              highlight={custom}
                              value={d}
                              onChange={(m) => setSlotDuration(ds, t, m)}
                              open={isOpen}
                              onToggle={() => setOpenDurSlot(isOpen ? null : k)}
                              onClose={() => setOpenDurSlot(null)}
                            />
                          )
                        })
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDate(ds)}
                      title="削除"
                      style={{
                        flex: 'none',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 7,
                        borderRadius: 8,
                        color: 'var(--color-fg4)',
                        display: 'flex',
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 18 }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-fg2)',
              padding: 0,
            }}
          >
            <Icon
              name="chevron-down"
              size={14}
              style={{
                transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 130ms var(--ease-out)',
              }}
            />
            詳細設定
          </button>

          {advancedOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
              <Field label="回答締切（任意）" hint="この日時を過ぎると投票できなくなります">
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  style={{
                    ...dateInputStyle,
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 14,
                  }}
                />
              </Field>
            </div>
          )}
        </div>

        {(discordChannelToken || linkedDiscordChannelId) && (
          <div
            style={{
              borderTop: '1px solid var(--color-border)',
              paddingTop: 14,
              fontSize: 13,
              color: 'var(--color-fg2)',
            }}
          >
            {discordChannelToken
              ? 'Discord チャンネルに連携した状態で作成します（確定時にチャンネルへ通知）。'
              : `Discord チャンネル ${linkedDiscordChannelId} と連携中。`}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <Button
          variant="primary"
          size="lg"
          full
          disabled={!valid || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </>
  )
}
