// Creates an appointment for the demo client with Nomsa that starts in about 4 minutes, so the
// 10-minute window (5 minutes before to 5 minutes after the start) is open right now. Use it to
// try the chat and Change time on both sides:
//
//   npm run demo:live
//
// Sign in as client@example.com (My appointments) and as nomsa@example.com (My day, in a
// private window). The identity provider must be running. The appointment has a fixed
// reference, so running this again replaces the last one instead of piling up.
//
// This goes straight to the database because the app itself will not book a time that is only
// 5 minutes away (a 30-minute notice keeps room for walk-ins).
import { createPool } from '../src/db.js';

const REFERENCE = 'APT-D0D0D0D0D0';

const databaseUrl = process.env.DATABASE_URL;
const issuer = process.env.OIDC_ISSUER ?? 'http://localhost:8080/realms/booking';
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

// Who the demo client is, as the identity provider says (its stable id and email).
const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'booking-cli',
    username: 'client@example.com',
    password: 'client-demo',
  }),
});
if (!response.ok) {
  console.error(`Could not sign in the demo client (${response.status}). Is the identity provider running?`);
  process.exit(1);
}
const { access_token } = (await response.json()) as { access_token: string };
const claims = JSON.parse(Buffer.from(access_token.split('.')[1]!, 'base64url').toString()) as {
  sub: string;
  email: string;
};

const pool = createPool(databaseUrl);
try {
  await pool.query('DELETE FROM appointments WHERE reference = $1', [REFERENCE]);

  const startsAt = new Date(Math.ceil((Date.now() + 4 * 60_000) / 60_000) * 60_000); // 4 minutes from now, on the minute, so the window (opens 5 minutes before) is already open
  const inserted = await pool.query(
    `INSERT INTO appointments
       (reference, branch_id, consultant_id, service_type_id, client_id, client_email, starts_at, ends_at)
     SELECT $1, br.id, c.id, s.id, $2, $3, $4::timestamptz,
            $4::timestamptz + make_interval(mins => s.duration_minutes)
     FROM branches br, consultants c, service_types s
     WHERE br.name = 'Pretoria Menlyn' AND c.name = 'Nomsa' AND s.name = 'Transact'
     RETURNING starts_at`,
    [REFERENCE, claims.sub, claims.email, startsAt.toISOString()],
  );
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' })
    .format(inserted.rows[0].starts_at);
  const closes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' })
    .format(new Date(startsAt.getTime() + 5 * 60_000));
  console.log(`Created ${REFERENCE}: Transact with Nomsa at Pretoria Menlyn, starting ${local}.`);
  console.log(`The window is open now and closes at ${closes}. Chat and Change time are available until then.`);
} catch (err) {
  if ((err as { code?: string }).code === '23P01') {
    console.error('Nomsa or the demo client already has something booked at that time. Try again in a few minutes.');
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await pool.end();
}
