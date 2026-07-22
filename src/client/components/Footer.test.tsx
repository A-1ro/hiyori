import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Footer } from './Footer'
import { useMcpStatus } from '../auth/useMcpStatus'
import { DISCORD_BOT_INVITE_URL, DISCORD_BOT_INVITE_LABEL } from '../lib/discord'

// 導線スモークテスト（監査レポート 2026-07-22 H-1 対応）。
// 「フッター招待リンク消失」型の退行（リンクの存在そのものが消える）を検出する層。
// useMcpStatus はネットワークに触れるためモジュールごと差し替える（EventVotePage.test.tsx と同じ流儀）。
vi.mock('../auth/useMcpStatus', () => ({ useMcpStatus: vi.fn() }))

type McpStatusResult = ReturnType<typeof useMcpStatus>

function setMcpEnabled(enabled: boolean) {
  vi.mocked(useMcpStatus).mockReturnValue({ data: { enabled } } as McpStatusResult)
}

function renderFooter() {
  // Footer は react-router の <Link> を使うため router コンテキスト内で描画する。
  const router = createMemoryRouter([{ path: '/', element: <Footer /> }], {
    initialEntries: ['/'],
  })
  return render(<RouterProvider router={router} />)
}

describe('Footer の導線', () => {
  beforeEach(() => {
    setMcpEnabled(false)
  })

  it('Hiyori Bot 招待リンクが存在し、href と target=_blank が正しい', () => {
    renderFooter()
    const invite = screen.getByRole('link', { name: new RegExp(DISCORD_BOT_INVITE_LABEL) })
    expect(invite.getAttribute('href')).toBe(DISCORD_BOT_INVITE_URL)
    expect(invite.getAttribute('target')).toBe('_blank')
    expect(invite.getAttribute('rel')).toContain('noopener')
  })

  it('使い方・CLI・利用規約・プライバシーポリシーの各リンクが存在する', () => {
    renderFooter()
    const expected: Array<[string, string]> = [
      ['使い方', '/help'],
      ['CLI', '/help/cli'],
      ['利用規約', '/terms'],
      ['プライバシーポリシー', '/privacy'],
    ]
    for (const [name, href] of expected) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('href')).toBe(href)
    }
  })

  it('MCP 無効時は AI 連携リンクを表示しない', () => {
    setMcpEnabled(false)
    renderFooter()
    expect(screen.queryByRole('link', { name: 'AI 連携' })).toBeNull()
  })

  it('MCP 有効時は AI 連携リンクを /help/mcp へ表示する', () => {
    setMcpEnabled(true)
    renderFooter()
    const link = screen.getByRole('link', { name: 'AI 連携' })
    expect(link.getAttribute('href')).toBe('/help/mcp')
  })

  it('開発支援（Buy Me a Coffee）リンクが存在する', () => {
    renderFooter()
    const support = screen.getByRole('link', { name: 'Buy Me a Coffee で開発支援する' })
    expect(support.getAttribute('href')).toBe('https://buymeacoffee.com/a1ro')
    expect(support.getAttribute('target')).toBe('_blank')
  })
})
