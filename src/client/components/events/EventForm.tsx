import { useState, type CSSProperties } from 'react'
import type { $ZodIssue } from 'zod/v4/core'
import type { EventResponse } from '../../api/client'
import { Button } from '../primitives'
import { FieldError } from './FieldError'
import { CandidateListEditor, type CandidateInput } from './CandidateListEditor'

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

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-fg2)',
  marginBottom: 4,
}

const fieldStyle: CSSProperties = {
  marginBottom: 16,
}

export interface EventFormState {
  title: string
  description: string
  defaultDurationMinutes: number
  deadline: string
  timezone: string
  discordChannelId: string
  candidates: CandidateInput[]
}

export function EventForm({
  initialValues,
  onSubmit,
  submitLabel,
  isSubmitting,
  issues,
  showCandidates = true,
}: {
  initialValues?: Partial<EventFormState>
  onSubmit: (state: EventFormState) => void
  submitLabel?: string
  isSubmitting?: boolean
  issues?: $ZodIssue[]
  showCandidates?: boolean
}) {
  const [state, setState] = useState<EventFormState>({
    title: initialValues?.title ?? '',
    description: initialValues?.description ?? '',
    defaultDurationMinutes: initialValues?.defaultDurationMinutes ?? 60,
    deadline: initialValues?.deadline ?? '',
    timezone: initialValues?.timezone ?? 'Asia/Tokyo',
    discordChannelId: initialValues?.discordChannelId ?? '',
    candidates: initialValues?.candidates ?? [{ startAt: '', endAt: '' }],
  })

  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div>
      <div style={fieldStyle}>
        <label style={labelStyle}>タイトル *</label>
        <input
          type="text"
          value={state.title}
          onChange={(e) => set('title', e.target.value)}
          style={inputStyle}
          placeholder="例: 年末の打ち上げ"
        />
        <FieldError issues={issues} path={['title']} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>説明</label>
        <textarea
          value={state.description}
          onChange={(e) => set('description', e.target.value)}
          style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
          placeholder="イベントの詳細"
        />
        <FieldError issues={issues} path={['description']} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>デフォルト所要時間（分）*</label>
        <input
          type="number"
          min={1}
          max={1440}
          value={state.defaultDurationMinutes}
          onChange={(e) => set('defaultDurationMinutes', Number(e.target.value))}
          style={inputStyle}
        />
        <FieldError issues={issues} path={['defaultDurationMinutes']} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>回答締切</label>
        <input
          type="datetime-local"
          value={state.deadline}
          onChange={(e) => set('deadline', e.target.value)}
          style={inputStyle}
        />
        <FieldError issues={issues} path={['deadline']} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>タイムゾーン</label>
        <input
          type="text"
          value={state.timezone}
          onChange={(e) => set('timezone', e.target.value)}
          style={inputStyle}
          placeholder="Asia/Tokyo"
        />
        <FieldError issues={issues} path={['timezone']} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Discord チャンネル ID</label>
        <input
          type="text"
          value={state.discordChannelId}
          onChange={(e) => set('discordChannelId', e.target.value)}
          style={inputStyle}
          placeholder="任意"
        />
        <FieldError issues={issues} path={['discordChannelId']} />
      </div>

      {showCandidates && (
        <div style={fieldStyle}>
          <label style={labelStyle}>候補枠 *</label>
          <CandidateListEditor
            candidates={state.candidates}
            onChange={(candidates) => set('candidates', candidates)}
            issues={issues}
          />
        </div>
      )}

      <Button
        variant="primary"
        size="md"
        onClick={() => onSubmit(state)}
        disabled={isSubmitting}
        full
      >
        {isSubmitting ? '送信中...' : (submitLabel ?? '作成')}
      </Button>
    </div>
  )
}

export function eventResponseToFormValues(event: EventResponse): Partial<EventFormState> {
  return {
    title: event.title,
    description: event.description ?? '',
    defaultDurationMinutes: event.defaultDurationMinutes,
    deadline: event.deadline ? event.deadline.replace('Z', '').slice(0, 16) : '',
    timezone: event.timezone,
    discordChannelId: event.discordChannelId ?? '',
  }
}
