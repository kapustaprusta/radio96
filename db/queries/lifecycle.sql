-- name: RecordWebhookEvent :execrows
INSERT INTO webhook_events (id, room_name, event_type, created_at)
VALUES (sqlc.arg(id), sqlc.arg(room_name), sqlc.arg(event_type), sqlc.arg(created_at))
ON CONFLICT (id) DO NOTHING;

-- name: StartRoomByName :execrows
UPDATE rooms
SET status = 'active',
    started_at = COALESCE(started_at, GREATEST(created_at, sqlc.arg(started_at)::timestamptz)),
    last_empty_at = NULL
WHERE name = sqlc.arg(name)
  AND status IN ('open', 'expired', 'active');

-- name: MarkRoomEmptyByName :execrows
UPDATE rooms
SET last_empty_at = COALESCE(last_empty_at, GREATEST(started_at, sqlc.arg(empty_at)::timestamptz))
WHERE name = sqlc.arg(name)
  AND status = 'active';

-- name: FinishIdleRoomByName :execrows
UPDATE rooms
SET status = 'finished',
    finished_at = GREATEST(started_at, sqlc.arg(now)::timestamptz)
WHERE name = sqlc.arg(name)
  AND status = 'active'
  AND last_empty_at <= sqlc.arg(now)::timestamptz - interval '10 minutes';

-- name: ExpireRoomByName :execrows
UPDATE rooms
SET status = 'expired'
WHERE name = sqlc.arg(name)
  AND status = 'open'
  AND expires_at <= sqlc.arg(now)::timestamptz;

-- name: FindLifecycleCandidates :many
SELECT name, status, expires_at, last_empty_at
FROM rooms
WHERE status IN ('open', 'active')
   OR (status = 'expired' AND expires_at >= sqlc.arg(now)::timestamptz - interval '10 minutes')
ORDER BY created_at, name;
