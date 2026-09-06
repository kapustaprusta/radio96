package room

import (
	"context"
	"errors"
	"testing"
	"time"
)

type joinRoomTestCase struct {
	name              string
	inviteCode        string
	displayName       string
	prepareRoom       func(*testing.T) *Room
	now               time.Time
	findErr           error
	updateErr         error
	state             *MediaRoomState
	stateErr          error
	returnNilState    bool
	token             *ParticipantToken
	tokenErr          error
	identity          string
	identityErr       error
	wantErr           error
	wantStatus        Status
	wantFindCalls     int
	wantUpdateCalls   int
	wantStateCalls    int
	wantIdentityCalls int
	wantTokenCalls    int
	wantTokenRequest  bool
}

func TestJoinRoomExecute(t *testing.T) {
	repositoryErr := errors.New("repository failed")
	mediaErr := errors.New("media failed")
	generatorErr := errors.New("generator failed")
	validInviteCode := newTestInviteCode(t).Value()

	tests := []joinRoomTestCase{
		{
			name:              "joins open room",
			inviteCode:        validInviteCode,
			displayName:       "  Alice  ",
			prepareRoom:       newTestRoom,
			now:               testCreatedAt.Add(time.Minute),
			identity:          "participant-id",
			wantStatus:        StatusOpen,
			wantFindCalls:     1,
			wantIdentityCalls: 1,
			wantTokenCalls:    1,
			wantTokenRequest:  true,
		},
		{
			name:        "joins active room",
			inviteCode:  validInviteCode,
			displayName: "Alice",
			prepareRoom: activeTestRoom,
			now:         testCreatedAt.Add(2 * time.Minute),
			state: &MediaRoomState{
				Exists:           true,
				ParticipantCount: MaxParticipants - 1,
			},
			identity:          "participant-id",
			wantStatus:        StatusActive,
			wantFindCalls:     1,
			wantStateCalls:    1,
			wantIdentityCalls: 1,
			wantTokenCalls:    1,
			wantTokenRequest:  true,
		},
		{
			name:        "rejects invalid invite code",
			inviteCode:  "invalid",
			displayName: "Alice",
			wantErr:     ErrInvalidInviteCode,
		},
		{
			name:        "rejects invalid display name",
			inviteCode:  validInviteCode,
			displayName: "   ",
			wantErr:     ErrInvalidDisplayName,
		},
		{
			name:          "room not found",
			inviteCode:    validInviteCode,
			displayName:   "Alice",
			wantErr:       ErrRoomNotFound,
			wantFindCalls: 1,
		},
		{
			name:          "repository lookup fails",
			inviteCode:    validInviteCode,
			displayName:   "Alice",
			findErr:       repositoryErr,
			wantErr:       repositoryErr,
			wantFindCalls: 1,
		},
		{
			name:            "expires open room at deadline",
			inviteCode:      validInviteCode,
			displayName:     "Alice",
			prepareRoom:     newTestRoom,
			now:             testCreatedAt.Add(OpenRoomLifetime),
			wantErr:         ErrRoomExpired,
			wantStatus:      StatusExpired,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
		},
		{
			name:            "persisting expired room fails",
			inviteCode:      validInviteCode,
			displayName:     "Alice",
			prepareRoom:     newTestRoom,
			now:             testCreatedAt.Add(OpenRoomLifetime),
			updateErr:       repositoryErr,
			wantErr:         repositoryErr,
			wantStatus:      StatusExpired,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
		},
		{
			name:          "rejects finished room",
			inviteCode:    validInviteCode,
			displayName:   "Alice",
			prepareRoom:   finishedTestRoom,
			now:           testCreatedAt.Add(3 * time.Minute),
			wantErr:       ErrRoomFinished,
			wantStatus:    StatusFinished,
			wantFindCalls: 1,
		},
		{
			name:           "media room inspection fails",
			inviteCode:     validInviteCode,
			displayName:    "Alice",
			prepareRoom:    activeTestRoom,
			now:            testCreatedAt.Add(2 * time.Minute),
			stateErr:       mediaErr,
			wantErr:        ErrMediaUnavailable,
			wantStatus:     StatusActive,
			wantFindCalls:  1,
			wantStateCalls: 1,
		},
		{
			name:           "media gateway returns nil room state",
			inviteCode:     validInviteCode,
			displayName:    "Alice",
			prepareRoom:    activeTestRoom,
			now:            testCreatedAt.Add(2 * time.Minute),
			returnNilState: true,
			wantErr:        ErrMediaUnavailable,
			wantStatus:     StatusActive,
			wantFindCalls:  1,
			wantStateCalls: 1,
		},
		{
			name:            "finishes room missing from media service",
			inviteCode:      validInviteCode,
			displayName:     "Alice",
			prepareRoom:     activeTestRoom,
			now:             testCreatedAt.Add(2 * time.Minute),
			state:           &MediaRoomState{},
			wantErr:         ErrRoomFinished,
			wantStatus:      StatusFinished,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
			wantStateCalls:  1,
		},
		{
			name:            "persisting finished room fails",
			inviteCode:      validInviteCode,
			displayName:     "Alice",
			prepareRoom:     activeTestRoom,
			now:             testCreatedAt.Add(2 * time.Minute),
			state:           &MediaRoomState{},
			updateErr:       repositoryErr,
			wantErr:         repositoryErr,
			wantStatus:      StatusFinished,
			wantFindCalls:   1,
			wantUpdateCalls: 1,
			wantStateCalls:  1,
		},
		{
			name:        "rejects full media room",
			inviteCode:  validInviteCode,
			displayName: "Alice",
			prepareRoom: activeTestRoom,
			now:         testCreatedAt.Add(2 * time.Minute),
			state: &MediaRoomState{
				Exists:           true,
				ParticipantCount: MaxParticipants,
			},
			wantErr:        ErrRoomFull,
			wantStatus:     StatusActive,
			wantFindCalls:  1,
			wantStateCalls: 1,
		},
		{
			name:              "participant identity generator fails",
			inviteCode:        validInviteCode,
			displayName:       "Alice",
			prepareRoom:       newTestRoom,
			now:               testCreatedAt.Add(time.Minute),
			identityErr:       generatorErr,
			wantErr:           generatorErr,
			wantStatus:        StatusOpen,
			wantFindCalls:     1,
			wantIdentityCalls: 1,
		},
		{
			name:              "issuing participant token fails",
			inviteCode:        validInviteCode,
			displayName:       "Alice",
			prepareRoom:       newTestRoom,
			now:               testCreatedAt.Add(time.Minute),
			identity:          "participant-id",
			tokenErr:          mediaErr,
			wantErr:           ErrMediaUnavailable,
			wantStatus:        StatusOpen,
			wantFindCalls:     1,
			wantIdentityCalls: 1,
			wantTokenCalls:    1,
		},
		{
			name:              "media gateway returns incomplete token",
			inviteCode:        validInviteCode,
			displayName:       "Alice",
			prepareRoom:       newTestRoom,
			now:               testCreatedAt.Add(time.Minute),
			identity:          "participant-id",
			token:             &ParticipantToken{},
			wantErr:           ErrMediaUnavailable,
			wantStatus:        StatusOpen,
			wantFindCalls:     1,
			wantIdentityCalls: 1,
			wantTokenCalls:    1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			foundRoom := prepareJoinTestRoom(t, test.prepareRoom)
			repository := &fakeRoomRepository{
				foundRoom: foundRoom,
				findErr:   test.findErr,
				updateErr: test.updateErr,
			}
			mediaGateway := newJoinTestMediaGateway(test)
			identityGenerator := &fakeIDGenerator{value: test.identity, err: test.identityErr}
			useCase := NewJoinRoom(
				repository,
				mediaGateway,
				&fakeClock{now: test.now},
				identityGenerator,
			)

			got, err := useCase.Execute(context.Background(), test.inviteCode, test.displayName)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Execute() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("Execute() = %v, want nil", got)
				}
			} else {
				assertJoinRoomResult(t, got)
			}

			if foundRoom != nil && test.wantStatus != "" && foundRoom.Status() != test.wantStatus {
				t.Errorf("Status() = %q, want %q", foundRoom.Status(), test.wantStatus)
			}

			assertJoinRoomCalls(t, test, repository, mediaGateway, identityGenerator)
		})
	}
}

