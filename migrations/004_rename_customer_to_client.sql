-- migrations/004_rename_customer_to_client.sql
-- The word used for the people who book is "client". Migrations 001 and 003 are
-- left as they were applied, so this one renames what they created.
ALTER TABLE appointments RENAME COLUMN customer_id TO client_id;
ALTER TABLE appointments RENAME COLUMN customer_email TO client_email;
ALTER INDEX appointments_customer_id_idx RENAME TO appointments_client_id_idx;
ALTER INDEX appointments_customer_email_idx RENAME TO appointments_client_email_idx;
