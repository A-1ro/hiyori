import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { HelpPage } from './HelpPage'
import { useMcpStatus } from '../auth/useMcpStatus'
import { DISCORD_BOT_INVITE_LABEL, DISCORD_BOT_INVITE_URL } from '../lib/discord'

vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }))
vi.mock('../auth/useMcpStatus', () => ({ useMcpStatus: vi.fn() }))
vi.mock('../auth/useSession', () => ({ useSession: () => ({ data: { user: null } }) }))

type McpStatusResult = ReturnType<typeof useMcpStatus>

function setMcpStatus(enabled: boolean | undefined) {
  vi.mocked(useMcpStatus).mockReturnValue({
    data: enabled === undefined ? undefined : { enabled },
  } as McpStatusResult)
}

function renderGuide() {
  const router = createMemoryRouter([
    { path: '/help', element: <HelpPage /> },
    { path: '/help/mcp', element: <div>MCP 接続ガイドの画面</div> },
    { path: '/help/cli', element: <div>CLI ガイドの画面</div> },
  ], { initialEntries: ['/help'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => setMcpStatus(true))

describe('使い方ガイドの導線', () => {
  it('MCP 有効時は基本操作より前に AI 連携と会話のサンプルを紹介する', () => {
    renderGuide()
    const intro = screen.getByRole('heading', { name: 'いつものAIからHiyoriを使う' })
    const basics = screen.getByRole('heading', { name: '基本の流れ' })
    expect(intro.compareDocumentPosition(basics) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    const sample = screen.getByRole('figure', { name: 'AI連携の使用例（会話のサンプル）' })
    expect(within(sample).getByText('使用例')).toBeTruthy()
    expect(within(sample).getByText('あなた')).toBeTruthy()
    expect(within(sample).getByText('AI')).toBeTruthy()
    expect(within(sample).getByText('来週の平日19時から、1時間の打ち合わせを作って。')).toBeTruthy()
    expect(within(sample).getByText('「打ち合わせ」の日程調整を作成しました。')).toBeTruthy()
  })

  it('AI の開始ボタンから専用の MCP 接続ガイドへ移動できる', async () => {
    renderGuide()
    fireEvent.click(screen.getByRole('link', { name: 'AI 連携をはじめる' }))
    expect(await screen.findByText('MCP 接続ガイドの画面')).toBeTruthy()
  })

  it.each([false, undefined])('MCP 状態が %s の場合は AI 紹介や接続リンクを表示しない', (enabled) => {
    setMcpStatus(enabled)
    renderGuide()
    expect(screen.queryByRole('region', { name: 'AI 連携' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'AI 連携をはじめる' })).toBeNull()
    expect(screen.getByRole('link', { name: /CLI（コマンドライン）ガイドを見る/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /GitHub でソースコードを見る/ })).toBeTruthy()
  })

  it('ページ内の4つの入口はそれぞれ存在する説明へ移動できる', () => {
    renderGuide()
    const nav = screen.getByRole('navigation', { name: '使い方ページ内の案内' })
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(4)
    for (const link of links) {
      const href = link.getAttribute('href')!
      expect(href.startsWith('#')).toBe(true)
      expect(document.getElementById(href.slice(1))).not.toBeNull()
    }
  })

  it('フッターから集約した Bot 招待・GitHub・開発支援を安全に別タブで開ける', () => {
    renderGuide()
    const expected: Array<[RegExp, string]> = [
      [new RegExp(DISCORD_BOT_INVITE_LABEL), DISCORD_BOT_INVITE_URL],
      [/GitHub でソースコードを見る/, 'https://github.com/A-1ro/hiyori'],
      [/開発を支援する/, 'https://buymeacoffee.com/a1ro'],
    ]
    for (const [name, href] of expected) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('href')).toBe(href)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    }
  })

  it('CLI の案内から既存の専用ガイドへ移動できる', async () => {
    renderGuide()
    fireEvent.click(screen.getByRole('link', { name: /CLI（コマンドライン）ガイドを見る/ }))
    expect(await screen.findByText('CLI ガイドの画面')).toBeTruthy()
  })
})
