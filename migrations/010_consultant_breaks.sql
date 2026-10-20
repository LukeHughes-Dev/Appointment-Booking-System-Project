-- migrations/010_consultant_breaks.sql
-- Lunch breaks. A break blocks a consultant's time like an appointment does, so nobody can be
-- booked over it.
--
-- Breaks come from a scheduling system (simulated in this project) and are copied here by a
-- sync. Staff can then move or split a break on the day. Such a break is marked 'edited', and
-- the sync never overwrites it.
CREATE TABLE consultant_breaks (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consultant_id  bigint      NOT NULL REFERENCES consultants (id),
    day            date        NOT NULL, -- the branch's local date, which is what the sync works by
    starts_at      timestamptz NOT NULL,
    ends_at        timestamptz NOT NULL,
    source         text        NOT NULL DEFAULT 'scheduled' CHECK (source IN ('scheduled', 'edited')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),

    -- A consultant's breaks cannot overlap each other. They may overlap an appointment: an
    -- existing appointment wins, and the clash is shown to staff.
    EXCLUDE USING gist (
        consultant_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    )
);

CREATE INDEX consultant_breaks_day_idx ON consultant_breaks (consultant_id, day);
