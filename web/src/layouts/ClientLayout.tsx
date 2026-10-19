import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isStaff, setShellHint } from '../auth/roles'
import { ClientHeader } from '../components/ClientHeader'

// The frame for clients. Staff have no use for these screens, so they are sent to theirs.
export function ClientLayout() {
  const { session, loading } = useAuth()
  const staff = isStaff(session)

  useEffect(() => {
    if (session && !staff) setShellHint('client')
  }, [session, staff])

  if (loading) return null
  if (staff) return <Navigate to="/staff" replace />

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <ClientHeader />
      <main id="main" className="container">
        <Outlet />
      </main>
    </>
  )
}
