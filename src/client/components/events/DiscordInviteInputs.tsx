import { useRef, useState } from 'react'
import { isDiscordUsername, normalizeDiscordUsername } from '../../../shared/discord-invites'

interface InviteRow {
  key: number
  value: string
}

function trimTrailingBlanks(rows: InviteRow[]) {
  const result = [...rows]
  while (result.length > 1 && !result[result.length - 2]!.value.trim()) {
    result.splice(result.length - 2, 1)
  }
  return result
}

export function useDiscordInviteRows() {
  const [rows, setRows] = useState<InviteRow[]>([{ key: 0, value: '' }])
  const nextKey = useRef(1)

  const change = (key: number, value: string) => {
    const blankKey = nextKey.current++
    setRows((current) => {
      const updated = current.map((row) => row.key === key ? { ...row, value } : row)
      if (updated.at(-1)!.value.trim()) return [...updated, { key: blankKey, value: '' }]
      const index = updated.findIndex((row) => row.key === key)
      // Keep the row being edited as the trailing blank so clearing never loses focus.
      if (!value.trim() && updated.slice(index + 1).every((row) => !row.value.trim())) {
        return trimTrailingBlanks(updated.slice(0, index + 1))
      }
      return updated
    })
  }
  const remove = (key: number) => setRows((current) => trimTrailingBlanks(current.filter((row, index) => (
    row.key !== key || index === current.length - 1
  ))))
  const removeSubmitted = (id: string, normalize: (value: string) => string = (value) => value.trim()) => setRows((current) => trimTrailingBlanks(current.filter((row) => normalize(row.value) !== id)))
  const paste = (key: number, value: string) => {
    const values = value.split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean)
    if (!values.length) return
    const inserted = values.map((part, index) => ({ key: index === 0 ? key : nextKey.current++, value: part }))
    const blankKey = nextKey.current++
    setRows((current) => {
      const updated = current.flatMap((row) => row.key === key ? inserted : [row])
      return updated.at(-1)!.value.trim() ? [...updated, { key: blankKey, value: '' }] : updated
    })
  }

  return { rows, change, remove, removeSubmitted, paste }
}

export function DiscordInviteInputs({
  state,
  id,
  label,
  describedBy,
  disabled = false,
}: {
  state: ReturnType<typeof useDiscordInviteRows>
  id: string
  label: string
  describedBy: string
  disabled?: boolean
}) {
  const inputs = useRef(new Map<number, HTMLInputElement>())

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {state.rows.map((row, index) => {
        const last = index === state.rows.length - 1
        const invalid = Boolean(row.value.trim() && !isDiscordUsername(normalizeDiscordUsername(row.value)))
        return (
          <div
            key={row.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              ref={(input) => {
                if (input) inputs.current.set(row.key, input)
                else inputs.current.delete(row.key)
              }}
              id={index === 0 ? id : `${id}-${row.key}`}
              aria-label={index === 0 ? label : `${label} ${index + 1} 人目`}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="例）@hiyori_friend"
              value={row.value}
              onChange={(event) => state.change(row.key, event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData('text')
                if (!/[\r\n,]/.test(text)) return
                event.preventDefault()
                const input = event.currentTarget
                state.paste(row.key, row.value.slice(0, input.selectionStart ?? 0) + text + row.value.slice(input.selectionEnd ?? row.value.length))
              }}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              disabled={disabled}
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', fontFamily: 'inherit', padding: '10px 12px', fontSize: 14, border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-fg1)' }}
            />
            {!last && (
              <button
                type="button"
                aria-label={`${index + 1} 人目の入力欄を削除`}
                disabled={disabled}
                onClick={() => {
                  const next = state.rows[index + 1]!
                  inputs.current.get(next.key)?.focus()
                  state.remove(row.key)
                }}
                style={{ flexShrink: 0, fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-fg2)', cursor: disabled ? 'default' : 'pointer' }}
              >
                削除
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
