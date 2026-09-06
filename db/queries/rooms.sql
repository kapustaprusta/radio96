-- name: CreateRoom :exec
INSERT INTO rooms (
    id,
    invite_code_hash,
    name,
    status,
    created_at,
    expires_at,
    started_at,
    finished_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(invite_code_hash),
    sqlc.arg(name),
    sqlc.arg(status),
    sqlc.arg(created_at),
    sqlc.arg(expires_at),
    sqlc.narg(started_at),
    sqlc.narg(finished_at)
);

-- name: FindRoomByInviteCodeHash :one
SELECT
    id,
    name,
    status,
    created_at,
    expires_at,
    started_at,
    finished_at
FROM rooms
WHERE invite_code_hash = sqlc.arg(invite_code_hash)
LIMIT 1;

-- name: UpdateRoom :execrows
UPDATE rooms
SET
    status = sqlc.arg(status),
    started_at = sqlc.narg(started_at),
    finished_at = sqlc.narg(finished_at)
WHERE id = sqlc.arg(id)
  AND (
      status = sqlc.arg(status)
      OR (status = 'open' AND sqlc.arg(status)::TEXT IN ('active', 'expired'))
      OR (status = 'active' AND sqlc.arg(status)::TEXT = 'finished')
  );
