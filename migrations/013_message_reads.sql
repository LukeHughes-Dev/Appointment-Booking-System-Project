-- migrations/013_message_reads.sql
-- How far each side has read in an appointment's chat, so the other side's new messages can
-- be shown as "new". One row per appointment and reader; it only ever moves forward.
CREATE TABLE message_reads (
    appointment_id  bigint NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
    reader          text   NOT NULL CHECK (reader IN ('client', 'consultant')),
    last_read_id    bigint NOT NULL,
    PRIMARY KEY (appointment_id, reader)
);
