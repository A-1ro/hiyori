import { Routes, Route } from 'react-router'
import { LandingScreen } from './pages/LandingScreen'
import { EventCreatePage } from './pages/EventCreatePage'
import { EventDetailPage } from './pages/EventDetailPage'
import { EventVotePage } from './pages/EventVotePage'
import { EventTallyPage } from './pages/EventTallyPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingScreen />} />
      <Route path="/events/new" element={<EventCreatePage />} />
      <Route path="/events/:id" element={<EventDetailPage />} />
      <Route path="/events/:id/vote" element={<EventVotePage />} />
      <Route path="/events/:id/tally" element={<EventTallyPage />} />
    </Routes>
  )
}
