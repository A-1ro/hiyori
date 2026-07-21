import { createBrowserRouter, RouterProvider, Navigate } from 'react-router'
import { useSession } from './auth/useSession'
import { LandingScreen } from './pages/LandingScreen'
import { EventCreatePage } from './pages/EventCreatePage'
import { EventEditPage } from './pages/EventEditPage'
import { EventDetailPage } from './pages/EventDetailPage'
import { EventVotePage } from './pages/EventVotePage'
import { EventTallyPage } from './pages/EventTallyPage'
import { MyPage } from './pages/MyPage'
import { TermsPage } from './pages/TermsPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { HelpPage } from './pages/HelpPage'
import { McpGuidePage } from './pages/McpGuidePage'
import { CliGuidePage } from './pages/CliGuidePage'

function HomeRoute() {
  const { data, isLoading } = useSession()
  // セッション確認中はちらつき防止のため何も描画しない（CSR なので元々 JS ロード待ちの空白に統合される）
  if (isLoading) return null
  // ログイン済みならランディングではなくマイページへ
  if (data?.user) return <Navigate to="/me" replace />
  return <LandingScreen />
}

// データルーター。投票ページの未送信ガード（useBlocker）はデータルーター配下でのみ動くため、
// <BrowserRouter>+<Routes> ではなく createBrowserRouter を使う。ルート定義自体は従来のフラット構成のまま。
const router = createBrowserRouter([
  { path: '/', element: <HomeRoute /> },
  { path: '/me', element: <MyPage /> },
  { path: '/help', element: <HelpPage /> },
  { path: '/help/mcp', element: <McpGuidePage /> },
  { path: '/help/cli', element: <CliGuidePage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/events/new', element: <EventCreatePage /> },
  { path: '/events/:id', element: <EventDetailPage /> },
  { path: '/events/:id/edit', element: <EventEditPage /> },
  { path: '/events/:id/vote', element: <EventVotePage /> },
  { path: '/events/:id/tally', element: <EventTallyPage /> },
])

export function App() {
  return <RouterProvider router={router} />
}
