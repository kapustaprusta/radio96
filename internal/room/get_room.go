package room

import (
	"context"
	"errors"
	"fmt"
)

type GetRoom struct {
	repository   RoomRepository
	mediaGateway MediaGateway
	clock        Clock
}

func NewGetRoomWithMedia(repository RoomRepository, mediaGateway MediaGateway, clock Clock) *GetRoom {
	return &GetRoom{repository: repository, mediaGateway: mediaGateway, clock: clock}
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

	return useCase.execute(ctx, inviteCode, 0)
}

func (useCase *GetRoom) execute(ctx context.Context, inviteCode *InviteCode, retry int) (*Room, error) {
	foundRoom, err := useCase.repository.FindByInviteCode(ctx, inviteCode)
	if err != nil {
		return nil, fmt.Errorf("find room: %w", err)
	}

	if foundRoom == nil {
		return nil, ErrRoomNotFound
	}

	now := useCase.clock.Now()
	originalStatus := foundRoom.Status()
	openPastDeadline := originalStatus == StatusOpen && !now.Before(foundRoom.ExpiresAt())
	recentlyExpired := originalStatus == StatusExpired && now.Before(foundRoom.ExpiresAt().Add(ExpiredRecoveryWindow))
	if openPastDeadline || recentlyExpired {
		if useCase.mediaGateway != nil {
			state, err := useCase.mediaGateway.RoomState(ctx, foundRoom.Name())
			if err != nil || state == nil {
				return nil, fmt.Errorf("%w: inspect media room before expiry", ErrMediaUnavailable)
			}

			if state.Exists && state.ParticipantCount > 0 {
				if err := foundRoom.RecoverStarted(now); err != nil {
					return nil, fmt.Errorf("recover active room: %w", err)
				}
			}
		}

		if foundRoom.Status() == StatusOpen {
			if err := foundRoom.Expire(now); err != nil {
				return nil, fmt.Errorf("expire room: %w", err)
			}
		}

		if foundRoom.Status() != originalStatus {
			if err := useCase.repository.Update(ctx, foundRoom); err != nil {
				if errors.Is(err, ErrConcurrentRoomUpdate) && retry < 2 {
					return useCase.execute(ctx, inviteCode, retry+1)
				}

				return nil, fmt.Errorf("persist room lifecycle: %w", err)
			}
		}
	}

	if deadline, empty := foundRoom.EmptyDeadline(); empty && !now.Before(deadline) {
		if useCase.mediaGateway != nil {
			state, err := useCase.mediaGateway.RoomState(ctx, foundRoom.Name())
			if err != nil || state == nil {
				return nil, fmt.Errorf("%w: inspect idle media room", ErrMediaUnavailable)
			}

			if state.Exists && state.ParticipantCount > 0 {
				return foundRoom, nil
			}
		}

		if err := foundRoom.Finish(now); err != nil {
			return nil, fmt.Errorf("finish idle room: %w", err)
		}

		if err := useCase.repository.Update(ctx, foundRoom); err != nil {
			if errors.Is(err, ErrConcurrentRoomUpdate) && retry < 2 {
				return useCase.execute(ctx, inviteCode, retry+1)
			}

			return nil, fmt.Errorf("persist finished room: %w", err)
		}
	}

	return foundRoom, nil
}
