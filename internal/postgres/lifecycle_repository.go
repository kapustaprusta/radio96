package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kapustaprusta/radio96/internal/postgres/dbgen"
	"github.com/kapustaprusta/radio96/internal/room"
)

const reconcileLockKey int64 = 0x726164696f3936 // radio96

type LifecycleRepository struct {
	pool *pgxpool.Pool
}

func NewLifecycleRepository(pool *pgxpool.Pool) *LifecycleRepository {
	return &LifecycleRepository{pool: pool}
}

func (repository *LifecycleRepository) ApplyEvent(ctx context.Context, event room.LifecycleEvent) error {
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin lifecycle event transaction: %w", err)
	}

	defer func() { _ = transaction.Rollback(ctx) }()

	queries := dbgen.New(transaction)
	inserted, err := queries.RecordWebhookEvent(ctx, dbgen.RecordWebhookEventParams{
		ID: event.ID, RoomName: event.RoomName, EventType: event.Type, CreatedAt: requiredTimestamp(event.At),
	})
	if err != nil {
		return fmt.Errorf("record webhook event: %w", err)
	}

	if inserted != 0 {
		if event.Type == "participant_left" && event.ParticipantIdentity != "" {
			if _, err := transaction.Exec(ctx, `DELETE FROM room_admissions
				WHERE room_name = $1 AND participant_identity = $2`, event.RoomName, event.ParticipantIdentity); err != nil {
				return fmt.Errorf("release departing participant admission: %w", err)
			}
		}

		switch event.Action {
		case room.LifecycleStart:
			_, err = queries.StartRoomByName(ctx, dbgen.StartRoomByNameParams{
				Name: event.RoomName, StartedAt: requiredTimestamp(event.At),
			})
		case room.LifecycleIdle:
			_, err = queries.MarkRoomEmptyByName(ctx, dbgen.MarkRoomEmptyByNameParams{
				Name: event.RoomName, EmptyAt: requiredTimestamp(event.At),
			})
		case room.LifecycleIgnore:
		}

		if err != nil {
			return fmt.Errorf("apply webhook room transition: %w", err)
		}
	}

	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit lifecycle event: %w", err)
	}

	return nil
}

func (repository *LifecycleRepository) Candidates(ctx context.Context, now time.Time) ([]room.LifecycleCandidate, error) {
	records, err := dbgen.New(repository.pool).FindLifecycleCandidates(ctx, requiredTimestamp(now))
	if err != nil {
		return nil, fmt.Errorf("find lifecycle candidates: %w", err)
	}

	candidates := make([]room.LifecycleCandidate, 0, len(records))
	for _, record := range records {
		expiresAt, err := timestampValue(record.ExpiresAt, "expires_at")
		if err != nil {
			return nil, err
		}

		candidates = append(candidates, room.LifecycleCandidate{
			Name: record.Name, Status: room.Status(record.Status), ExpiresAt: expiresAt,
			LastEmptyAt: optionalTimestampOrZero(record.LastEmptyAt),
		})
	}

	return candidates, nil
}

func (repository *LifecycleRepository) CleanupExpiredAdmissions(ctx context.Context, now time.Time) error {
	_, err := repository.pool.Exec(ctx, "DELETE FROM room_admissions WHERE expires_at <= $1", now.UTC())
	if err != nil {
		return fmt.Errorf("delete expired room admissions: %w", err)
	}

	return nil
}

func (repository *LifecycleRepository) Start(ctx context.Context, name string, at time.Time) error {
	_, err := dbgen.New(repository.pool).StartRoomByName(ctx, dbgen.StartRoomByNameParams{
		Name: name, StartedAt: requiredTimestamp(at),
	})
	return err
}

func (repository *LifecycleRepository) Idle(ctx context.Context, name string, at time.Time) error {
	_, err := dbgen.New(repository.pool).MarkRoomEmptyByName(ctx, dbgen.MarkRoomEmptyByNameParams{
		Name: name, EmptyAt: requiredTimestamp(at),
	})
	return err
}

func (repository *LifecycleRepository) Finish(ctx context.Context, name string, at time.Time) error {
	_, err := dbgen.New(repository.pool).FinishIdleRoomByName(ctx, dbgen.FinishIdleRoomByNameParams{
		Name: name, Now: requiredTimestamp(at),
	})
	return err
}

func (repository *LifecycleRepository) Expire(ctx context.Context, name string, at time.Time) error {
	_, err := dbgen.New(repository.pool).ExpireRoomByName(ctx, dbgen.ExpireRoomByNameParams{
		Name: name, Now: requiredTimestamp(at),
	})
	return err
}

func (repository *LifecycleRepository) TryReconcileLock(ctx context.Context) (func(context.Context), bool, error) {
	connection, err := repository.pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}

	var acquired bool
	if err := connection.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", reconcileLockKey).Scan(&acquired); err != nil {
		connection.Release()
		return nil, false, err
	}

	if !acquired {
		connection.Release()
		return nil, false, nil
	}

	release := func(releaseCtx context.Context) {
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(releaseCtx), 5*time.Second)
		defer cancel()
		if _, err := connection.Exec(unlockCtx, "SELECT pg_advisory_unlock($1)", reconcileLockKey); err != nil {
			_ = connection.Hijack().Close(unlockCtx)
			return
		}

		connection.Release()
	}

	return release, true, nil
}

var _ room.LifecycleStore = (*LifecycleRepository)(nil)
