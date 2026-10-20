# Appointment Booking System

[![CI](https://github.com/LukeHughes-Dev/Appointment-Booking-System-Project/actions/workflows/ci.yml/badge.svg)](https://github.com/LukeHughes-Dev/Appointment-Booking-System-Project/actions/workflows/ci.yml)

A system, front end and back end, for clients to schedule branch appointments. Booking, moving
or cancelling an appointment sends a simulated confirmation.

The project brief says "customers". This project says **clients**, which is the word used in
banking branches, so the code and screens use it throughout.

**Stack:** TypeScript end to end. API: Fastify 5 on Node 24 with PostgreSQL 16. Web: React 19 with
Vite. Sign-in: Keycloak (OpenID Connect). Everything runs from Docker Compose.

All people, branches and staff in the demo data are fictional.

## Run it

You need Docker (with Compose) and about 4 GB of memory for it, because Keycloak is hungry.

```
docker compose --profile app up -d --build
```

Then open **http://localhost:8081**. The first start takes a minute or two while Keycloak imports
the demo users. Stop everything with `docker compose --profile app down`; add `-v` to also
delete the data and start fresh (the schema and seed data reload on the next start).

### Demo logins

| Who | Email | Password | Sees |
| --- | --- | --- | --- |
| Client | client@example.com | client-demo | Find a branch, book, My appointments |
| Consultant | nomsa@example.com | consultant-demo | My day (the staff entry is `/staff`) |
| Branch manager | manager@example.com | manager-demo | Branch summary (Pretoria Menlyn only) |

The identity provider admin console is at http://localhost:8080 (admin / admin_dev_password).
These are local demo credentials only. Nothing here is a real secret.

### Develop with live reload

```
cp .env.example .env
docker compose up -d            # database and identity provider only
npm install
npm run dev                     # API on http://localhost:3000
cd web && npm install && npm run dev   # web app on http://localhost:5173
```

Optional demo data (both are safe to run again, and need the database and, for the second, the
identity provider):

- `npm run seed:demo` fills every branch with three weeks of past appointments (some cancelled, some
  no-shows, and the latest working day left "not recorded" for consultants to mark) and two weeks of
  upcoming ones, so every screen has something to show. Only rows for fictional `demo-` clients are touched.
- `npm run demo:live` creates one appointment for client@example.com with Nomsa that starts in about
  4 minutes, so its 10-minute window is open straight away. Sign in as the client (My appointments)
  and as nomsa@example.com in a private window to try the chat and Change time. The app will not
  book a time that close, so the script writes to the database directly.

## Build and test

```
npm run typecheck        # API types
npm test                 # API tests (need the database: docker compose up -d db)
npm run build            # compile the API to dist/
cd web
npm run lint && npm test && npm run build
```

The API tests run against the real database, because the double-booking guarantee lives in
the database and a mock would prove nothing. Tests sign their own sign-in tokens, so they need no
identity provider. GitHub Actions runs all of the above, and builds both Docker images, on every
pull request.

## What a client can do

1. **Find a branch**: the nearest branches by browser location (asked only after a click, rounded
   and never stored), or search by name.
2. **Book**: pick a service, a day and a time, and either a specific consultant or any who is free.
   Times a client already has an appointment at are greyed out, at any branch.
3. **My appointments**: see upcoming appointments, cancel, or **Change time**.
4. **Around the start time** (from 5 minutes before to 5 minutes after it) a client and their
   consultant can **chat**.

Booking, moving and cancelling each produce a simulated confirmation message, shown on screen and
logged by the API. Nothing is really sent. A real version would hand the same message to an email
or SMS service (`src/notifications.ts`).

Staff have their own screens at `/staff`; see [Staff sign-in](#staff-sign-in) and
[Staff roles and scope](#staff-roles-and-scope) below.

## Design decisions

**No double bookings, guaranteed by the database.** Checking "is this slot free?" in code and then
inserting would let two simultaneous requests both succeed. Instead PostgreSQL enforces it: an
exclusion constraint on `(consultant, time range)` for booked appointments makes the second insert
fail, and the API turns that failure into a `409`. The same kind of constraint stops one client holding two
overlapping appointments, even at different branches (`migrations/001_init.sql`, `006_client_no_overlap.sql`).
Time ranges are half-open, so 10:00 to 11:00 followed by 11:00 to 12:00 is allowed. Cancelled
appointments are kept but ignored by the constraint, so their time becomes free again.

**Slots come from data, in SQL.** Branch opening hours, closures (a date range, such as a revamp),
and which consultant works where on which dates are all tables. Slots are generated on a 15-minute
grid in the branch's own time zone, minus anything within 30 minutes of now (so walk-ins can be
helped), minus consultants who are already booked. Booking reuses the very same query, so what the
screen offers and what the API accepts can never disagree (`src/slots.ts`).

**Branch hours and lunch are data.** Opening hours, closures, the longer month-end weekday hours (the 25th
to the 1st, until 17:30) and consultants' lunch breaks are all tables, so changing them needs no code. Lunch
comes from a scheduling feed (simulated here, behind a `ScheduleProvider` interface) that is copied in every
hour; consultants can move or split their lunch on the day, which is logged and never overwritten by the
feed. A booked appointment always wins over a break, and the clash is shown to the consultant.

**The 10-minute window is one function.** `windowState()` in `src/rules.ts` is the only place that
knows the window runs from 5 minutes before the start to 5 minutes after it. The API sends each
appointment's `window` (`upcoming`, `open`, `closed`), and chat and reschedule use the same function (cancel uses the same
constants). The numbers are in one file and easy to change.

**Reschedule is the client's choice.** The client picks any day and time at the same branch for the
same service. If their consultant is not free then, the screen asks whether they would like to see
someone else, or see that consultant's next available times (which may be on another day). While
rescheduling, the appointment's own time does not block it, so moving 45 minutes into the original
slot works. The reference never changes.

**Chat uses polling, not websockets.** A chat lasts about ten minutes, so the screen asks for new
messages every three seconds (`?after=<id>`). Each side's appointment list is refreshed every five seconds and
shows "N new" on the Chat button when the other side has written something unread. The API tracks how far each
side has read (`message_reads`), and fetching the thread counts as reading it. That needs no long-lived connections and works behind any
proxy. If it ever needed to scale, server-sent events could replace it without changing the endpoints.
Messages can only be sent while the window is open; a thread stays readable afterwards.

**Sign-in is standard OpenID Connect.** The browser uses the authorization-code flow with PKCE (no
password or secret in the app), and the API verifies every token's signature, issuer, audience and
expiry. Who the client is comes from the verified token, never from the request, so one client can never
read or change another's appointment: another client's reference gets the same `404` as one that does
not exist.

**Roles are enforced on the server.** What each screen shows is a hint; the API checks the role and
limits the data in SQL (for example a branch manager's summary is limited to their own branch).

**Testable time.** The API takes its clock as a parameter, so tests fix "now" and check the window
edges and notice rules exactly.

**Colours are variables.** The whole look comes from the colour variables at the top of `web/src/index.css`
(a blue header with a red edge for clients, a darker one for staff), so changing the brand is one block of CSS.

**Small choices worth knowing.** Database ids are returned as strings (PostgreSQL `bigint` does not fit
safely in a JSON number). Dates and times are always stored in UTC and shown in the branch's time zone.

## API

An OpenAPI description is generated from the routes' own schemas and has a browsable page at
**http://localhost:3000/docs** (the raw document is at `/docs/json`). Requests that need sign-in are
marked with the Bearer token scheme.

Safe response headers are set by `@fastify/helmet`. Requests are limited per address (300 a minute,
`RATE_LIMIT_PER_MINUTE`), and requests that change something (book, move, cancel, chat, edit lunch,
record an outcome) are limited to 20 a minute. The health check is never limited. Behind nginx the
API reads the client's real address (`TRUST_PROXY=true`), so one busy client cannot lock out the rest.
There is no CORS set-up because the web app and the API share one address (the proxy).

| Method and path | Who | What |
| --- | --- | --- |
| `GET /health` | anyone | liveness |
| `GET /branches` | anyone | branches, with distance if a location is given |
| `GET /services` | anyone | what can be booked, and how long each takes |
| `GET /branches/:id/slots?date&service` | anyone | free times, with who is free |
| `POST /appointments` | client | book (a specific consultant, or any) |
| `GET /appointments` | client | my upcoming appointments, with their window state |
| `DELETE /appointments/:reference` | client | cancel |
| `GET /appointments/:reference/slots` | client | slots while moving this appointment |
| `GET /appointments/:reference/next-available` | client | a consultant's next free times |
| `POST /appointments/:reference/reschedule` | client | move to a chosen time |
| `GET`/`POST /appointments/:reference/messages` | client | chat (send only in the window) |
| `GET /staff/appointments` | consultant | my appointments, a day or all |
| `PATCH /staff/appointments/:reference/outcome` | consultant | attended or no-show |
| `GET`/`POST /staff/appointments/:reference/messages` | consultant | chat |
| `GET /staff/summary?from&to` | branch manager | counts for my branch |

## Limits and honest notes

- **"Any consultant"** picks the free consultant with the fewest appointments that day, then the
  first alphabetically, so work is spread evenly. It does not weigh how long the appointments are.
- **Rate limits are kept in the API's memory.** That is right for one API instance. With several
  instances behind a load balancer the counts would need a shared store such as Redis.
- **Walk-in rule (considered, not built).** Walk-ins are helped by consultants too. A consultant
  should not be called to a walk-in in the 5 minutes before one of their appointments starts. In
  code this would be one pure function, `isConsultantReserved(consultant, now)`, used by a walk-in
  queue the same way `windowState()` is used here. The 30-minute booking notice already keeps
  room for walk-ins.
- **The database loads its schema once.** Files in `migrations/` run only when the database volume is
  first created. After changing one, run `docker compose down -v` and start again.
- **Browser location needs HTTPS** anywhere except `localhost`.
- **Privacy.** Only what is needed is stored: the client's sign-in id and email (to show them their
  own appointments and send the confirmation) and the chat messages. Location is used in the browser
  to sort branches and is never stored.
- **Everything is fictional and simulated:** people, emails, staff and the confirmation channel.

## Staff sign-in

Consultants sign in through the same identity provider as clients. The API trusts only the
verified token, and it does two separate things with it:

- **What you may do (role).** The token carries a role such as `consultant` or `manager`.
  Locally the roles are set on the demo users in the identity provider. In a real deployment
  they would come from directory group membership (for example an AD group), mapped to the
  same role names, so the API code does not change.
- **Who you are (consultant record).** Today a consultant is linked to their record by the
  email in the token (`consultants.email`). Email is a convenient demo key, but it can change.
  The link is meant to be reviewed: a unique, stable staff identifier such as a CP number
  is a better key, because it never changes and cannot clash. Moving to it means adding that
  identifier as a claim in the token and matching on it in `consultantFor()`
  (`src/routes/staff.ts`), with a unique index on the column. Nothing else changes.

Either way the identifier must be unique, and it is always read from the verified token,
never from anything the client sends.

## Staff roles and scope

| Who | Sees | Status |
| --- | --- | --- |
| Consultant | Their own appointments (all dates, or one day), and records attended or no-show | Built |
| Branch manager | A summary of their own branch only: per consultant and a branch total | Built |
| Regional manager | The same summary across every branch in a region | Noted, not built |

A branch manager is linked to exactly one branch (`branch_managers`, matched by the email in the
verified token), and the summary query is limited to that branch on the server, not just hidden in
the screen.

**Regional and higher levels (not built).** The same idea extends upwards, to regional managers
and the roles above branch level (for example BM and BMO views). It needs a region concept
(`regions`, and `branches.region_id`) and a scope per manager (a branch, or a region) in place of
the single branch link. The summary query filters on a single branch id today. A regional view would
change that to a list of branch ids (`a.branch_id = ANY(...)`) and keep grouping by branch, as it does now.
The screens would not change much; the work is in the data model, the scope lookup and the tests
that prove one manager can never see outside their scope.
