-- migrations/009_messages.sql
-- Chat between a client and their consultant, one thread per appointment.
-- Messages can only be sent while the appointment's 10-minute window is open (enforced
-- in the API); they stay readable afterwards.
CREATE TABLE messages (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id  bigint      NOT NULL REFERENCES appointments (id),
    sender          text        NOT NULL CHECK (sender IN ('client', 'consultant')),
    body            text        NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
    sent_at         timestamptz NOT NULL DEFAULT now()
);

-- Reading a thread (and polling for new messages) is always "this appointment, after id N".
CREATE INDEX messages_thread_idx ON messages (appointment_id, id);
