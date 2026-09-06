package room

import (
	"context"
	"fmt"
)

type CreateRoom struct {
	repository          RoomCreator
	clock               Clock
	roomIDGenerator     IDGenerator
	inviteCodeGenerator InviteCodeGenerator
}

func NewCreateRoom(
	repository RoomCreator,
	clock Clock,
	roomIDGenerator IDGenerator,
	inviteCodeGenerator InviteCodeGenerator,
) *CreateRoom {
	return &CreateRoom{
		repository:          repository,
		clock:               clock,
		roomIDGenerator:     roomIDGenerator,
		inviteCodeGenerator: inviteCodeGenerator,
	}
}

func (useCase *CreateRoom) Execute(ctx context.Context) (*Room, error) {
	roomID, err := useCase.roomIDGenerator.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate room ID: %w", err)
	}

	inviteCode, err := useCase.inviteCodeGenerator.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate invite code: %w", err)
	}

	createdRoom, err := New(roomID, inviteCode, roomID, useCase.clock.Now())
	if err != nil {
		return nil, fmt.Errorf("create room entity: %w", err)
	}

	if err := useCase.repository.Create(ctx, createdRoom); err != nil {
		return nil, fmt.Errorf("persist room: %w", err)
	}

	return createdRoom, nil
}
