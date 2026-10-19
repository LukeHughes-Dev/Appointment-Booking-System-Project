-- migrations/002_seed.sql
-- Demo data. Names are fictional.
--
-- Six branches:
--   Sunday trading, spread across the country : Johannesburg Sandton, Cape Town Waterfront, Durban Umhlanga
--   Close together (Pretoria), no Sunday trading : Pretoria Menlyn, Pretoria Centurion, Pretoria Hatfield
-- Pretoria Hatfield is closed for a revamp from 2026-11-02 to 2027-01-31, and its
-- consultants work at Menlyn and Centurion while it is closed.

INSERT INTO service_types (name, duration_minutes) VALUES
    ('Save',     60),
    ('Transact', 30),
    ('Credit',   90);

INSERT INTO branches (name) VALUES
    ('Johannesburg Sandton'),
    ('Cape Town Waterfront'),
    ('Durban Umhlanga'),
    ('Pretoria Menlyn'),
    ('Pretoria Centurion'),
    ('Pretoria Hatfield');

-- Mon-Fri 08:00-17:00 and Sat 08:00-13:00 at every branch.
INSERT INTO branch_hours (branch_id, weekday, opens_at, closes_at)
SELECT b.id, d.weekday, d.opens_at, d.closes_at
FROM branches b
CROSS JOIN (VALUES
    (1, TIME '08:00', TIME '17:00'),
    (2, TIME '08:00', TIME '17:00'),
    (3, TIME '08:00', TIME '17:00'),
    (4, TIME '08:00', TIME '17:00'),
    (5, TIME '08:00', TIME '17:00'),
    (6, TIME '08:00', TIME '13:00')
) AS d (weekday, opens_at, closes_at);

-- Sunday 09:00-13:00 at the three Sunday-trading branches only.
INSERT INTO branch_hours (branch_id, weekday, opens_at, closes_at)
SELECT id, 7, TIME '09:00', TIME '13:00'
FROM branches
WHERE name IN ('Johannesburg Sandton', 'Cape Town Waterfront', 'Durban Umhlanga');

INSERT INTO branch_closures (branch_id, closed_from, closed_to, reason)
SELECT id, DATE '2026-11-02', DATE '2027-01-31', 'Planned branch revamp'
FROM branches WHERE name = 'Pretoria Hatfield';

INSERT INTO consultants (name) VALUES
    ('Thabo'), ('Lerato'),            -- Sandton
    ('Pieter'), ('Amina'),            -- Waterfront
    ('Sipho'), ('Priya'),             -- Umhlanga
    ('Nomsa'), ('Johan'),             -- Menlyn
    ('Kagiso'), ('Elmarie'),          -- Centurion
    ('Ayanda'), ('Tshepo'), ('Fatima'); -- Hatfield

-- Permanent assignments for the five branches that stay open.
INSERT INTO consultant_assignments (consultant_id, branch_id, valid_from, valid_to)
SELECT c.id, b.id, DATE '2026-01-01', NULL
FROM (VALUES
    ('Thabo',   'Johannesburg Sandton'),
    ('Lerato',  'Johannesburg Sandton'),
    ('Pieter',  'Cape Town Waterfront'),
    ('Amina',   'Cape Town Waterfront'),
    ('Sipho',   'Durban Umhlanga'),
    ('Priya',   'Durban Umhlanga'),
    ('Nomsa',   'Pretoria Menlyn'),
    ('Johan',   'Pretoria Menlyn'),
    ('Kagiso',  'Pretoria Centurion'),
    ('Elmarie', 'Pretoria Centurion')
) AS a (consultant, branch)
JOIN consultants c ON c.name = a.consultant
JOIN branches    b ON b.name = a.branch;

-- Hatfield consultants: at Hatfield before the closure, moved during it, back afterwards.
INSERT INTO consultant_assignments (consultant_id, branch_id, valid_from, valid_to)
SELECT c.id, b.id, a.valid_from, a.valid_to
FROM (VALUES
    ('Ayanda', 'Pretoria Hatfield',   DATE '2026-01-01', DATE '2026-11-01'),
    ('Ayanda', 'Pretoria Menlyn',     DATE '2026-11-02', DATE '2027-01-31'),
    ('Ayanda', 'Pretoria Hatfield',   DATE '2027-02-01', NULL),
    ('Tshepo', 'Pretoria Hatfield',   DATE '2026-01-01', DATE '2026-11-01'),
    ('Tshepo', 'Pretoria Centurion',  DATE '2026-11-02', DATE '2027-01-31'),
    ('Tshepo', 'Pretoria Hatfield',   DATE '2027-02-01', NULL),
    ('Fatima', 'Pretoria Hatfield',   DATE '2026-01-01', DATE '2026-11-01'),
    ('Fatima', 'Pretoria Menlyn',     DATE '2026-11-02', DATE '2027-01-31'),
    ('Fatima', 'Pretoria Hatfield',   DATE '2027-02-01', NULL)
) AS a (consultant, branch, valid_from, valid_to)
JOIN consultants c ON c.name = a.consultant
JOIN branches    b ON b.name = a.branch;
