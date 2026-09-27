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
	admissionStore               AdmissionStore
	clock                        Clock
	participantIdentityGenerator IDGenerator
}

func NewJoinRoom(
	repository RoomRepository,
	mediaGateway MediaGateway,
	admissionStore AdmissionStore,
	clock Clock,
	participantIdentityGenerator IDGenerator,
) *JoinRoom {
	return &JoinRoom{
		repository:                   repository,
		mediaGateway:                 mediaGateway,
		admissionStore:               admissionStore,
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

	return useCase.execute(ctx, inviteCode, displayName, 0)
}

func (useCase *JoinRoom) execute(ctx context.Context, inviteCode *InviteCode, displayName *DisplayName,
	retry int,
) (*JoinRoomResult, error) {
	foundRoom, err := useCase.repository.FindByInviteCode(ctx, inviteCode)
	if err != nil {
		return nil, fmt.Errorf("find room: %w", err)
	}

	if foundRoom == nil {
		return nil, ErrRoomNotFound
	}

	now := useCase.clock.Now()
	if joinErr := foundRoom.ValidateJoin(now); joinErr != nil {
		originalStatus := foundRoom.Status()
		recentlyExpired := originalStatus == StatusExpired && now.Before(foundRoom.ExpiresAt().Add(ExpiredRecoveryWindow))
		if errors.Is(joinErr, ErrRoomExpired) && (originalStatus == StatusOpen || recentlyExpired) {
			state, err := useCase.mediaGateway.RoomState(ctx, foundRoom.Name())
			if err != nil || state == nil {
				return nil, fmt.Errorf("%w: inspect media room before expiry", ErrMediaUnavailable)
			}

			if state.Exists && state.ParticipantCount > 0 {
				if err := foundRoom.RecoverStarted(now); err != nil {
					return nil, fmt.Errorf("recover active room: %w", err)
				}
			} else if originalStatus == StatusOpen {
				if err := foundRoom.Expire(now); err != nil {
					return nil, fmt.Errorf("expire room: %w", err)
				}
			}

			if foundRoom.Status() != originalStatus {
				if err := useCase.repository.Update(ctx, foundRoom); err != nil {
					if errors.Is(err, ErrConcurrentRoomUpdate) && retry < 2 {
						return useCase.execute(ctx, inviteCode, displayName, retry+1)
					}

					return nil, fmt.Errorf("persist room lifecycle: %w", err)
				}
			}

			if foundRoom.Status() == StatusActive {
				joinErr = nil
			}
		}

		if joinErr != nil {
			return nil, joinErr
		}
	}

	mediaState, err := useCase.validateMediaRoom(ctx, foundRoom, now)
	if err != nil {
		if errors.Is(err, ErrConcurrentRoomUpdate) && retry < 2 {
			return useCase.execute(ctx, inviteCode, displayName, retry+1)
		}

		return nil, err
	}

	participantIdentity, err := useCase.participantIdentityGenerator.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate participant identity: %w", err)
	}

	tokenTTL := ParticipantTokenTTL
	if foundRoom.Status() == StatusOpen {
		remaining := foundRoom.ExpiresAt().Sub(now)
		if remaining < time.Second {
			return nil, ErrRoomExpired
		}

		if remaining < tokenTTL {
			tokenTTL = remaining
		}
	}

	if deadline, empty := foundRoom.EmptyDeadline(); empty && (!mediaState.Exists || mediaState.ParticipantCount == 0) {
		remaining := deadline.Sub(now)
		if remaining < time.Second {
			return nil, ErrRoomFinished
		}

		if remaining < tokenTTL {
			tokenTTL = remaining
		}
	}

	participantToken, err := useCase.mediaGateway.IssueParticipantToken(ctx, ParticipantTokenRequest{
		RoomName:            foundRoom.Name(),
		ParticipantIdentity: participantIdentity,
		DisplayName:         displayName.String(),
		TTL:                 tokenTTL,
		MaxParticipants:     MaxParticipants,
	})
	if err != nil {
		if errors.Is(err, ErrRoomFull) {
			return nil, ErrRoomFull
		}

		return nil, fmt.Errorf("%w: issue participant token: %w", ErrMediaUnavailable, err)
	}

	if participantToken == nil || participantToken.ServerURL == "" || participantToken.Value == "" {
		return nil, fmt.Errorf("%w: media gateway returned incomplete participant token", ErrMediaUnavailable)
	}

	connectedIdentities, err := useCase.mediaGateway.ParticipantIdentities(ctx, foundRoom.Name())
	if err != nil {
		return nil, fmt.Errorf("%w: list media participants: %w", ErrMediaUnavailable, err)
	}

	if err := useCase.admissionStore.Reserve(ctx, foundRoom.Name(), participantIdentity,
		connectedIdentities, useCase.clock.Now().Add(tokenTTL), MaxParticipants); err != nil {
		if errors.Is(err, ErrRoomFull) {
			return nil, ErrRoomFull
		}

		return nil, fmt.Errorf("reserve room admission: %w", err)
	}

	return &JoinRoomResult{
		ServerURL:           participantToken.ServerURL,
		ParticipantToken:    participantToken.Value,
		ParticipantIdentity: participantIdentity,
	}, nil
}

func (useCase *JoinRoom) validateMediaRoom(ctx context.Context, foundRoom *Room, now time.Time) (*MediaRoomState, error) {
	state, err := useCase.mediaGateway.RoomState(ctx, foundRoom.Name())
	if err != nil {
		return nil, fmt.Errorf("%w: inspect media room: %w", ErrMediaUnavailable, err)
	}

	if state == nil {
		return nil, fmt.Errorf("%w: media gateway returned no room state", ErrMediaUnavailable)
	}

	if deadline, empty := foundRoom.EmptyDeadline(); empty && !now.Before(deadline) &&
		(!state.Exists || state.ParticipantCount == 0) {
		if err := foundRoom.Finish(now); err != nil {
			return nil, fmt.Errorf("finish idle room: %w", err)
		}

		if err := useCase.repository.Update(ctx, foundRoom); err != nil {
			return nil, fmt.Errorf("persist finished room: %w", err)
		}

		return nil, ErrRoomFinished
	}

	// A room can be absent or empty during the ten-minute reconnect window.
	// Issuing the next token recreates it with the same application room name.
	if !state.Exists {
		return state, nil
	}

	if state.MaxParticipants != MaxParticipants {
		return nil, fmt.Errorf("%w: media room has an unexpected participant limit", ErrMediaUnavailable)
	}

	if state.ParticipantCount >= MaxParticipants {
		return nil, ErrRoomFull
	}

	return state, nil
}
