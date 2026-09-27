package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kapustaprusta/radio96/internal/room"
)

type AdmissionRepository struct {
	pool *pgxpool.Pool
}

func NewAdmissionRepository(pool *pgxpool.Pool) *AdmissionRepository {
	return &AdmissionRepository{pool: pool}
}

func (repository *AdmissionRepository) Reserve(ctx context.Context, roomName, identity string,
	connectedIdentities []string, expiresAt time.Time, maxParticipants int,
) error {
	if roomName == "" || identity == "" || expiresAt.IsZero() || maxParticipants <= 0 {
		return errors.New("invalid room admission")
	}

	connected := make(map[string]struct{}, len(connectedIdentities))
	for _, connectedIdentity := range connectedIdentities {
		if connectedIdentity != "" {
			connected[connectedIdentity] = struct{}{}
		}
	}

	connectedNames := make([]string, 0, len(connected))
	for connectedIdentity := range connected {
		connectedNames = append(connectedNames, connectedIdentity)
	}

	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin room admission transaction: %w", err)
	}

	defer func() { _ = transaction.Rollback(ctx) }()

	// Serialize reservations across all application instances. The LiveKit participant
	// snapshot was taken before the lock, so outstanding tokens remain in this table
	// until expiry. Connected identities are excluded from pending count but kept
	// reserved for a possible reconnect with the still-valid token.
	if _, err := transaction.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", roomName); err != nil {
		return fmt.Errorf("lock room admission: %w", err)
	}

	if _, err := transaction.Exec(ctx, `
		DELETE FROM room_admissions WHERE room_name = $1 AND expires_at <= now()
	`, roomName); err != nil {
		return fmt.Errorf("clear expired room admissions: %w", err)
	}

	var pending int
	if err := transaction.QueryRow(ctx,
		"SELECT count(*) FROM room_admissions WHERE room_name = $1 AND participant_identity <> ALL($2::text[])",
		roomName, connectedNames).Scan(&pending); err != nil {
		return fmt.Errorf("count pending room admissions: %w", err)
	}

	if len(connected)+pending >= maxParticipants {
		if err := transaction.Commit(ctx); err != nil {
			return fmt.Errorf("commit completed room admissions: %w", err)
		}

		return room.ErrRoomFull
	}

	if _, err := transaction.Exec(ctx, `
		INSERT INTO room_admissions (room_name, participant_identity, expires_at)
		VALUES ($1, $2, $3)
	`, roomName, identity, expiresAt.UTC()); err != nil {
		return fmt.Errorf("insert room admission: %w", err)
	}

	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit room admission: %w", err)
	}

	return nil
}

var _ room.AdmissionStore = (*AdmissionRepository)(nil)
