package room

import (
	"errors"
	"strings"
	"testing"
	"time"
)

var testCreatedAt = time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)

func TestNew(t *testing.T) {
	inviteCode := newTestInviteCode(t)

	tests := []struct {
		name       string
		id         string
		inviteCode *InviteCode
		roomName   string
		createdAt  time.Time
		wantErr    error
	}{
		{
			name:       "valid room",
			id:         "room-id",
			inviteCode: inviteCode,
			roomName:   "radio96_room-id",
			createdAt:  testCreatedAt,
		},
		{
			name:       "missing ID",
			inviteCode: inviteCode,
			roomName:   "radio96_room-id",
			createdAt:  testCreatedAt,
			wantErr:    ErrInvalidRoom,
		},
		{
			name:      "missing invite code",
			id:        "room-id",
			roomName:  "radio96_room-id",
			createdAt: testCreatedAt,
			wantErr:   ErrInvalidRoom,
		},
		{
			name:       "missing room name",
			id:         "room-id",
			inviteCode: inviteCode,
			createdAt:  testCreatedAt,
			wantErr:    ErrInvalidRoom,
		},
		{
			name:       "missing creation time",
			id:         "room-id",
			inviteCode: inviteCode,
			roomName:   "radio96_room-id",
			wantErr:    ErrInvalidRoom,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := New(test.id, test.inviteCode, test.roomName, test.createdAt)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("New() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("New() = %v, want nil", got)
				}

				return
			}

			if got == nil {
				t.Fatal("New() = nil, want room")
			}

			if got.ID() != test.id {
				t.Errorf("ID() = %q, want %q", got.ID(), test.id)
			}

			if got.InviteCode() != test.inviteCode {
				t.Errorf("InviteCode() = %v, want %v", got.InviteCode(), test.inviteCode)
			}

			if got.Name() != test.roomName {
				t.Errorf("Name() = %q, want %q", got.Name(), test.roomName)
			}

			if got.Status() != StatusOpen {
				t.Errorf("Status() = %q, want %q", got.Status(), StatusOpen)
			}

			if !got.CreatedAt().Equal(test.createdAt) {
				t.Errorf("CreatedAt() = %v, want %v", got.CreatedAt(), test.createdAt)
			}

			wantExpiresAt := test.createdAt.Add(OpenRoomLifetime)
			if !got.ExpiresAt().Equal(wantExpiresAt) {
				t.Errorf("ExpiresAt() = %v, want %v", got.ExpiresAt(), wantExpiresAt)
			}
		})
	}
}

