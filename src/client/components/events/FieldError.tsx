import type { $ZodIssue } from 'zod/v4/core'

export function FieldError({
  issues,
  path,
}: {
  issues?: $ZodIssue[]
  path: (string | number)[]
}) {
  if (!issues) return null
  const key = path.join('.')
  const msgs = issues
    .filter((issue) => {
      const issuePath = issue.path.join('.')
      return issuePath === key || (key !== '' && issuePath.startsWith(key + '.'))
    })
    .map((issue) => issue.message)
  if (msgs.length === 0) return null
  return (
    <span
      style={{
        display: 'block',
        marginTop: 4,
        fontSize: 12,
        color: 'var(--color-no-ink)',
      }}
    >
      {msgs[0]}
    </span>
  )
}
