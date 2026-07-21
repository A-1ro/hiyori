import { Link, Outlet } from 'react-router'
import { useMcpStatus } from '../auth/useMcpStatus'
import { DiscordMark } from './primitives'
import { DISCORD_BOT_INVITE_URL, DISCORD_BOT_INVITE_LABEL } from '../lib/discord'

const linkStyle: React.CSSProperties = {
  color: 'var(--color-fg3)',
  textDecoration: 'none',
}

// 共通フッター。ナビリンク＋控えめな開発支援リンクを 1 箇所に集約し、
// ランディングとログイン後の全ページで同じ体裁を出す。配色はテーマトークンのみ。
export function Footer() {
  const { data: mcpStatus } = useMcpStatus()
  return (
    <footer
      style={{
        marginTop: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        color: 'var(--color-fg3)',
      }}
    >
      <a
        href={DISCORD_BOT_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--color-blurple)',
          textDecoration: 'none',
        }}
      >
        <DiscordMark size={14} color="var(--color-blurple)" />
        {DISCORD_BOT_INVITE_LABEL}
      </a>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 18 }}>
        <Link to="/help" style={linkStyle}>
          使い方
        </Link>
        <Link to="/help/cli" style={linkStyle}>
          CLI
        </Link>
        {mcpStatus?.enabled && (
          <Link to="/help/mcp" style={linkStyle}>
            AI 連携
          </Link>
        )}
        <Link to="/terms" style={linkStyle}>
          利用規約
        </Link>
        <Link to="/privacy" style={linkStyle}>
          プライバシーポリシー
        </Link>
      </div>
      <a
        href="https://buymeacoffee.com/a1ro"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Buy Me a Coffee で開発支援する"
        style={linkStyle}
      >
        ☕ よろしければ開発支援をお願いします
      </a>
    </footer>
  )
}

// ログイン後ページ群をまとめる pathless layout route の要素。
// 各ページの <div> の下に共通フッターを 1 箇所定義で差し込む。
export function FooterLayout() {
  return (
    <>
      <Outlet />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 48px' }}>
        <Footer />
      </div>
    </>
  )
}
