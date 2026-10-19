import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { clearShellHint } from '../auth/roles'
import { AccountMenu } from './AccountMenu'

export function StaffHeader() {
  const { session } = useAuth()
  const manager = session?.roles.includes('manager') ?? false
  return (
    <header className="site-header">
      <div className="container header-row">
        <NavLink to={manager ? '/staff/summary' : '/staff'} className="brand">
          Branch Appointments <span className="shell-tag">Staff</span>
        </NavLink>
        <nav aria-label="Main">
          {manager ? (
            <NavLink to="/staff/summary">Summary</NavLink>
          ) : (
            <NavLink to="/staff" end>
              My day
            </NavLink>
          )}
        </nav>
        <AccountMenu onSignOut={clearShellHint} />
      </div>
    </header>
  )
}
