-- migrations/012_trading_extensions.sql
-- Longer trading hours around month end. From day 25 of a month to day 1 of the next, branches
-- trade on weekdays until 17:30 instead of 17:00. This is data, not code, so the rule can be
-- changed, limited to some branches, or given more entries without touching the slot query.
--
-- from_day to to_day is inclusive and may run over the month end (25 to 1 means the 25th up to
-- the end of the month, then the 1st). branch_id NULL means every branch. An extension only ever
-- makes a branch close later than its normal hours for that weekday.
CREATE TABLE trading_extensions (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint   REFERENCES branches (id),
    from_day      smallint NOT NULL CHECK (from_day BETWEEN 1 AND 31),
    to_day        smallint NOT NULL CHECK (to_day BETWEEN 1 AND 31),
    weekday_from  smallint NOT NULL DEFAULT 1 CHECK (weekday_from BETWEEN 1 AND 7), -- 1 = Monday
    weekday_to    smallint NOT NULL DEFAULT 5 CHECK (weekday_to BETWEEN 1 AND 7),
    closes_at     time     NOT NULL,
    CHECK (weekday_to >= weekday_from)
);

INSERT INTO trading_extensions (branch_id, from_day, to_day, weekday_from, weekday_to, closes_at)
VALUES (NULL, 25, 1, 1, 5, TIME '17:30');
