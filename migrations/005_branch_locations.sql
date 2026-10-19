-- migrations/005_branch_locations.sql
-- Where each branch is, so clients can find the nearest one. Plain latitude and
-- longitude in degrees; distances are worked out with the haversine formula, so no
-- map extension is needed.
ALTER TABLE branches
    ADD COLUMN latitude  double precision CHECK (latitude  BETWEEN -90  AND 90),
    ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180);

-- Fictional branches, placed in the named areas.
UPDATE branches b SET latitude = v.lat, longitude = v.lng
FROM (VALUES
    ('Johannesburg Sandton', -26.1076, 28.0567),
    ('Cape Town Waterfront', -33.9036, 18.4204),
    ('Durban Umhlanga',      -29.7264, 31.0850),
    ('Pretoria Menlyn',      -25.7863, 28.2767),
    ('Pretoria Centurion',   -25.8603, 28.1894),
    ('Pretoria Hatfield',    -25.7487, 28.2380)
) AS v (name, lat, lng)
WHERE b.name = v.name;

ALTER TABLE branches
    ALTER COLUMN latitude  SET NOT NULL,
    ALTER COLUMN longitude SET NOT NULL;
