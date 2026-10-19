import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function Header() {
  const { session, loading, signIn, signOut } = useAuth()
  const isConsultant = session?.roles.includes('consultant') ?? false

  return (
    <header className="site-header">
      <div className="container header-row">
        <NavLink to={isConsultant ? '/staff' : '/'} className="brand">
          Branch Appointments
        </NavLink>
        <nav aria-label="Main">
          {isConsultant ? (
            <NavLink to="/staff">My day</NavLink>
          ) : (
            <>
              <NavLink to="/" end>
                Find a branch
              </NavLink>
              <NavLink to="/appointments">My appointments</NavLink>
            </>
          )}
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
