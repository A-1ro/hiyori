import { Routes, Route } from 'react-router'
import { LandingScreen } from './pages/LandingScreen'
import { EventCreatePage } from './pages/EventCreatePage'
import { EventDetailPage } from './pages/EventDetailPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingScreen />} />
      <Route path="/events/new" element={<EventCreatePage />} />
      <Route path="/events/:id" element={<EventDetailPage />} />
    </Routes>
  )
}
