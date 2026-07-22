import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppHeader } from './AppHeader'
import { useSession, type SessionUser } from '../auth/useSession'

// AnnouncementBell 内の fetchAnnouncements（Hono RPC）は jsdom 環境で自動発火し
// 実 API に到達しないので、モックして空配列を返させる（レンダリングだけ確認する）。
vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return {
    ...actual,
    fetchAnnouncements: vi.fn(async () => ({ announcements: [] })),
  }
})

// 導線スモークテスト（監査レポート 2026-07-22 H-1 対応）。
// useSession / useLogout はマウント時の fetch と QueryClient 依存を避けるため差し替える
// （EventVotePage.test.tsx と同じ流儀）。loginUrl は純関数なので実体を使う。
vi.mock('../auth/useSession', async (importActual) => {
  const actual = await importActual<typeof import('../auth/useSession')>()
  return {
    ...actual,
    useSession: vi.fn(),
    useLogout: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

const testUser: SessionUser = {
  userId: 'u1',
  discordUserId: '12345678901234567',
  username: 'testuser',
  globalName: 'テストユーザー',
  avatar: null,
  displayName: 'テストユーザー',
}

type SessionResult = ReturnType<typeof useSession>

function setSessionUser(user: SessionUser | null) {
  vi.mocked(useSession).mockReturnValue({ data: { user } } as SessionResult)
}

function renderHeader(path = '/') {
  const router = createMemoryRouter([{ path: '*', element: <AppHeader /> }], {
    initialEntries: [path],
  })
  return render(<RouterProvider router={router} />)
}

describe('AppHeader の導線', () => {
  it('ホーム（ロゴ）リンクが常に存在する', () => {
    setSessionUser(null)
    renderHeader()
    const home = screen.getByRole('link', { name: 'ホーム' })
    expect(home.getAttribute('href')).toBe('/')
  })

  it('未ログイン時は Discord ログイン導線が returnTo 付きで存在する', () => {
    setSessionUser(null)
    renderHeader('/events/abc')
    const login = screen.getByRole('link', { name: /Discord でログイン/ })
    expect(login.getAttribute('href')).toBe(
      `/api/auth/discord?returnTo=${encodeURIComponent('/events/abc')}`,
    )
    // ログイン済み専用の導線は出ない
    expect(screen.queryByRole('button', { name: 'ログアウト' })).toBeNull()
  })

  it('ログイン時は表示名のマイページ導線とログアウトボタンが存在する', () => {
    setSessionUser(testUser)
    renderHeader()
    const me = screen.getByRole('link', { name: 'テストユーザー' })
    expect(me.getAttribute('href')).toBe('/me')
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeTruthy()
    // ログイン導線は出ない
    expect(screen.queryByRole('link', { name: /Discord でログイン/ })).toBeNull()
  })

  it('マイページ表示中は表示名がリンクではなくテキストになる', () => {
    setSessionUser(testUser)
    renderHeader('/me')
    expect(screen.queryByRole('link', { name: 'テストユーザー' })).toBeNull()
    expect(screen.getByText('テストユーザー')).toBeTruthy()
  })

  it('AnnouncementBell（お知らせ）ボタンが常に存在する', () => {
    setSessionUser(null)
    renderHeader()
    // 未ログイン時にもベルが出る（ログイン非依存の公開情報）
    expect(screen.getByRole('button', { name: 'お知らせ' })).toBeTruthy()
  })
})
