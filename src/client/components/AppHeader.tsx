import type { ReactNode } from 'react'
import { Logo } from './primitives'

export function AppHeader({ right, onHome }: { right?: ReactNode; onHome?: () => void }) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: 'var(--surface-frost)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--separator)',
      }}
    >
      <div style={{ cursor: onHome ? 'pointer' : 'default' }} onClick={onHome}>
        <Logo size={28} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{right}</div>
    </header>
  )
}
