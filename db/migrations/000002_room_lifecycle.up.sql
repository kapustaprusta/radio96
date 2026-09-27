CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT webhook_events_id_not_blank CHECK (btrim(id) <> ''),
    CONSTRAINT webhook_events_event_type_not_blank CHECK (btrim(event_type) <> '')
);

CREATE INDEX rooms_active_name_idx ON rooms (name) WHERE status = 'active';

ALTER TABLE rooms ADD COLUMN last_empty_at TIMESTAMPTZ;
ALTER TABLE rooms ADD CONSTRAINT rooms_last_empty_after_start CHECK (
    last_empty_at IS NULL OR (started_at IS NOT NULL AND last_empty_at >= started_at)
);

-- A signed token reserves a place until it expires. Connected identities are
-- counted by LiveKit instead, but their reservations remain for reconnection.
CREATE TABLE room_admissions (
    room_name TEXT NOT NULL REFERENCES rooms (name) ON DELETE CASCADE,
    participant_identity TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_name, participant_identity)
);

CREATE INDEX room_admissions_expires_at_idx ON room_admissions (expires_at);