func prepareJoinTestRoom(t *testing.T, prepare func(*testing.T) *Room) *Room {
	t.Helper()

	if prepare == nil {
		return nil
	}

	return prepare(t)
}

func newJoinTestMediaGateway(test joinRoomTestCase) *fakeMediaGateway {
	state := test.state
	if state == nil && !test.returnNilState {
		state = &MediaRoomState{Exists: true}
	}

	token := test.token
	if token == nil && test.tokenErr == nil {
		token = &ParticipantToken{
			ServerURL: "wss://radio96.example.livekit.cloud",
			Value:     "participant-token",
		}
	}

	return &fakeMediaGateway{
		state:    state,
		token:    token,
		stateErr: test.stateErr,
		tokenErr: test.tokenErr,
	}
}

func assertJoinRoomResult(t *testing.T, got *JoinRoomResult) {
	t.Helper()

	if got == nil {
		t.Fatal("Execute() = nil, want result")
	}

	if got.ServerURL != "wss://radio96.example.livekit.cloud" {
		t.Errorf("ServerURL = %q, want %q", got.ServerURL, "wss://radio96.example.livekit.cloud")
	}

	if got.ParticipantToken != "participant-token" {
		t.Errorf("ParticipantToken = %q, want %q", got.ParticipantToken, "participant-token")
	}

	if got.ParticipantIdentity != "participant-id" {
		t.Errorf("ParticipantIdentity = %q, want %q", got.ParticipantIdentity, "participant-id")
	}
}

