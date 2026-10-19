import { createContext, useContext } from 'react'

export interface Session {
  name: string
  email: string
  accessToken: string
  roles: string[] // only decides which screens to offer; the API enforces access
}

export interface AuthState {
  session: Session | null
  loading: boolean
  signIn: (returnTo?: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProvider')
  return value
}
