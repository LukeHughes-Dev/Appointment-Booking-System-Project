import { useEffect } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isStaff, setShellHint } from '../auth/roles'
import { StaffHeader } from '../components/StaffHeader'

// The frame for staff. Anyone who is not signed in as staff sees a staff sign-in
// and nothing from the client screens.
export function StaffLayout() {
  const { session, loading, signIn } = useAuth()
  const staff = isStaff(session)

  useEffect(() => {
    if (staff) setShellHint('staff')
  }, [staff])

  if (loading) return null

  return (
    <div data-shell="staff">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <StaffHeader />
      <main id="main" className="container">
        {!session ? (
          <>
            <h1>Staff sign in</h1>
            <p className="notice">Sign in with your staff account to see your appointments.</p>
            <p>
              <button type="button" className="button" onClick={() => void signIn('/staff')}>
                Sign in
              </button>
            </p>
          </>
        ) : !staff ? (
          <>
            <h1>This area is for staff</h1>
            <p className="notice">Your account does not have staff access.</p>
            <p>
              <Link to="/">Go to the client site</Link>
            </p>
          </>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
