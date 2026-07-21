import { useState, type CSSProperties, type ReactNode } from 'react'
import hiyoriLogo from '../assets/images/hiyori-logo-trimmed.png'

type IconName =
  | 'calendar'
  | 'plus'
  | 'check'
  | 'check-circle'
  | 'clock'
  | 'link'
  | 'bell'
  | 'copy'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-right'
  | 'users'
  | 'sparkles'
  | 'trash'
  | 'share'
  | 'alert-circle'
  | 'x'

const LUCIDE: Record<IconName, string> = {
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  sparkles:
    '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4M12 2v13"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
}

export function Icon({
  name,
  size = 20,
  color = 'currentColor',
  stroke = 2,
  style,
}: {
  name: IconName
  size?: number
  color?: string
  stroke?: number
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flex: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: LUCIDE[name] }}
    />
  )
}

export function DiscordMark({ size = 20, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      style={{ display: 'block', flex: 'none' }}
      aria-hidden="true"
    >
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.3 18.3 0 0 0-5.4 0 12 12 0 0 0-.62-1.26.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.93 1.51.07.07 0 0 0-.03.03C.78 9.05-.1 13.58.33 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.29 1.23-1.99a.08.08 0 0 0-.04-.11c-.65-.25-1.27-.55-1.87-.89a.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.64-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.54-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  )
}

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src={hiyoriLogo}
      width={size}
      height={size}
      alt="Hiyori"
      style={{ display: 'block', flex: 'none' }}
    />
  )
}

export function Logo({ size = 32, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <LogoMark size={size} />
      {withWord && (
        <span
          style={{
            fontSize: size * 0.62,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          Hiy<span style={{ color: 'var(--color-blurple)' }}>o</span>ri
        </span>
      )}
    </div>
  )
}

type ButtonVariant = 'primary' | 'discord' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  iconRight,
  full,
  disabled,
  onClick,
  style,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
  icon?: ReactNode
  iconRight?: ReactNode
  full?: boolean
  disabled?: boolean
  onClick?: () => void
  style?: CSSProperties
}) {
  const [press, setPress] = useState(false)
  const [hover, setHover] = useState(false)
  const sizes = {
    sm: { padding: '8px 14px', fontSize: 13, radius: 'var(--radius-xs)', gap: 6 },
    md: { padding: '12px 20px', fontSize: 15, radius: 'var(--radius-sm)', gap: 8 },
    lg: { padding: '15px 26px', fontSize: 16, radius: 'var(--radius-md)', gap: 9 },
  }[size]
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: hover ? 'var(--color-ink-hover)' : 'var(--color-ink)',
      color: '#fff',
      boxShadow: 'var(--shadow-sm)',
      border: 'none',
    },
    discord: {
      background: hover ? 'var(--color-blurple-hover)' : 'var(--color-blurple)',
      color: '#fff',
      boxShadow: '0 1px 2px rgba(88,101,242,.4)',
      border: 'none',
    },
    secondary: {
      background: hover ? 'var(--color-gray-50)' : 'var(--color-surface)',
      color: 'var(--color-fg1)',
      border: '1px solid var(--color-border-strong)',
    },
    ghost: {
      background: hover ? 'var(--color-gray-100)' : 'transparent',
      color: 'var(--color-blue)',
      border: 'none',
    },
    danger: {
      background: hover ? 'var(--color-no-soft)' : 'transparent',
      color: 'var(--color-no-ink)',
      border: 'none',
    },
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setPress(false)
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: sizes.fontSize,
        padding: sizes.padding,
        borderRadius: sizes.radius,
        cursor: disabled ? 'default' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sizes.gap,
        width: full ? '100%' : 'auto',
        opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 130ms var(--ease-out), background 130ms var(--ease-out)',
        ...variants[variant],
        ...style,
      }}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  )
}

