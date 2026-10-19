import type { User } from 'oidc-client-ts'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState, type Session } from './AuthContext'
import { userManager } from './userManager'

function toSession(user: User | null): Session | null {
  if (!user || user.expired) return null
  return {
    name: user.profile.name ?? user.profile.email ?? 'Signed in',
    email: user.profile.email ?? '',
    accessToken: user.access_token,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    userManager.getUser().then((user) => {
      if (!active) return
      setSession(toSession(user))
      setLoading(false)
    })
    const loaded = (user: User) => setSession(toSession(user))
    const unloaded = () => setSession(null)
    userManager.events.addUserLoaded(loaded)
    userManager.events.addUserUnloaded(unloaded)
    userManager.events.addAccessTokenExpired(unloaded)
    return () => {
      active = false
      userManager.events.removeUserLoaded(loaded)
      userManager.events.removeUserUnloaded(unloaded)
      userManager.events.removeAccessTokenExpired(unloaded)
    }
  }, [])

  const signIn = useCallback(
    (returnTo?: string) =>
      userManager.signinRedirect({ state: returnTo ?? window.location.pathname + window.location.search }),
    [],
  )
  const signOut = useCallback(() => userManager.signoutRedirect(), [])

  const value = useMemo<AuthState>(() => ({ session, loading, signIn, signOut }), [session, loading, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
