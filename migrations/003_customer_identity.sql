-- migrations/003_customer_identity.sql
-- Appointments now belong to a signed-in customer. customer_id is the `sub` claim
-- from the identity provider's token, the stable id for that person. The email is
-- kept for the confirmation message.
ALTER TABLE appointments ADD COLUMN customer_id text;

-- Any rows that predate sign-in get a placeholder, so the column can be made NOT NULL
-- without losing them.
UPDATE appointments SET customer_id = 'legacy:' || customer_email WHERE customer_id IS NULL;

ALTER TABLE appointments ALTER COLUMN customer_id SET NOT NULL;

-- "My appointments" looks bookings up by customer.
CREATE INDEX appointments_customer_id_idx ON appointments (customer_id, starts_at);
