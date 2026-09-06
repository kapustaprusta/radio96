package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kapustaprusta/radio96/internal/postgres/dbgen"
	"github.com/kapustaprusta/radio96/internal/room"
)

type RoomRepository struct {
	queries *dbgen.Queries
}

func NewRoomRepository(database dbgen.DBTX) *RoomRepository {
	return &RoomRepository{
		queries: dbgen.New(database),
	}
}

func (repository *RoomRepository) Create(ctx context.Context, createdRoom *room.Room) error {
	if createdRoom == nil {
		return fmt.Errorf("create room: %w", room.ErrInvalidRoom)
	}

	inviteCode := createdRoom.InviteCode()
	if inviteCode == nil {
		return fmt.Errorf("create room: %w: invite code is required", room.ErrInvalidRoom)
	}

	err := repository.queries.CreateRoom(ctx, dbgen.CreateRoomParams{
		ID:             createdRoom.ID(),
		InviteCodeHash: inviteCode.Hash().Bytes(),
		Name:           createdRoom.Name(),
		Status:         string(createdRoom.Status()),
		CreatedAt:      requiredTimestamp(createdRoom.CreatedAt()),
		ExpiresAt:      requiredTimestamp(createdRoom.ExpiresAt()),
		StartedAt:      roomTimestamp(createdRoom.StartedAt),
		FinishedAt:     roomTimestamp(createdRoom.FinishedAt),
	})
	if err != nil {
		return fmt.Errorf("insert room: %w", err)
	}

	return nil
}

func (repository *RoomRepository) FindByInviteCode(
	ctx context.Context,
	inviteCode *room.InviteCode,
) (*room.Room, error) {
	if inviteCode == nil {
		return nil, room.ErrInvalidInviteCode
	}

	record, err := repository.queries.FindRoomByInviteCodeHash(ctx, inviteCode.Hash().Bytes())
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, room.ErrRoomNotFound
	}

	if err != nil {
		return nil, fmt.Errorf("select room by invite code hash: %w", err)
	}

	createdAt, err := timestampValue(record.CreatedAt, "created_at")
	if err != nil {
		return nil, err
	}

	expiresAt, err := timestampValue(record.ExpiresAt, "expires_at")
	if err != nil {
		return nil, err
	}

	restoredRoom, err := room.Restore(room.RestoreRoomParams{
		ID:         record.ID,
		InviteCode: inviteCode,
		Name:       record.Name,
		Status:     room.Status(record.Status),
		CreatedAt:  createdAt,
		ExpiresAt:  expiresAt,
		StartedAt:  optionalTimestampValue(record.StartedAt),
		FinishedAt: optionalTimestampValue(record.FinishedAt),
	})
	if err != nil {
		return nil, fmt.Errorf("restore room from database: %w", err)
	}

	return restoredRoom, nil
}

func (repository *RoomRepository) Update(ctx context.Context, updatedRoom *room.Room) error {
	if updatedRoom == nil {
		return fmt.Errorf("update room: %w", room.ErrInvalidRoom)
	}

	rowsAffected, err := repository.queries.UpdateRoom(ctx, dbgen.UpdateRoomParams{
		ID:         updatedRoom.ID(),
		Status:     string(updatedRoom.Status()),
		StartedAt:  roomTimestamp(updatedRoom.StartedAt),
		FinishedAt: roomTimestamp(updatedRoom.FinishedAt),
	})
	if err != nil {
		return fmt.Errorf("update room: %w", err)
	}

	if rowsAffected != 1 {
		return room.ErrConcurrentRoomUpdate
	}

	return nil
}

func requiredTimestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{
		Time:  value.UTC(),
		Valid: true,
	}
}

func roomTimestamp(getter func() (time.Time, bool)) pgtype.Timestamptz {
	value, ok := getter()
	if !ok {
		return pgtype.Timestamptz{}
	}

	return requiredTimestamp(value)
}

func timestampValue(value pgtype.Timestamptz, column string) (time.Time, error) {
	if !value.Valid {
		return time.Time{}, fmt.Errorf("%w: database column %s is null", room.ErrInvalidRoom, column)
	}

	return value.Time.UTC(), nil
}

func optionalTimestampValue(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	normalized := value.Time.UTC()

	return &normalized
}

var (
	_ room.RoomCreator    = (*RoomRepository)(nil)
	_ room.RoomRepository = (*RoomRepository)(nil)
)