func assertJoinRoomCalls(
	t *testing.T,
	test joinRoomTestCase,
	repository *fakeRoomRepository,
	mediaGateway *fakeMediaGateway,
	identityGenerator *fakeIDGenerator,
) {
	t.Helper()

	if repository.findCalls != test.wantFindCalls {
		t.Errorf("FindByInviteCode() calls = %d, want %d", repository.findCalls, test.wantFindCalls)
	}

	if repository.updateCalls != test.wantUpdateCalls {
		t.Errorf("Update() calls = %d, want %d", repository.updateCalls, test.wantUpdateCalls)
	}

	if mediaGateway.stateCalls != test.wantStateCalls {
		t.Errorf("RoomState() calls = %d, want %d", mediaGateway.stateCalls, test.wantStateCalls)
	}

	if identityGenerator.calls != test.wantIdentityCalls {
		t.Errorf("identity generator calls = %d, want %d", identityGenerator.calls, test.wantIdentityCalls)
	}

	if mediaGateway.tokenCalls != test.wantTokenCalls {
		t.Errorf("IssueParticipantToken() calls = %d, want %d", mediaGateway.tokenCalls, test.wantTokenCalls)
	}

	if test.wantTokenRequest {
		assertParticipantTokenRequest(t, mediaGateway.tokenRequest)
	}
}

func assertParticipantTokenRequest(t *testing.T, got ParticipantTokenRequest) {
	t.Helper()

	if got.RoomName != "radio96_room-id" {
		t.Errorf("RoomName = %q, want %q", got.RoomName, "radio96_room-id")
	}

	if got.ParticipantIdentity != "participant-id" {
		t.Errorf("ParticipantIdentity = %q, want %q", got.ParticipantIdentity, "participant-id")
	}

	if got.DisplayName != "Alice" {
		t.Errorf("DisplayName = %q, want %q", got.DisplayName, "Alice")
	}

	if got.TTL != ParticipantTokenTTL {
		t.Errorf("TTL = %v, want %v", got.TTL, ParticipantTokenTTL)
	}

	if got.MaxParticipants != MaxParticipants {
		t.Errorf("MaxParticipants = %d, want %d", got.MaxParticipants, MaxParticipants)
	}
}

func activeTestRoom(t *testing.T) *Room {
	t.Helper()

	preparedRoom := newTestRoom(t)
	if err := preparedRoom.Start(testCreatedAt.Add(time.Minute)); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	return preparedRoom
}

func finishedTestRoom(t *testing.T) *Room {
	t.Helper()

	preparedRoom := activeTestRoom(t)
	if err := preparedRoom.Finish(testCreatedAt.Add(2 * time.Minute)); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}

	return preparedRoom
}
