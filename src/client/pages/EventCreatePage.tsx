import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import type { $ZodIssue } from 'zod/v4/core'
import { createEvent, ApiError } from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Field, Icon, Input } from '../components/primitives'
import { MonthCalendar, WD } from '../components/MonthCalendar'

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
type BandKey = (typeof BANDS)[number]['key']

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

export function EventCreatePage() {
  const navigate = useNavigate()
  const [_issues, setIssues] = useState<$ZodIssue[] | undefined>()

  const [title, setTitle] = useState('')
  const [memo, setMemo] = useState('')
  const [dur, setDur] = useState(90)
  const [durOpen, setDurOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeBands, setActiveBands] = useState<Set<BandKey>>(new Set(['noon', 'night']))
  const [customTimes, setCustomTimes] = useState<string[]>([])
  const [customOpen, setCustomOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('20:30')
  const [slotDur, setSlotDur] = useState<Record<string, number>>({})
  const [openDurSlot, setOpenDurSlot] = useState<string | null>(null)

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

  const mutation = useMutation({
    mutationFn: () => {
      const candidates = dates.flatMap((ds) =>
        bandTimes.map((t) => buildLocalISO(ds, t, durOf(ds, t))),
      )
      return createEvent({
        title: title.trim() || '無題のイベント',
        description: memo || undefined,
        defaultDurationMinutes: dur,
        timezone: 'Asia/Tokyo',
        candidates,
      })
    },
    onSuccess: (result) => {
      navigate('/events/' + result.event.id)
    },
    onError: (err) => {
      if (err instanceof ApiError) setIssues(err.issues)
    },
  })

  return (
    <div>
      <AppHeader
        right={
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            キャンセル
          </Button>
        }
      />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          日程調整をつくる
        </h2>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--color-fg2)' }}>
          候補日を出すと、回答用のリンクができます。
        </p>

        {mutation.error && (
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
            {mutation.error.message}
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
              <label
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg2)' }}
              >
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
        </div>

        <div style={{ marginTop: 24 }}>
          <Button
            variant="primary"
            size="lg"
            full
            disabled={!valid || mutation.isPending}
            onClick={() => {
              setIssues(undefined)
              mutation.mutate()
            }}
          >
            {mutation.isPending ? '作成中...' : 'この内容でつくる'}
          </Button>
        </div>
      </main>
    </div>
  )
}
