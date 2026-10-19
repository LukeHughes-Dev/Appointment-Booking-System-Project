import { useAuth } from '../auth/AuthContext'

export function AccountMenu() {
  const { session, loading, signIn, signOut } = useAuth()
  if (loading) return null
  return (
    <div className="account">
      {session ? (
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
  )
}