const AV_COLORS = ['#5865f2', '#34c759', '#ff9f0a', '#007aff', '#ff3b30', '#af52de', '#ff2d55']
export function Avatar({
  name = '?',
  kind = 'discord',
  size = 38,
  idx = 0,
}: {
  name?: string
  kind?: 'discord' | 'guest'
  size?: number
  idx?: number
}) {
  const isGuest = kind === 'guest'
  const bg = isGuest ? 'var(--color-gray-200)' : AV_COLORS[idx % AV_COLORS.length]
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color: isGuest ? 'var(--color-fg2)' : '#fff',
        fontSize: size * 0.4,
        fontWeight: 700,
        boxShadow: isGuest ? 'inset 0 0 0 1px var(--color-border-strong)' : 'none',
      }}
    >
      {name.slice(0, 1)}
    </div>
  )
}

type BadgeTone = 'neutral' | 'open' | 'confirmed' | 'discord' | 'ink'
export function Badge({
  tone = 'neutral',
  children,
  dot,
}: {
  tone?: BadgeTone
  children?: ReactNode
  dot?: boolean
}) {
  const tones: Record<BadgeTone, { bg: string; fg: string; dc: string }> = {
    neutral: { bg: 'var(--color-gray-100)', fg: 'var(--color-fg2)', dc: 'var(--color-fg3)' },
    open: { bg: 'var(--color-blue-soft)', fg: 'var(--color-blue)', dc: 'var(--color-blue)' },
    confirmed: { bg: 'var(--color-yes-soft)', fg: 'var(--color-yes-ink)', dc: 'var(--color-yes)' },
    discord: {
      bg: 'var(--color-blurple-soft)',
      fg: 'var(--color-blurple-ink)',
      dc: 'var(--color-blurple)',
    },
    ink: { bg: 'var(--color-ink)', fg: '#fff', dc: '#fff' },
  }
  const t = tones[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        padding: '5px 11px',
        borderRadius: 'var(--radius-pill)',
        background: t.bg,
        color: t.fg,
        border: tone === 'neutral' ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {dot && (
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', background: t.dc, flex: 'none' }}
        />
      )}
      {children}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-fg2)',
            marginBottom: 7,
          }}
        >
          {label}
        </label>
      )}
      {children}
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--color-fg3)', marginTop: 6 }}>{hint}</div>
      )}
    </div>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: string
}) {
  const [focus, setFocus] = useState(false)
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        fontSize: 15,
        color: 'var(--color-fg1)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 14px',
        outline: 'none',
        border: `1px solid ${focus ? 'var(--color-blue)' : 'var(--color-border-strong)'}`,
        boxShadow: focus ? 'var(--shadow-focus)' : 'none',
        transition: 'all 130ms var(--ease-out)',
      }}
    />
  )
}

export type VoteChoice = 'yes' | 'maybe' | 'no'
export const VOTE_OPTS: Array<{ key: VoteChoice; mark: string; label: string; ink: string }> = [
  { key: 'yes', mark: '○', label: '参加できる', ink: 'var(--color-yes-ink)' },
  { key: 'maybe', mark: '△', label: 'かも', ink: 'var(--color-maybe-ink)' },
  { key: 'no', mark: '×', label: '無理', ink: 'var(--color-no-ink)' },
]

export function VoteControl({
  value,
  onChange,
  size = 'md',
}: {
  value: VoteChoice | undefined
  onChange: (choice: VoteChoice) => void
  size?: 'sm' | 'md'
}) {
  const dim = size === 'sm' ? { w: 60, h: 42, mk: 17, tx: 9 } : { w: 80, h: 52, mk: 21, tx: 10 }
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--color-gray-100)',
        borderRadius: 'var(--radius-md)',
        padding: 4,
        gap: 4,
      }}
    >
      {VOTE_OPTS.map((o) => {
        const on = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              fontFamily: 'inherit',
              border: 'none',
              cursor: 'pointer',
              width: dim.w,
              height: dim.h,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              fontWeight: 600,
              background: on ? '#fff' : 'transparent',
              color: on ? o.ink : 'var(--color-fg3)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
              transform: on ? 'scale(1)' : 'scale(0.98)',
              transition: 'all 200ms var(--ease-spring)',
            }}
          >
            <span style={{ fontSize: dim.mk, lineHeight: 1 }}>{o.mark}</span>
            <span style={{ fontSize: dim.tx }}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
