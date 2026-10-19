import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { config } from '../config'

// Sign-in uses the authorization code flow with PKCE: the browser never sees a
// password and holds no secret. The tokens live in sessionStorage, so closing the tab
// signs the client out.
export const userManager = new UserManager({
  authority: config.authority,
  client_id: config.clientId,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
})
