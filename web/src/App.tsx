import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { getShellHint } from './auth/roles'
import { BookingPage } from './pages/BookingPage'
import { BranchPicker } from './pages/BranchPicker'
import { Callback } from './pages/Callback'
import { MyAppointments } from './pages/MyAppointments'
import { StaffDay } from './pages/StaffDay'
import { StaffSummary } from './pages/StaffSummary'
import { ClientLayout } from './layouts/ClientLayout'
import { StaffLayout } from './layouts/StaffLayout'

// A signed-out visitor on a device where staff last signed in goes to the staff
// sign-in. Everyone else sees the branch finder.
function Home() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session && getShellHint() === 'staff') return <Navigate to="/staff" replace />
  return <BranchPicker />
}

// Managers start on the summary, consultants on their day.
function StaffHome() {
  const { session } = useAuth()
  if (session?.roles.includes('manager')) return <Navigate to="/staff/summary" replace />
  return <StaffDay />
}

export default function App() {
  return (
    <Routes>
      <Route path="/callback" element={<Callback />} />
      <Route element={<StaffLayout />}>
        <Route path="/staff" element={<StaffHome />} />
        <Route path="/staff/summary" element={<StaffSummary />} />
      </Route>
      <Route element={<ClientLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/branches/:id/book" element={<BookingPage />} />
        <Route path="/appointments" element={<MyAppointments />} />
        <Route path="*" element={<p className="notice">We could not find that page.</p>} />
      </Route>
    </Routes>
  )
}
