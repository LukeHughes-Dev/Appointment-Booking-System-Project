# Web app

The React front end for the appointment booking system. See the [main README](../README.md) for how to
run the whole system.

```
npm install
npm run dev      # http://localhost:5173, forwards /api to the API on port 3000
npm test         # component tests
npm run lint
npm run build    # type check, then build into dist/
```

- `src/pages`: one file per screen (find a branch, book, My appointments, My day, branch summary).
- `src/components`: shared pieces (chat, reschedule panel, headers).
- `src/auth`: sign-in with OpenID Connect and PKCE; roles are read from the token as a display hint only.
- `src/config.ts`: where sign-in and the API live. Set `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`
  or `VITE_API_BASE` to point elsewhere.