func TestRestore(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*RestoreRoomParams)
		wantErr error
	}{
		{
			name: "open room",
		},
		{
			name: "active room",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusActive
				params.StartedAt = timePointer(testCreatedAt.Add(time.Minute))
			},
		},
		{
			name: "finished room",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusFinished
				params.StartedAt = timePointer(testCreatedAt.Add(time.Minute))
				params.FinishedAt = timePointer(testCreatedAt.Add(2 * time.Minute))
			},
		},
		{
			name: "expired room",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusExpired
			},
		},
		{
			name: "normalizes timestamps to UTC",
			mutate: func(params *RestoreRoomParams) {
				location := time.FixedZone("test", 3*60*60)
				params.CreatedAt = testCreatedAt.In(location)
				params.ExpiresAt = testCreatedAt.Add(OpenRoomLifetime).In(location)
			},
		},
		{
			name: "missing ID",
			mutate: func(params *RestoreRoomParams) {
				params.ID = ""
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "missing invite code",
			mutate: func(params *RestoreRoomParams) {
				params.InviteCode = nil
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "missing name",
			mutate: func(params *RestoreRoomParams) {
				params.Name = ""
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "missing creation time",
			mutate: func(params *RestoreRoomParams) {
				params.CreatedAt = time.Time{}
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "expiry does not follow creation",
			mutate: func(params *RestoreRoomParams) {
				params.ExpiresAt = params.CreatedAt
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "unknown status",
			mutate: func(params *RestoreRoomParams) {
				params.Status = Status("unknown")
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "open room with start time",
			mutate: func(params *RestoreRoomParams) {
				params.StartedAt = timePointer(testCreatedAt.Add(time.Minute))
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "active room without start time",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusActive
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "finished room without finish time",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusFinished
				params.StartedAt = timePointer(testCreatedAt.Add(time.Minute))
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "start time precedes creation",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusActive
				params.StartedAt = timePointer(testCreatedAt.Add(-time.Second))
			},
			wantErr: ErrInvalidRoom,
		},
		{
			name: "finish time precedes start",
			mutate: func(params *RestoreRoomParams) {
				params.Status = StatusFinished
				params.StartedAt = timePointer(testCreatedAt.Add(2 * time.Minute))
				params.FinishedAt = timePointer(testCreatedAt.Add(time.Minute))
			},
			wantErr: ErrInvalidRoom,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			params := RestoreRoomParams{
				ID:         "room-id",
				InviteCode: newTestInviteCode(t),
				Name:       "room-name",
				Status:     StatusOpen,
				CreatedAt:  testCreatedAt,
				ExpiresAt:  testCreatedAt.Add(OpenRoomLifetime),
			}
			if test.mutate != nil {
				test.mutate(&params)
			}

			got, err := Restore(params)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Restore() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("Restore() = %v, want nil", got)
				}

				return
			}

			assertRestoredRoom(t, got, params)
		})
	}
}

func assertRestoredRoom(t *testing.T, got *Room, params RestoreRoomParams) {
	t.Helper()

	if got == nil {
		t.Fatal("Restore() = nil, want room")
	}

	if got.ID() != params.ID || got.Name() != params.Name || got.Status() != params.Status {
		t.Errorf(
			"Restore() identity = (%q, %q, %q), want (%q, %q, %q)",
			got.ID(),
			got.Name(),
			got.Status(),
			params.ID,
			params.Name,
			params.Status,
		)
	}

	if got.InviteCode() != params.InviteCode {
		t.Errorf("InviteCode() = %v, want %v", got.InviteCode(), params.InviteCode)
	}

	if !got.CreatedAt().Equal(params.CreatedAt) || got.CreatedAt().Location() != time.UTC {
		t.Errorf("CreatedAt() = %v, want %v in UTC", got.CreatedAt(), params.CreatedAt)
	}

	if !got.ExpiresAt().Equal(params.ExpiresAt) || got.ExpiresAt().Location() != time.UTC {
		t.Errorf("ExpiresAt() = %v, want %v in UTC", got.ExpiresAt(), params.ExpiresAt)
	}

	assertOptionalRoomTime(t, "StartedAt", got.StartedAt, params.StartedAt)
	assertOptionalRoomTime(t, "FinishedAt", got.FinishedAt, params.FinishedAt)
}

func assertOptionalRoomTime(
	t *testing.T,
	name string,
	getter func() (time.Time, bool),
	want *time.Time,
) {
	t.Helper()

	got, ok := getter()
	if ok != (want != nil) {
		t.Errorf("%s() present = %t, want %t", name, ok, want != nil)

		return
	}

	if want != nil && (!got.Equal(*want) || got.Location() != time.UTC) {
		t.Errorf("%s() = %v, want %v in UTC", name, got, *want)
	}
}

func timePointer(value time.Time) *time.Time {
	return &value
}

func TestRoomValidateJoin(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(*testing.T, *Room)
		at      time.Time
		wantErr error
	}{
		{
			name: "open before expiry",
			at:   testCreatedAt.Add(OpenRoomLifetime - time.Nanosecond),
		},
		{
			name:    "open at expiry",
			at:      testCreatedAt.Add(OpenRoomLifetime),
			wantErr: ErrRoomExpired,
		},
		{
			name: "active after original expiry",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Start(testCreatedAt.Add(time.Minute)); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
			},
			at: testCreatedAt.Add(2 * OpenRoomLifetime),
		},
		{
			name: "finished",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				finishTestRoom(t, room)
			},
			at:      testCreatedAt.Add(3 * time.Minute),
			wantErr: ErrRoomFinished,
		},
		{
			name: "expired",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Expire(room.ExpiresAt()); err != nil {
					t.Fatalf("Expire() error = %v", err)
				}
			},
			at:      testCreatedAt.Add(2 * OpenRoomLifetime),
			wantErr: ErrRoomExpired,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			room := newTestRoom(t)
			if test.prepare != nil {
				test.prepare(t, room)
			}

			if err := room.ValidateJoin(test.at); !errors.Is(err, test.wantErr) {
				t.Errorf("ValidateJoin() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestRoomStart(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(*testing.T, *Room)
		at         time.Time
		wantStatus Status
		wantTime   time.Time
		wantErr    error
	}{
		{
			name:       "open room",
			at:         testCreatedAt.Add(time.Minute),
			wantStatus: StatusActive,
			wantTime:   testCreatedAt.Add(time.Minute),
		},
		{
			name: "active room is idempotent",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Start(testCreatedAt.Add(time.Minute)); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
			},
			at:         testCreatedAt.Add(2 * time.Minute),
			wantStatus: StatusActive,
			wantTime:   testCreatedAt.Add(time.Minute),
		},
		{
			name: "finished room",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				finishTestRoom(t, room)
			},
			at:         testCreatedAt.Add(3 * time.Minute),
			wantStatus: StatusFinished,
			wantTime:   testCreatedAt.Add(time.Minute),
			wantErr:    ErrInvalidTransition,
		},
		{
			name:       "transition before creation",
			at:         testCreatedAt.Add(-time.Nanosecond),
			wantStatus: StatusOpen,
			wantErr:    ErrInvalidTransition,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			room := newTestRoom(t)
			if test.prepare != nil {
				test.prepare(t, room)
			}

			err := room.Start(test.at)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Start() error = %v, want %v", err, test.wantErr)
			}

			if room.Status() != test.wantStatus {
				t.Errorf("Status() = %q, want %q", room.Status(), test.wantStatus)
			}

			gotTime, gotTimeOK := room.StartedAt()
			wantTimeOK := !test.wantTime.IsZero()
			if gotTimeOK != wantTimeOK || !gotTime.Equal(test.wantTime) {
				t.Errorf("StartedAt() = (%v, %t), want (%v, %t)", gotTime, gotTimeOK, test.wantTime, wantTimeOK)
			}
		})
	}
}

