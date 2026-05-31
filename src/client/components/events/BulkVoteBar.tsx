import { useMemo, useState } from 'react'
import type { CandidateResponse } from '../../api/client'
import type { VoteChoice } from '../primitives'

type TimeOfDay = 'morning' | 'afternoon' | 'evening'

const WD_CHIPS: Array<{ id: number; label: string; color: string }> = [
  { id: 1, label: '月', color: 'var(--color-fg2)' },
  { id: 2, label: '火', color: 'var(--color-fg2)' },
  { id: 3, label: '水', color: 'var(--color-fg2)' },
  { id: 4, label: '木', color: 'var(--color-fg2)' },
  { id: 5, label: '金', color: 'var(--color-fg2)' },
  { id: 6, label: '土', color: 'var(--color-blue)' },
  { id: 0, label: '日', color: 'var(--color-no-ink)' },
]

const TOD_CHIPS: Array<{ id: TimeOfDay; label: string; hint: string }> = [
  { id: 'morning', label: '朝', hint: '〜12時' },
  { id: 'afternoon', label: '昼', hint: '12〜18時' },
  { id: 'evening', label: '夜', hint: '18時〜' },
]

function todOf(hour: number): TimeOfDay {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function Chip({
  active,
  accent,
  onClick,
  children,
  title,
}: {
  active: boolean
  accent?: string
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        padding: '6px 12px',
        borderRadius: 'var(--radius-pill)',
        border: active
          ? '1px solid var(--color-ink)'
          : '1px solid var(--color-border-strong)',
        background: active ? 'var(--color-ink)' : 'var(--color-surface)',
        color: active ? '#fff' : (accent ?? 'var(--color-fg2)'),
        cursor: 'pointer',
        boxShadow: active ? 'var(--shadow-xs)' : 'none',
        transition: 'all 130ms var(--ease-out)',
      }}
    >
      {children}
    </button>
  )
}

export function BulkVoteBar({
  candidates,
  onApply,
}: {
  candidates: CandidateResponse[]
  onApply: (candidateIds: string[], choice: VoteChoice) => void
}) {
  const [wd, setWd] = useState<Set<number>>(new Set())
  const [tod, setTod] = useState<Set<TimeOfDay>>(new Set())

  const targetIds = useMemo(() => {
    return candidates
      .filter((c) => {
        const dt = new Date(c.startAt)
        const wdOk = wd.size === 0 || wd.has(dt.getDay())
        const todOk = tod.size === 0 || tod.has(todOf(dt.getHours()))
        return wdOk && todOk
      })
      .map((c) => c.id)
  }, [candidates, wd, tod])

  const toggleWd = (id: number) => {
    setWd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleTod = (id: TimeOfDay) => {
    setTod((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = (choice: VoteChoice) => {
    if (targetIds.length === 0) return
    onApply(targetIds, choice)
    setWd(new Set())
    setTod(new Set())
  }

  const hasFilter = wd.size > 0 || tod.size > 0
  const targetCount = targetIds.length
  const totalCount = candidates.length

  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        marginBottom: 16,
        boxShadow: 'var(--shadow-xs)',
      }}
      aria-label="一括設定"
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--color-fg3)',
          letterSpacing: '0.04em',
          marginBottom: 10,
        }}
      >
        一括で答える
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--color-fg4)', fontWeight: 600, minWidth: 36 }}>
          曜日
        </span>
        {WD_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={wd.has(c.id)}
            accent={c.color}
            onClick={() => toggleWd(c.id)}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--color-fg4)', fontWeight: 600, minWidth: 36 }}>
          時間帯
        </span>
        {TOD_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={tod.has(c.id)}
            onClick={() => toggleTod(c.id)}
            title={c.hint}
          >
            {c.label}
            <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4, fontWeight: 500 }}>
              {c.hint}
            </span>
          </Chip>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingTop: 10,
          borderTop: '1px solid var(--separator)',
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--color-fg2)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          対象{' '}
          <b style={{ color: 'var(--color-fg1)', fontWeight: 700 }}>{targetCount}</b>
          <span style={{ color: 'var(--color-fg4)' }}>/{totalCount} 枠</span>
          {!hasFilter && (
            <span style={{ marginLeft: 6, color: 'var(--color-fg4)', fontSize: 11 }}>
              （未選択＝全部）
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => apply('yes')}
            disabled={targetCount === 0}
            title={`対象 ${targetCount} 枠を ○`}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-yes-ink)',
              background: 'var(--color-yes-soft)',
              color: 'var(--color-yes-ink)',
              cursor: targetCount === 0 ? 'default' : 'pointer',
              opacity: targetCount === 0 ? 0.4 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 15 }}>○</span> 全部
          </button>
          <button
            type="button"
            onClick={() => apply('no')}
            disabled={targetCount === 0}
            title={`対象 ${targetCount} 枠を ×`}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-no-ink)',
              background: 'var(--color-no-soft)',
              color: 'var(--color-no-ink)',
              cursor: targetCount === 0 ? 'default' : 'pointer',
              opacity: targetCount === 0 ? 0.4 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 15 }}>×</span> 全部
          </button>
        </div>
      </div>
    </section>
  )
}
