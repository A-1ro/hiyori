import type { CSSProperties } from 'react'
import type { $ZodIssue } from 'zod/v4/core'
import { Button, Icon } from '../primitives'
import { FieldError } from './FieldError'

export interface CandidateInput {
  startAt: string
  endAt: string
}

const inputStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-surface)',
  color: 'var(--color-fg1)',
  width: '100%',
  boxSizing: 'border-box',
}

export function CandidateListEditor({
  candidates,
  onChange,
  issues,
}: {
  candidates: CandidateInput[]
  onChange: (candidates: CandidateInput[]) => void
  issues?: $ZodIssue[]
}) {
  const add = () => {
    onChange([...candidates, { startAt: '', endAt: '' }])
  }

  const remove = (idx: number) => {
    onChange(candidates.filter((_, i) => i !== idx))
  }

  const update = (idx: number, field: keyof CandidateInput, value: string) => {
    onChange(candidates.map((c, i) => (i === idx ? { ...c, [field]: value } : c)))
  }

  return (
    <div>
      {candidates.map((cand, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <input
              type="datetime-local"
              value={cand.startAt}
              onChange={(e) => update(idx, 'startAt', e.target.value)}
              style={inputStyle}
              placeholder="開始"
            />
            <FieldError issues={issues} path={['candidates', idx, 'startAt']} />
          </div>
          <div style={{ flex: 1 }}>
            <input
              type="datetime-local"
              value={cand.endAt}
              onChange={(e) => update(idx, 'endAt', e.target.value)}
              style={inputStyle}
              placeholder="終了（省略可）"
            />
            <FieldError issues={issues} path={['candidates', idx, 'endAt']} />
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => remove(idx)}
            icon={<Icon name="trash" size={14} />}
            disabled={candidates.length <= 1}
          />
        </div>
      ))}
      <FieldError issues={issues} path={['candidates']} />
      <Button
        variant="secondary"
        size="sm"
        icon={<Icon name="plus" size={14} />}
        onClick={add}
        style={{ marginTop: 4 }}
      >
        候補枠を追加
      </Button>
    </div>
  )
}
