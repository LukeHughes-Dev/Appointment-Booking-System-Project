import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function Header() {
  const { session, loading, signIn, signOut } = useAuth()

  return (
    <header className="site-header">
      <div className="container header-row">
        <NavLink to="/" className="brand">
          Branch Appointments
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Find a branch
          </NavLink>
          <NavLink to="/appointments">My appointments</NavLink>
          {session?.roles.includes('consultant') && <NavLink to="/staff">My day</NavLink>}
        </nav>
        <div className="account">
          {loading ? null : session ? (
            <>
              <span className="who">Hi, {session.name}</span>
              <button type="button" className="button quiet" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="button" onClick={() => void signIn()}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
