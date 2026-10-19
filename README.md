# Appointment-Booking-System-Project
This is a repo for the SE project, to create an Appointment Booking System for clients to schedule branch appointments and communicates a simulated confirmation of the appointment

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
