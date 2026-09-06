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
