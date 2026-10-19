-- migrations/007_staff.sql
-- Links a signed-in consultant to their consultant record, and lets a consultant
-- record how an appointment went.

-- The consultant's sign-in email. Matched against the verified token, never typed in.
ALTER TABLE consultants ADD COLUMN email text;
CREATE UNIQUE INDEX consultants_email_idx ON consultants (lower(email));

-- Demo link: the fictional consultant login nomsa@example.com is Nomsa at Menlyn.
UPDATE consultants SET email = 'nomsa@example.com' WHERE name = 'Nomsa';

-- NULL means "not recorded yet".
ALTER TABLE appointments
    ADD COLUMN outcome text CHECK (outcome IN ('attended', 'no_show'));
