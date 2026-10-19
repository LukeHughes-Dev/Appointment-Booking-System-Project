import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { userManager } from '../auth/userManager'

// The sign-in code can only be used once, and React's dev mode renders twice, so the
// exchange is started once and shared.
let exchange: ReturnType<typeof userManager.signinRedirectCallback> | null = null

export function Callback() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    exchange ??= userManager.signinRedirectCallback()
    exchange
      .then((user) => navigate(typeof user.state === 'string' ? user.state : '/', { replace: true }))
      .catch(() => setFailed(true))
      .finally(() => {
        exchange = null
      })
  }, [navigate])

  return failed ? (
    <p role="alert">We couldn&apos;t sign you in. Please go back and try again.</p>
  ) : (
    <p>Signing you in&hellip;</p>
  )
}
