import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Footer } from './Footer'

function renderFooter() {
  const router = createMemoryRouter([{ path: '/', element: <Footer /> }], {
    initialEntries: ['/'],
  })
  return render(<RouterProvider router={router} />)
}

describe('Footer の導線', () => {
  it('案内と規約を分け、使い方・GitHub・利用規約・プライバシーの4リンクを表示する', () => {
    renderFooter()
    const guidance = screen.getByRole('navigation', { name: 'ご案内' })
    const legal = screen.getByRole('navigation', { name: '規約' })
    expect(within(guidance).getAllByRole('link')).toHaveLength(2)
    expect(within(legal).getAllByRole('link')).toHaveLength(2)
    expect(within(guidance).getByRole('link', { name: '使い方' }).getAttribute('href')).toBe('/help')
    expect(within(legal).getByRole('link', { name: '利用規約' }).getAttribute('href')).toBe('/terms')
    expect(within(legal).getByRole('link', { name: 'プライバシーポリシー' }).getAttribute('href')).toBe('/privacy')
  })

  it('GitHub リポジトリを安全に別タブで開く', () => {
    renderFooter()
    const link = screen.getByRole('link', { name: 'GitHub（別タブで開きます）' })
    expect(link.getAttribute('href')).toBe('https://github.com/A-1ro/hiyori')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })
})
