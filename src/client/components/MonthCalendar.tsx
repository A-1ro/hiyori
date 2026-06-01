import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from './primitives'

export const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

const pad2 = (n: number) => String(n).padStart(2, '0')
export const toStr = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`

const navBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 8,
  display: 'flex',
}

function MonthGrid({
  y,
  m,
  selected,
  rangeAnchor,
  onDown,
  onEnter,
  today,
  cellHeight,
}: {
  y: number
  m: number
  selected: Set<string>
  rangeAnchor: string | null
  onDown: (ds: string) => void
  onEnter: (ds: string) => void
  today: Date
  cellHeight: number
}) {
  const startWd = new Date(y, m, 1).getDay()
  const daysIn = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startWd; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(d)
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--color-fg1)',
          marginBottom: 8,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {y}年 {m + 1}月
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {WD.map((w, i) => (
          <div
            key={w}
            style={{
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 0',
              color:
                i === 0 ? 'var(--color-no-ink)' : i === 6 ? 'var(--color-blue)' : 'var(--color-fg3)',
            }}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={'b' + i} />
          const ds = toStr(y, m, d)
          const dt = new Date(y, m, d)
          const past = dt < today
          const on = selected.has(ds)
          const isAnchor = ds === rangeAnchor
          const wd = dt.getDay()
          const isToday = dt.getTime() === today.getTime()
          const base =
            wd === 0 ? 'var(--color-no-ink)' : wd === 6 ? 'var(--color-blue)' : 'var(--color-fg1)'
          const ringShadow = isAnchor
            ? 'inset 0 0 0 2px var(--color-blurple-ink)'
            : isToday && !on
              ? 'inset 0 0 0 1.5px var(--color-border-strong)'
              : 'none'
          return (
            <button
              key={ds}
              type="button"
              disabled={past}
              data-ds={ds}
              onMouseDown={() => !past && onDown(ds)}
              onMouseEnter={() => !past && onEnter(ds)}
              style={{
                fontFamily: 'inherit',
                border: 'none',
                cursor: past ? 'default' : 'pointer',
                height: cellHeight,
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                background: on
                  ? 'var(--color-ink)'
                  : isAnchor
                    ? 'var(--color-blurple-soft)'
                    : 'transparent',
                color: past
                  ? 'var(--color-fg4)'
                  : on
                    ? '#fff'
                    : isAnchor
                      ? 'var(--color-blurple-ink)'
                      : base,
                opacity: past ? 0.4 : 1,
                boxShadow: ringShadow,
                transition: 'background 130ms var(--ease-out)',
                WebkitTouchCallout: 'none',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MonthCalendar({
  selected,
  onChange,
  initialView,
}: {
  selected: Set<string>
  onChange: (next: Set<string>) => void
  initialView?: { y: number; m: number }
}) {
  const fallback = (() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })()
  const [view, setView] = useState(initialView ?? fallback)
  const [isNarrow, setIsNarrow] = useState(false)
  const [isTouchPrimary, setIsTouchPrimary] = useState(false)
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null)
  const drag = useRef<{ mode: 'add' | 'remove'; anchor: string; base: Set<string> } | null>(null)

  useEffect(() => {
    const mqNarrow = window.matchMedia('(max-width: 600px)')
    const mqTouch = window.matchMedia('(hover: none)')
    const update = () => {
      setIsNarrow(mqNarrow.matches)
      const t = mqTouch.matches
      setIsTouchPrimary(t)
      if (!t) {
        setRangeMode(false)
        setRangeAnchor(null)
      }
    }
    update()
    mqNarrow.addEventListener('change', update)
    mqTouch.addEventListener('change', update)
    return () => {
      mqNarrow.removeEventListener('change', update)
      mqTouch.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    const up = () => {
      drag.current = null
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const rangeBetween = (a: string, b: string) => {
    let lo = new Date(a)
    let hi = new Date(b)
    if (lo > hi) [lo, hi] = [hi, lo]
    const out: string[] = []
    for (const t = new Date(lo); t <= hi; t.setDate(t.getDate() + 1)) {
      out.push(toStr(t.getFullYear(), t.getMonth(), t.getDate()))
    }
    return out
  }

  const applyRange = (a: string, b: string) => {
    const ns = new Set(selected)
    rangeBetween(a, b).forEach((x) => ns.add(x))
    onChange(ns)
  }

  const handleDown = (ds: string) => {
    if (rangeMode) {
      if (rangeAnchor === null) {
        setRangeAnchor(ds)
      } else {
        applyRange(rangeAnchor, ds)
        setRangeAnchor(null)
        setRangeMode(false)
      }
      return
    }
    const mode: 'add' | 'remove' = selected.has(ds) ? 'remove' : 'add'
    drag.current = { mode, anchor: ds, base: new Set(selected) }
    const ns = new Set(selected)
    if (mode === 'add') ns.add(ds)
    else ns.delete(ds)
    onChange(ns)
  }
  const handleEnter = (ds: string) => {
    if (rangeMode) return
    if (!drag.current) return
    const { mode, anchor, base } = drag.current
    const ns = new Set(base)
    rangeBetween(anchor, ds).forEach((x) => {
      if (mode === 'add') ns.add(x)
      else ns.delete(x)
    })
    onChange(ns)
  }

  const toggleRangeMode = () => {
    setRangeMode((m) => !m)
    setRangeAnchor(null)
  }

  const next = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 }
  const cellHeight = isTouchPrimary ? 44 : 34

  const rangeBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '5px 11px',
    borderRadius: 'var(--radius-pill)',
    fontSize: 12,
    fontWeight: 700,
    background: rangeMode ? 'var(--color-blurple-ink)' : 'var(--color-surface)',
    color: rangeMode ? '#fff' : 'var(--color-fg2)',
    border: rangeMode
      ? '1px solid var(--color-blurple-ink)'
      : '1px solid var(--color-border-strong)',
    transition: 'all 130ms var(--ease-out)',
    whiteSpace: 'nowrap',
  }

  return (
    <div
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: rangeMode ? 6 : 12,
        }}
      >
        <button
          type="button"
          style={navBtn}
          onClick={() =>
            setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
          }
        >
          <Icon name="chevron-left" size={18} color="var(--color-fg2)" />
        </button>
        {isTouchPrimary ? (
          <button type="button" onClick={toggleRangeMode} style={rangeBtnStyle}>
            {rangeMode ? (
              <>
                <Icon name="check" size={13} color="#fff" />
                {rangeAnchor ? '終了日をタップ' : '開始日をタップ'}
              </>
            ) : (
              <>
                <Icon name="plus" size={13} color="var(--color-fg3)" />
                範囲モード
              </>
            )}
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--color-fg3)', fontWeight: 600 }}>
            ドラッグで範囲選択（月またぎOK）
          </span>
        )}
        <button
          type="button"
          style={navBtn}
          onClick={() =>
            setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))
          }
        >
          <Icon name="chevron-right" size={18} color="var(--color-fg2)" />
        </button>
      </div>
      {rangeMode && (
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--color-fg3)',
            textAlign: 'center',
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          {rangeAnchor
            ? '範囲の終了日をタップしてください'
            : '範囲の開始日をタップしてください（月をまたぐ範囲もOK）'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 18 }}>
        <MonthGrid
          y={view.y}
          m={view.m}
          selected={selected}
          rangeAnchor={rangeAnchor}
          onDown={handleDown}
          onEnter={handleEnter}
          today={today}
          cellHeight={cellHeight}
        />
        {!isNarrow && (
          <MonthGrid
            y={next.y}
            m={next.m}
            selected={selected}
            rangeAnchor={rangeAnchor}
            onDown={handleDown}
            onEnter={handleEnter}
            today={today}
            cellHeight={cellHeight}
          />
        )}
      </div>
    </div>
  )
}
