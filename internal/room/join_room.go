package room

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const ParticipantTokenTTL = 10 * time.Minute

type JoinRoomResult struct {
	ServerURL           string
	ParticipantToken    string
	ParticipantIdentity string
}

type JoinRoom struct {
	repository                   RoomRepository
	mediaGateway                 MediaGateway
	clock                        Clock
	participantIdentityGenerator IDGenerator
}

func NewJoinRoom(
	repository RoomRepository,
	mediaGateway MediaGateway,
	clock Clock,
	participantIdentityGenerator IDGenerator,
) *JoinRoom {
	return &JoinRoom{
		repository:                   repository,
		mediaGateway:                 mediaGateway,
		clock:                        clock,
		participantIdentityGenerator: participantIdentityGenerator,
	}
}

func (useCase *JoinRoom) Execute(
	ctx context.Context,
	inviteCodeValue string,
	displayNameValue string,
) (*JoinRoomResult, error) {
	inviteCode, err := ParseInviteCode(inviteCodeValue)
	if err != nil {
		return nil, err
	}

	displayName, err := NewDisplayName(displayNameValue)
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
	if joinErr := foundRoom.ValidateJoin(now); joinErr != nil {
		if errors.Is(joinErr, ErrRoomExpired) && foundRoom.Status() == StatusOpen {
			if err := foundRoom.Expire(now); err != nil {
				return nil, fmt.Errorf("expire room: %w", err)
			}

			if err := useCase.repository.Update(ctx, foundRoom); err != nil {
				return nil, fmt.Errorf("persist expired room: %w", err)
			}
		}

		return nil, joinErr
	}

	if foundRoom.Status() == StatusActive {
		if err := useCase.validateActiveRoom(ctx, foundRoom, now); err != nil {
			return nil, err
		}
	}

	participantIdentity, err := useCase.participantIdentityGenerator.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate participant identity: %w", err)
	}

	participantToken, err := useCase.mediaGateway.IssueParticipantToken(ctx, ParticipantTokenRequest{
		RoomName:            foundRoom.Name(),
		ParticipantIdentity: participantIdentity,
		DisplayName:         displayName.String(),
		TTL:                 ParticipantTokenTTL,
		MaxParticipants:     MaxParticipants,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: issue participant token: %w", ErrMediaUnavailable, err)
	}

	if participantToken == nil || participantToken.ServerURL == "" || participantToken.Value == "" {
		return nil, fmt.Errorf("%w: media gateway returned incomplete participant token", ErrMediaUnavailable)
	}

	return &JoinRoomResult{
		ServerURL:           participantToken.ServerURL,
		ParticipantToken:    participantToken.Value,
		ParticipantIdentity: participantIdentity,
	}, nil
}

func (useCase *JoinRoom) validateActiveRoom(ctx context.Context, foundRoom *Room, now time.Time) error {
	state, err := useCase.mediaGateway.RoomState(ctx, foundRoom.Name())
	if err != nil {
		return fmt.Errorf("%w: inspect media room: %w", ErrMediaUnavailable, err)
	}

	if state == nil {
		return fmt.Errorf("%w: media gateway returned no room state", ErrMediaUnavailable)
	}

	if !state.Exists {
		if err := foundRoom.Finish(now); err != nil {
			return fmt.Errorf("finish missing media room: %w", err)
		}

		if err := useCase.repository.Update(ctx, foundRoom); err != nil {
			return fmt.Errorf("persist finished room: %w", err)
		}

		return ErrRoomFinished
	}

	if state.ParticipantCount >= MaxParticipants {
		return ErrRoomFull
	}

	return nil
}
