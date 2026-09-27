package room

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestGetRoomExecute(t *testing.T) {
	repositoryErr := errors.New("repository failed")
	validInviteCode := newTestInviteCode(t).Value()

	tests := []struct {
		name            string
		inviteCode      string
		prepareRoom     func(*testing.T) *Room
		now             time.Time
		findErr         error
		updateErr       error
		wantErr         error
		wantStatus      Status
		wantFindCalls   int
		wantUpdateCalls int
	}{
		{
			name:          "returns open room",
			inviteCode:    validInviteCode,
			prepareRoom:   newTestRoom,
			now:           testCreatedAt.Add(time.Minute),
			wantStatus:    StatusOpen,
			wantFindCalls: 1,
		},
		{
			name:            "expires open room at deadline",
			inviteCode:      validInviteCode,
			prepareRoom:     newTestRoom,
			now:             testCreatedAt.Add(OpenRoomLifetime),
			wantStatus:      StatusExpired,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
		},
		{
			name:       "invalid invite code",
			inviteCode: "invalid",
			wantErr:    ErrInvalidInviteCode,
		},
		{
			name:          "room not found",
			inviteCode:    validInviteCode,
			wantErr:       ErrRoomNotFound,
			wantFindCalls: 1,
		},
		{
			name:          "repository lookup fails",
			inviteCode:    validInviteCode,
			findErr:       repositoryErr,
			wantErr:       repositoryErr,
			wantFindCalls: 1,
		},
		{
			name:            "persisting expired room fails",
			inviteCode:      validInviteCode,
			prepareRoom:     newTestRoom,
			now:             testCreatedAt.Add(OpenRoomLifetime),
			updateErr:       repositoryErr,
			wantErr:         repositoryErr,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
		},
		{
			name:       "active room keeps original expiry",
			inviteCode: validInviteCode,
			prepareRoom: func(t *testing.T) *Room {
				t.Helper()

				preparedRoom := newTestRoom(t)
				if err := preparedRoom.Start(testCreatedAt.Add(time.Minute)); err != nil {
					t.Fatalf("Start() error = %v", err)
				}

				return preparedRoom
			},
			now:           testCreatedAt.Add(2 * OpenRoomLifetime),
			wantStatus:    StatusActive,
			wantFindCalls: 1,
		},
		{
			name: "empty active room remains available within ten minutes", inviteCode: validInviteCode,
			prepareRoom: idleTestRoom, now: testCreatedAt.Add(2*time.Minute + EmptyRoomLifetime - time.Second),
			wantStatus: StatusActive, wantFindCalls: 1,
		},
		{
			name: "empty active room finishes at ten minutes", inviteCode: validInviteCode,
			prepareRoom: idleTestRoom, now: testCreatedAt.Add(2*time.Minute + EmptyRoomLifetime),
			wantStatus: StatusFinished, wantFindCalls: 1, wantUpdateCalls: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var foundRoom *Room
			if test.prepareRoom != nil {
				foundRoom = test.prepareRoom(t)
			}

			repository := &fakeRoomRepository{
				foundRoom: foundRoom,
				findErr:   test.findErr,
				updateErr: test.updateErr,
			}
			useCase := NewGetRoom(repository, &fakeClock{now: test.now})

			got, err := useCase.Execute(context.Background(), test.inviteCode)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Execute() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("Execute() = %v, want nil", got)
				}
			} else {
				if got != foundRoom {
					t.Errorf("Execute() = %p, want %p", got, foundRoom)
				}

				if got.Status() != test.wantStatus {
					t.Errorf("Status() = %q, want %q", got.Status(), test.wantStatus)
				}
			}

			if repository.findCalls != test.wantFindCalls {
				t.Errorf("FindByInviteCode() calls = %d, want %d", repository.findCalls, test.wantFindCalls)
			}

			if repository.updateCalls != test.wantUpdateCalls {
				t.Errorf("Update() calls = %d, want %d", repository.updateCalls, test.wantUpdateCalls)
			}

			if repository.findCode != nil && repository.findCode.Value() != test.inviteCode {
				t.Errorf("FindByInviteCode() code = %q, want %q", repository.findCode.Value(), test.inviteCode)
			}
		})
	}
}

func TestGetRoomExpiredLinkChecksRealMediaState(t *testing.T) {
	tests := []struct {
		name          string
		initialStatus Status
		now           time.Time
		state         *MediaRoomState
		stateErr      error
		wantStatus    Status
		wantErr       error
		wantUpdates   int
	}{
		{name: "conversation still active", state: &MediaRoomState{Exists: true, ParticipantCount: 1},
			wantStatus: StatusActive, wantUpdates: 1},
		{name: "recover a recently expired active conversation", initialStatus: StatusExpired,
			now:   testCreatedAt.Add(OpenRoomLifetime + time.Minute),
			state: &MediaRoomState{Exists: true, ParticipantCount: 1}, wantStatus: StatusActive, wantUpdates: 1},
		{name: "link was unused", state: &MediaRoomState{}, wantStatus: StatusExpired, wantUpdates: 1},
		{name: "media unavailable", stateErr: errors.New("LiveKit unavailable"),
			wantStatus: StatusOpen, wantErr: ErrMediaUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			foundRoom := newTestRoom(t)
			if test.initialStatus == StatusExpired {
				if err := foundRoom.Expire(foundRoom.ExpiresAt()); err != nil {
					t.Fatalf("Expire() error = %v", err)
				}
			}

			repository := &fakeRoomRepository{foundRoom: foundRoom}
			media := &fakeMediaGateway{state: test.state, stateErr: test.stateErr}
			now := test.now
			if now.IsZero() {
				now = testCreatedAt.Add(2 * OpenRoomLifetime)
			}

			useCase := NewGetRoomWithMedia(repository, media, &fakeClock{now: now})
			got, err := useCase.Execute(t.Context(), foundRoom.InviteCode().Value())
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Execute() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr == nil && (got == nil || got.Status() != test.wantStatus) {
				t.Errorf("room = %v, want status %q", got, test.wantStatus)
			}

			if repository.updateCalls != test.wantUpdates || media.stateCalls != 1 {
				t.Errorf("update calls = %d, media calls = %d; want %d, 1", repository.updateCalls,
					media.stateCalls, test.wantUpdates)
			}
		})
	}
}
