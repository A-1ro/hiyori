import { useState, type CSSProperties } from 'react'
import { Button, DiscordMark, Field, Icon, Input } from '../primitives'
import { MonthCalendar, WD } from '../MonthCalendar'
import { DISCORD_BOT_INVITE_URL, DISCORD_BOT_INVITE_LABEL } from '../../lib/discord'

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 360, 480] as const
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

export interface ComposerInitial {
  title: string
  description: string
  defaultDurationMinutes: number
  deadline: string
  timezone: string
  discordChannelId: string
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
  discordChannelId?: string
  candidates: Array<{ startAt: string; endAt: string }>
}

export interface EventComposerProps {
  mode: 'create' | 'edit'
  initial?: Partial<ComposerInitial>
  presetDiscordChannelId?: string
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
    discordChannelId?: string
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
    discordChannelId: event.discordChannelId ?? '',
    dates,
    activeBands,
    customTimes: [...customSet].sort(),
    slotDur,
  }
}

export function EventComposer({
  mode,
  initial,
  presetDiscordChannelId,
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
  const [discordChannelId, setDiscordChannelId] = useState(
    initial?.discordChannelId ?? presetDiscordChannelId ?? '',
  )
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(initial?.deadline || initial?.discordChannelId || presetDiscordChannelId),
  )

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
      discordChannelId: discordChannelId.trim() || undefined,
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

        <div style={{ position: 'relative', width: 180 }}>
          <Field label="所要時間" hint="各枠の初期値（枠ごとに変更できます）">
            <button
              type="button"
              onClick={() => setDurOpen((o) => !o)}
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
              <span>{durLabel(dur)}</span>
              <Icon name="chevron-down" size={18} color="var(--color-fg4)" />
            </button>
          </Field>
          {durOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% - 18px)',
                left: 0,
                right: 0,
                zIndex: 10,
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-md)',
                padding: 6,
              }}
            >
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDur(d)
                    setDurOpen(false)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    fontSize: 15,
                    padding: '10px 12px',
                    border: 'none',
                    borderRadius: 'var(--radius-xs)',
                    cursor: 'pointer',
                    background: d === dur ? 'var(--color-ink-soft)' : 'transparent',
                    color: 'var(--color-fg1)',
                    fontWeight: d === dur ? 600 : 400,
                  }}
                >
                  {durLabel(d)}
                </button>
              ))}
            </div>
          )}
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
              タップ、または
              <b style={{ color: 'var(--color-fg2)' }}>ドラッグで範囲選択</b>
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
              {openDurSlot && (
                <div
                  onClick={() => setOpenDurSlot(null)}
                  style={{ position: 'fixed', inset: 0, zIndex: 15 }}
                />
              )}
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
                            <div
                              key={t}
                              style={{
                                position: 'relative',
                                zIndex: isOpen ? 20 : 'auto',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setOpenDurSlot(isOpen ? null : k)}
                                title="所要時間を変更"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  fontFamily: 'inherit',
                                  cursor: 'pointer',
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  color: custom
                                    ? 'var(--color-blurple-ink)'
                                    : 'var(--color-fg2)',
                                  background: custom
                                    ? 'var(--color-blurple-soft)'
                                    : 'var(--color-surface)',
                                  border: isOpen
                                    ? '1px solid var(--color-blurple-ink)'
                                    : custom
                                      ? '1px solid var(--color-blurple-border)'
                                      : '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-pill)',
                                  padding: '4px 8px 4px 11px',
                                  fontVariantNumeric: 'tabular-nums',
                                  transition: 'border-color 130ms var(--ease-out)',
                                }}
                              >
                                {t}
                                <span style={{ opacity: 0.55 }}>{durLabel(d)}</span>
                                <Icon name="chevron-down" size={13} color="currentColor" />
                              </button>
                              {isOpen && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 4px)',
                                    left: 0,
                                    zIndex: 21,
                                    background: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--color-border)',
                                    boxShadow: 'var(--shadow-md)',
                                    padding: 5,
                                    minWidth: 100,
                                  }}
                                >
                                  {DURATIONS.map((opt) => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => {
                                        setSlotDuration(ds, t, opt)
                                        setOpenDurSlot(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        textAlign: 'left',
                                        fontFamily: 'inherit',
                                        fontSize: 13.5,
                                        padding: '7px 10px',
                                        border: 'none',
                                        borderRadius: 'var(--radius-xs)',
                                        cursor: 'pointer',
                                        background:
                                          opt === d
                                            ? 'var(--color-ink-soft)'
                                            : 'transparent',
                                        color: 'var(--color-fg1)',
                                        fontWeight: opt === d ? 600 : 400,
                                        fontVariantNumeric: 'tabular-nums',
                                      }}
                                    >
                                      {durLabel(opt)}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
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

              <Field
                label="Discord チャンネル ID（任意）"
                hint="確定したらこのチャンネルに通知が流れます"
              >
                <Input
                  value={discordChannelId}
                  onChange={setDiscordChannelId}
                  placeholder="例）1234567890123456789"
                />
                <a
                  href={DISCORD_BOT_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                    fontSize: 12.5,
                    color: 'var(--color-blurple)',
                    textDecoration: 'none',
                  }}
                >
                  <DiscordMark size={13} color="var(--color-blurple)" />
                  {DISCORD_BOT_INVITE_LABEL}
                  <Icon name="arrow-right" size={12} />
                </a>
              </Field>
            </div>
          )}
        </div>
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
