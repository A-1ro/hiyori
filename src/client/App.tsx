import { Routes, Route } from 'react-router'
import { LandingScreen } from './pages/LandingScreen'
import { EventCreatePage } from './pages/EventCreatePage'
import { EventEditPage } from './pages/EventEditPage'
import { EventDetailPage } from './pages/EventDetailPage'
import { EventVotePage } from './pages/EventVotePage'
import { EventTallyPage } from './pages/EventTallyPage'
import { MyPage } from './pages/MyPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingScreen />} />
      <Route path="/me" element={<MyPage />} />
      <Route path="/events/new" element={<EventCreatePage />} />
      <Route path="/events/:id" element={<EventDetailPage />} />
      <Route path="/events/:id/edit" element={<EventEditPage />} />
      <Route path="/events/:id/vote" element={<EventVotePage />} />
      <Route path="/events/:id/tally" element={<EventTallyPage />} />
    </Routes>
  )
}
