import type { Session } from './AuthContext'

// Staff are consultants and managers. This only decides which screens to offer;
// the API checks the role on every request.
export function isStaff(session: Session | null): boolean {
  return !!session && (session.roles.includes('consultant') || session.roles.includes('manager'))
}

// A small, non-secret note kept on this device, so that opening the app root on a
// device where staff last signed in goes to the staff sign-in, not the client pages.
const KEY = 'shell'

export function getShellHint(): 'staff' | 'client' | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'staff' || value === 'client' ? value : null
  } catch {
    return null
  }
}

export function setShellHint(value: 'staff' | 'client') {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // Private mode or blocked storage: the hint is a convenience, so carry on.
  }
}

export function clearShellHint() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
