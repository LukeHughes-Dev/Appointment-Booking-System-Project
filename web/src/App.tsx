import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { Header } from './components/Header'
import { BranchPicker } from './pages/BranchPicker'
import { Callback } from './pages/Callback'
import { BookingPage } from './pages/BookingPage'
import { StaffDay } from './pages/StaffDay'
import { MyAppointments } from './pages/MyAppointments'

// Consultants have no use for the client screens, so their home page is My day.
function Home() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session?.roles.includes('consultant')) return <Navigate to="/staff" replace />
  return <BranchPicker />
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/branches/:id/book" element={<BookingPage />} />
          <Route path="/appointments" element={<MyAppointments />} />
          <Route path="/staff" element={<StaffDay />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="*" element={<p className="notice">We could not find that page.</p>} />
        </Routes>
      </main>
    </>
  )
}
