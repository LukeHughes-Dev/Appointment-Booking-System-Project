import { NavLink } from 'react-router-dom'
import { AccountMenu } from './AccountMenu'

export function StaffHeader() {
  return (
    <header className="site-header">
      <div className="container header-row">
        <NavLink to="/staff" className="brand">
          Branch Appointments <span className="shell-tag">Staff</span>
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/staff" end>
            My day
          </NavLink>
        </nav>
        <AccountMenu />
      </div>
    </header>
  )
}
