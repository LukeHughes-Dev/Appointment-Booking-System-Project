-- migrations/006_client_no_overlap.sql
-- A client cannot hold two booked appointments that overlap in time, at any branch
-- and with any consultant. Same idea as the consultant rule in 001: the database
-- refuses the second one, so two simultaneous requests cannot both succeed.
ALTER TABLE appointments
    ADD CONSTRAINT appointments_client_no_overlap
    EXCLUDE USING gist (
        client_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'booked');
