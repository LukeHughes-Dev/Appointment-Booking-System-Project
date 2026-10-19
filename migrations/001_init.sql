-- migrations/001_init.sql
-- Needed so Postgres can combine "same consultant" with "overlapping time"
-- in one exclusion constraint (see appointments below).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE branches (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text NOT NULL UNIQUE,
    timezone  text NOT NULL DEFAULT 'Africa/Johannesburg'
);

-- Normal weekly trading hours, in the branch's local time.
-- No row for a weekday means the branch is closed that day (e.g. no Sunday trading).
CREATE TABLE branch_hours (
    branch_id  bigint   NOT NULL REFERENCES branches (id),
    weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- 1 = Monday ... 7 = Sunday
    opens_at   time     NOT NULL,
    closes_at  time     NOT NULL,
    PRIMARY KEY (branch_id, weekday),
    CHECK (closes_at > opens_at)
);

-- Public holidays or planned closures (e.g. a revamp). Both dates are inclusive:
-- a single-day closure has closed_from = closed_to.
-- A branch cannot have two closures that overlap.
CREATE TABLE branch_closures (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id    bigint NOT NULL REFERENCES branches (id),
    closed_from  date   NOT NULL,
    closed_to    date   NOT NULL,
    reason       text,
    CHECK (closed_to >= closed_from),
    EXCLUDE USING gist (
        branch_id WITH =,
        daterange(closed_from, closed_to, '[]') WITH &&
    )
);

-- One row per service (Savings, Transactional, Credit). The duration is the
-- fixed length of time a booking of this service blocks out.
CREATE TABLE service_types (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              text     NOT NULL UNIQUE,
    duration_minutes  smallint NOT NULL CHECK (duration_minutes > 0)
);

CREATE TABLE consultants (
    id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text    NOT NULL,
    is_active  boolean NOT NULL DEFAULT true
);

-- Which branch a consultant works at, between which dates (both inclusive).
-- valid_to NULL means "until further notice". This is how consultants are moved
-- while their branch is closed. A consultant cannot be at two branches on the same date.
CREATE TABLE consultant_assignments (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consultant_id  bigint NOT NULL REFERENCES consultants (id),
    branch_id      bigint NOT NULL REFERENCES branches (id),
    valid_from     date   NOT NULL,
    valid_to       date,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    EXCLUDE USING gist (
        consultant_id WITH =,
        daterange(valid_from, valid_to, '[]') WITH &&
    )
);

-- An appointment is the thing that blocks a consultant's time.
-- Free slots are not stored: they are worked out from branch hours minus these rows.
CREATE TABLE appointments (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference        text        NOT NULL UNIQUE,
    branch_id        bigint      NOT NULL REFERENCES branches (id), -- where the customer goes; fixed at booking time
    consultant_id    bigint      NOT NULL REFERENCES consultants (id),
    service_type_id  bigint      NOT NULL REFERENCES service_types (id),
    customer_email   text        NOT NULL,
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    status           text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),

    -- The concurrency guarantee: the same consultant can never have two booked
    -- appointments that overlap. '[)' means the end is excluded, so 10:00-11:00
    -- followed by 11:00-12:00 is allowed. Cancelled rows do not block time.
    EXCLUDE USING gist (
        consultant_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'booked')
);

-- "My appointments" looks bookings up by email.
CREATE INDEX appointments_customer_email_idx ON appointments (customer_email);
