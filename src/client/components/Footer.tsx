import type { CSSProperties } from 'react'
import { Link, Outlet } from 'react-router'
import { GITHUB_REPOSITORY_URL } from '../lib/project'

const linkStyle: CSSProperties = {
  color: 'var(--color-fg2)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  whiteSpace: 'nowrap',
}

// 全ページ共通。詳しい案内と開発支援は使い方ガイドにまとめる。
export function Footer() {
  return (
    <footer
      style={{
        marginTop: 40,
        paddingTop: 16,
        borderTop: '1px solid var(--color-border)',
        textAlign: 'center',
      }}
    >
      <nav
        aria-label="ご案内"
        style={{ display: 'flex', justifyContent: 'center', gap: 28, fontSize: 13 }}
      >
        <Link to="/help" style={linkStyle}>
          使い方
        </Link>
        <a
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub（別タブで開きます）"
          style={{ ...linkStyle, gap: 5 }}
        >
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>
      <nav
        aria-label="規約"
        style={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '0 20px',
          fontSize: 12,
        }}
      >
        <Link to="/terms" style={linkStyle}>
          利用規約
        </Link>
        <Link to="/privacy" style={linkStyle}>
          プライバシーポリシー
        </Link>
      </nav>
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
