DROP TABLE room_admissions;
ALTER TABLE rooms DROP CONSTRAINT rooms_last_empty_after_start;
ALTER TABLE rooms DROP COLUMN last_empty_at;
DROP INDEX rooms_active_name_idx;
DROP TABLE webhook_events;