func TestRoomFinish(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(*testing.T, *Room)
		at         time.Time
		wantStatus Status
		wantTime   time.Time
		wantErr    error
	}{
		{
			name:       "open room",
			at:         testCreatedAt.Add(time.Minute),
			wantStatus: StatusOpen,
			wantErr:    ErrInvalidTransition,
		},
		{
			name: "active room",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Start(testCreatedAt.Add(time.Minute)); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
			},
			at:         testCreatedAt.Add(2 * time.Minute),
			wantStatus: StatusFinished,
			wantTime:   testCreatedAt.Add(2 * time.Minute),
		},
		{
			name: "finished room is idempotent",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				finishTestRoom(t, room)
			},
			at:         testCreatedAt.Add(3 * time.Minute),
			wantStatus: StatusFinished,
			wantTime:   testCreatedAt.Add(2 * time.Minute),
		},
		{
			name: "expired room",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Expire(room.ExpiresAt()); err != nil {
					t.Fatalf("Expire() error = %v", err)
				}
			},
			at:         testCreatedAt.Add(2 * OpenRoomLifetime),
			wantStatus: StatusExpired,
			wantErr:    ErrInvalidTransition,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			room := newTestRoom(t)
			if test.prepare != nil {
				test.prepare(t, room)
			}

			err := room.Finish(test.at)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Finish() error = %v, want %v", err, test.wantErr)
			}

			if room.Status() != test.wantStatus {
				t.Errorf("Status() = %q, want %q", room.Status(), test.wantStatus)
			}

			gotTime, gotTimeOK := room.FinishedAt()
			wantTimeOK := !test.wantTime.IsZero()
			if gotTimeOK != wantTimeOK || !gotTime.Equal(test.wantTime) {
				t.Errorf("FinishedAt() = (%v, %t), want (%v, %t)", gotTime, gotTimeOK, test.wantTime, wantTimeOK)
			}
		})
	}
}

func TestRoomExpire(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(*testing.T, *Room)
		at         time.Time
		wantStatus Status
		wantErr    error
	}{
		{
			name:       "open room at expiry",
			at:         testCreatedAt.Add(OpenRoomLifetime),
			wantStatus: StatusExpired,
		},
		{
			name:       "open room before expiry",
			at:         testCreatedAt.Add(OpenRoomLifetime - time.Nanosecond),
			wantStatus: StatusOpen,
			wantErr:    ErrRoomNotExpired,
		},
		{
			name: "active room",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Start(testCreatedAt.Add(time.Minute)); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
			},
			at:         testCreatedAt.Add(OpenRoomLifetime),
			wantStatus: StatusActive,
			wantErr:    ErrInvalidTransition,
		},
		{
			name: "expired room is idempotent",
			prepare: func(t *testing.T, room *Room) {
				t.Helper()

				if err := room.Expire(room.ExpiresAt()); err != nil {
					t.Fatalf("Expire() error = %v", err)
				}
			},
			at:         testCreatedAt.Add(2 * OpenRoomLifetime),
			wantStatus: StatusExpired,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			room := newTestRoom(t)
			if test.prepare != nil {
				test.prepare(t, room)
			}

			err := room.Expire(test.at)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Expire() error = %v, want %v", err, test.wantErr)
			}

			if room.Status() != test.wantStatus {
				t.Errorf("Status() = %q, want %q", room.Status(), test.wantStatus)
			}
		})
	}
}

func newTestRoom(t *testing.T) *Room {
	t.Helper()

	room, err := New("room-id", newTestInviteCode(t), "radio96_room-id", testCreatedAt)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	return room
}

func newTestInviteCode(t *testing.T) *InviteCode {
	t.Helper()

	inviteCode, err := ParseInviteCode(strings.Repeat("A", InviteCodeLength))
	if err != nil {
		t.Fatalf("ParseInviteCode() error = %v", err)
	}

	return inviteCode
}

func finishTestRoom(t *testing.T, room *Room) {
	t.Helper()

	if err := room.Start(testCreatedAt.Add(time.Minute)); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	if err := room.Finish(testCreatedAt.Add(2 * time.Minute)); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}
}
