-- migrations/011_break_changes.sql
-- A record of every time staff move or split a lunch break: who, when, and what the day
-- looked like before and after. Breaks are replaced as a whole day, so one row covers a change.
CREATE TABLE break_changes (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consultant_id  bigint      NOT NULL REFERENCES consultants (id),
    day            date        NOT NULL,
    changed_by     text        NOT NULL, -- the email in the verified sign-in token
    changed_at     timestamptz NOT NULL DEFAULT now(),
    before         jsonb       NOT NULL, -- e.g. [{"start":"13:00","end":"14:00"}]
    after          jsonb       NOT NULL
);

CREATE INDEX break_changes_consultant_idx ON break_changes (consultant_id, day);
