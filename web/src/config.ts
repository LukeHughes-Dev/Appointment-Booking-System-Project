// Where sign-in lives and where the API is. The defaults match docker-compose and the
// Vite dev proxy; set VITE_* variables to point somewhere else.
export const config = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY ?? 'http://localhost:8080/realms/booking',
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'booking-web',
  apiBase: import.meta.env.VITE_API_BASE ?? '/api',
}
