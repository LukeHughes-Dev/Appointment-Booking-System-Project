-- migrations/008_branch_managers.sql
-- A branch manager sees only their own branch. Linked to the sign-in by email,
-- the same way consultants are (see "Staff sign-in" in the README).
-- One manager belongs to exactly one branch; a branch may have more than one manager.
CREATE TABLE branch_managers (
    branch_id  bigint NOT NULL REFERENCES branches (id),
    email      text   NOT NULL
);
CREATE UNIQUE INDEX branch_managers_email_idx ON branch_managers (lower(email));

-- Demo link: the fictional manager login manager@example.com runs Pretoria Menlyn.
INSERT INTO branch_managers (branch_id, email)
SELECT id, 'manager@example.com' FROM branches WHERE name = 'Pretoria Menlyn';
