import { NavLink } from 'react-router-dom'
import { AccountMenu } from './AccountMenu'

export function ClientHeader() {
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
        </nav>
        <AccountMenu />
      </div>
    </header>
  )
}
