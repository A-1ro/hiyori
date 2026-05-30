import { Avatar } from './primitives'

type Vote = 'yes' | 'maybe' | 'no'

const COLS: { d: string; w: string; best?: boolean }[] = [
  { d: '12/24', w: '水', best: true },
  { d: '12/25', w: '木' },
  { d: '12/27', w: '土' },
  { d: '12/28', w: '日' },
]
const ROWS: { n: string; k: 'discord' | 'guest'; v: Vote[] }[] = [
  { n: 'あいろ', k: 'discord', v: ['yes', 'maybe', 'yes', 'no'] },
  { n: 'たけし', k: 'discord', v: ['yes', 'yes', 'maybe', 'yes'] },
  { n: 'みか', k: 'guest', v: ['yes', 'no', 'yes', 'maybe'] },
]
const SCORES = [9, 4, 7, 4]

const MK: Record<Vote, string> = { yes: '○', maybe: '△', no: '×' }
const CELL: Record<Vote, { background: string; color: string }> = {
  yes: { background: 'var(--color-yes-soft)', color: 'var(--color-yes-ink)' },
  maybe: { background: 'var(--color-maybe-soft)', color: 'var(--color-maybe-ink)' },
  no: { background: 'var(--color-no-soft)', color: 'var(--color-no-ink)' },
}

export function MiniMatrix() {
  return (
    <table
      style={{
        borderCollapse: 'separate',
        borderSpacing: 0,
        width: '100%',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <thead>
        <tr>
          <th></th>
          {COLS.map((c) => (
            <th
              key={c.d}
              style={{
                padding: '0 0 9px',
                textAlign: 'center',
                background: c.best ? 'var(--color-yes-soft)' : 'transparent',
                borderRadius: '10px 10px 0 0',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-fg2)' }}>{c.d}</div>
              <div style={{ fontSize: 10, color: 'var(--color-fg4)', fontWeight: 500 }}>{c.w}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r, ri) => (
          <tr key={r.n}>
            <td
              style={{
                textAlign: 'left',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-fg2)',
                padding: '5px 12px 5px 2px',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Avatar name={r.n} kind={r.k} size={22} idx={ri} />
                {r.n}
              </span>
            </td>
            {r.v.map((v, ci) => (
              <td
                key={ci}
                style={{
                  textAlign: 'center',
                  height: 34,
                  background: COLS[ci]?.best ? 'var(--color-yes-soft)' : 'transparent',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 700,
                    ...CELL[v],
                  }}
                >
                  {MK[v]}
                </span>
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <td
            style={{
              textAlign: 'left',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-fg1)',
              padding: '9px 12px 0 2px',
            }}
          >
            スコア
          </td>
          {SCORES.map((s, ci) => {
            const best = COLS[ci]?.best
            return (
            <td
              key={ci}
              style={{
                textAlign: 'center',
                paddingTop: 9,
                background: best ? 'var(--color-yes-soft)' : 'transparent',
                borderRadius: '0 0 10px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: best ? 'var(--color-yes-ink)' : 'var(--color-fg1)',
                }}
              >
                {s}
              </div>
              {best && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--color-yes-ink)',
                    fontWeight: 700,
                    marginTop: 2,
                  }}
                >
                  ★ 最有力
                </div>
              )}
            </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  )
}
