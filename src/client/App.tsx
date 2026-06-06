import { Routes, Route, Navigate } from 'react-router'
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

function HomeRoute() {
  const { data, isLoading } = useSession()
  // セッション確認中はちらつき防止のため何も描画しない（CSR なので元々 JS ロード待ちの空白に統合される）
  if (isLoading) return null
  // ログイン済みならランディングではなくマイページへ
  if (data?.user) return <Navigate to="/me" replace />
  return <LandingScreen />
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/me" element={<MyPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/events/new" element={<EventCreatePage />} />
      <Route path="/events/:id" element={<EventDetailPage />} />
      <Route path="/events/:id/edit" element={<EventEditPage />} />
      <Route path="/events/:id/vote" element={<EventVotePage />} />
      <Route path="/events/:id/tally" element={<EventTallyPage />} />
    </Routes>
  )
}
