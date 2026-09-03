CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    invite_code_hash BYTEA NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,

    CONSTRAINT rooms_id_not_blank CHECK (btrim(id) <> ''),
    CONSTRAINT rooms_invite_code_hash_length CHECK (octet_length(invite_code_hash) = 32),
    CONSTRAINT rooms_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT rooms_status_valid CHECK (status IN ('open', 'active', 'finished', 'expired')),
    CONSTRAINT rooms_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT rooms_timestamps_match_status CHECK (
        (status = 'open' AND started_at IS NULL AND finished_at IS NULL)
        OR (status = 'active' AND started_at IS NOT NULL AND finished_at IS NULL)
        OR (status = 'finished' AND started_at IS NOT NULL AND finished_at IS NOT NULL)
        OR (status = 'expired' AND started_at IS NULL AND finished_at IS NULL)
    ),
    CONSTRAINT rooms_start_after_creation CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT rooms_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX rooms_open_expires_at_idx
    ON rooms (expires_at)
    WHERE status = 'open';
