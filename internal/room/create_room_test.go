package room

import (
	"context"
	"errors"
	"testing"
)

func TestCreateRoomExecute(t *testing.T) {
	generatorErr := errors.New("generator failed")
	repositoryErr := errors.New("repository failed")

	tests := []struct {
		name            string
		roomID          string
		roomIDErr       error
		inviteCode      func(*testing.T) *InviteCode
		inviteCodeErr   error
		repositoryErr   error
		wantErr         error
		wantIDCalls     int
		wantInviteCalls int
		wantCreateCalls int
	}{
		{
			name:            "creates room",
			roomID:          "room-id",
			inviteCode:      newTestInviteCode,
			wantIDCalls:     1,
			wantInviteCalls: 1,
			wantCreateCalls: 1,
		},
		{
			name:        "room ID generator fails",
			roomIDErr:   generatorErr,
			wantErr:     generatorErr,
			wantIDCalls: 1,
		},
		{
			name:            "invite code generator fails",
			roomID:          "room-id",
			inviteCodeErr:   generatorErr,
			wantErr:         generatorErr,
			wantIDCalls:     1,
			wantInviteCalls: 1,
		},
		{
			name:            "generated room ID is invalid",
			inviteCode:      newTestInviteCode,
			wantErr:         ErrInvalidRoom,
			wantIDCalls:     1,
			wantInviteCalls: 1,
		},
		{
			name:            "generated invite code is nil",
			roomID:          "room-id",
			wantErr:         ErrInvalidRoom,
			wantIDCalls:     1,
			wantInviteCalls: 1,
		},
		{
			name:            "repository fails",
			roomID:          "room-id",
			inviteCode:      newTestInviteCode,
			repositoryErr:   repositoryErr,
			wantErr:         repositoryErr,
			wantIDCalls:     1,
			wantInviteCalls: 1,
			wantCreateCalls: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var inviteCode *InviteCode
			if test.inviteCode != nil {
				inviteCode = test.inviteCode(t)
			}

			repository := &fakeRoomRepository{createErr: test.repositoryErr}
			roomIDGenerator := &fakeIDGenerator{value: test.roomID, err: test.roomIDErr}
			inviteCodeGenerator := &fakeInviteCodeGenerator{value: inviteCode, err: test.inviteCodeErr}
			useCase := NewCreateRoom(
				repository,
				&fakeClock{now: testCreatedAt},
				roomIDGenerator,
				inviteCodeGenerator,
			)

			got, err := useCase.Execute(context.Background())
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Execute() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("Execute() = %v, want nil", got)
				}
			} else {
				assertCreatedRoom(t, got, inviteCode)

				if repository.createdRoom != got {
					t.Errorf("Create() room = %p, want %p", repository.createdRoom, got)
				}
			}

			if roomIDGenerator.calls != test.wantIDCalls {
				t.Errorf("room ID generator calls = %d, want %d", roomIDGenerator.calls, test.wantIDCalls)
			}

			if inviteCodeGenerator.calls != test.wantInviteCalls {
				t.Errorf("invite code generator calls = %d, want %d", inviteCodeGenerator.calls, test.wantInviteCalls)
			}

			if repository.createCalls != test.wantCreateCalls {
				t.Errorf("Create() calls = %d, want %d", repository.createCalls, test.wantCreateCalls)
			}
		})
	}
}

func assertCreatedRoom(t *testing.T, got *Room, inviteCode *InviteCode) {
	t.Helper()

	if got == nil {
		t.Fatal("Execute() = nil, want room")
	}

	if got.ID() != "room-id" {
		t.Errorf("ID() = %q, want %q", got.ID(), "room-id")
	}

	if got.Name() != got.ID() {
		t.Errorf("Name() = %q, want room ID %q", got.Name(), got.ID())
	}

	if got.InviteCode() != inviteCode {
		t.Errorf("InviteCode() = %v, want %v", got.InviteCode(), inviteCode)
	}

	if got.Status() != StatusOpen {
		t.Errorf("Status() = %q, want %q", got.Status(), StatusOpen)
	}

	if !got.CreatedAt().Equal(testCreatedAt) {
		t.Errorf("CreatedAt() = %v, want %v", got.CreatedAt(), testCreatedAt)
	}
}
