package room

import (
	"context"
	"fmt"
)

type GetRoom struct {
	repository RoomRepository
	clock      Clock
}

func NewGetRoom(repository RoomRepository, clock Clock) *GetRoom {
	return &GetRoom{
		repository: repository,
		clock:      clock,
	}
}

func (useCase *GetRoom) Execute(ctx context.Context, inviteCodeValue string) (*Room, error) {
	inviteCode, err := ParseInviteCode(inviteCodeValue)
	if err != nil {
		return nil, err
	}

	foundRoom, err := useCase.repository.FindByInviteCode(ctx, inviteCode)
	if err != nil {
		return nil, fmt.Errorf("find room: %w", err)
	}

	if foundRoom == nil {
		return nil, ErrRoomNotFound
	}

	now := useCase.clock.Now()
	if foundRoom.Status() == StatusOpen && !now.Before(foundRoom.ExpiresAt()) {
		if err := foundRoom.Expire(now); err != nil {
			return nil, fmt.Errorf("expire room: %w", err)
		}

		if err := useCase.repository.Update(ctx, foundRoom); err != nil {
			return nil, fmt.Errorf("persist expired room: %w", err)
		}
	}

	return foundRoom, nil
}
