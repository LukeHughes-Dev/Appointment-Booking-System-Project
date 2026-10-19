import { Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { BranchPicker } from './pages/BranchPicker'
import { Callback } from './pages/Callback'
import { BookingPage } from './pages/BookingPage'
import { AppointmentsComingNext } from './pages/ComingNext'

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="container">
        <Routes>
          <Route path="/" element={<BranchPicker />} />
          <Route path="/branches/:id/book" element={<BookingPage />} />
          <Route path="/appointments" element={<AppointmentsComingNext />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="*" element={<p className="notice">We could not find that page.</p>} />
        </Routes>
      </main>
    </>
  )
}
