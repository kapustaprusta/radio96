package room

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeLifecycleStore struct {
	events     []LifecycleEvent
	candidates []LifecycleCandidate
	action     LifecycleAction
	locked     bool
	released   bool
}

func (store *fakeLifecycleStore) ApplyEvent(_ context.Context, event LifecycleEvent) error {
	store.events = append(store.events, event)
	return nil
}

func (store *fakeLifecycleStore) CleanupExpiredAdmissions(context.Context, time.Time) error {
	return nil
}

func (store *fakeLifecycleStore) Candidates(context.Context, time.Time) ([]LifecycleCandidate, error) {
	return store.candidates, nil
}

func (store *fakeLifecycleStore) Start(context.Context, string, time.Time) error {
	store.action = LifecycleStart
	return nil
}

func (store *fakeLifecycleStore) Idle(context.Context, string, time.Time) error {
	store.action = LifecycleIdle
	return nil
}

func (store *fakeLifecycleStore) Finish(context.Context, string, time.Time) error {
	store.action = "finish"
	return nil
}

func (store *fakeLifecycleStore) Expire(context.Context, string, time.Time) error {
	store.action = "expire"
	return nil
}

func (store *fakeLifecycleStore) TryReconcileLock(context.Context) (func(context.Context), bool, error) {
	if !store.locked {
		return nil, false, nil
	}

	return func(context.Context) { store.released = true }, true, nil
}

func TestHandleLifecycleEvent(t *testing.T) {
	tests := []struct {
		name         string
		event        LifecycleEvent
		media        *MediaRoomState
		participants []string
		wantAction   LifecycleAction
		wantErr      error
	}{
		{name: "started", event: LifecycleEvent{ID: "one", Type: "room_started", RoomName: "media", At: testCreatedAt},
			wantAction: LifecycleStart},
		{name: "media room closed", event: LifecycleEvent{ID: "two", Type: "room_finished", RoomName: "media", At: testCreatedAt},
			media: &MediaRoomState{}, wantAction: LifecycleIdle},
		{name: "participant rejoined", event: LifecycleEvent{ID: "joined", Type: "participant_joined", RoomName: "media", At: testCreatedAt},
			wantAction: LifecycleStart},
		{name: "unrelated event", event: LifecycleEvent{ID: "three", Type: "track_published", At: testCreatedAt},
			wantAction: LifecycleIgnore},
		{name: "last participant leaves", event: LifecycleEvent{ID: "last", Type: "participant_left",
			RoomName: "media", ParticipantIdentity: "alice", At: testCreatedAt},
			media: &MediaRoomState{Exists: true}, wantAction: LifecycleIdle},
		{name: "departure before media count updates", event: LifecycleEvent{ID: "stale", Type: "participant_left",
			RoomName: "media", ParticipantIdentity: "alice", At: testCreatedAt},
			media:        &MediaRoomState{Exists: true, ParticipantCount: 1},
			participants: []string{"alice"}, wantAction: LifecycleIdle},
		{name: "other participant remains", event: LifecycleEvent{ID: "other", Type: "participant_left",
			RoomName: "media", ParticipantIdentity: "alice", At: testCreatedAt},
			media:        &MediaRoomState{Exists: true, ParticipantCount: 1},
			participants: []string{"bob"}, wantAction: LifecycleIgnore},
		{name: "more participants remain", event: LifecycleEvent{ID: "many", Type: "participant_left",
			RoomName: "media", ParticipantIdentity: "alice", At: testCreatedAt},
			media: &MediaRoomState{Exists: true, ParticipantCount: 2}, wantAction: LifecycleIgnore},
		{name: "missing ID", event: LifecycleEvent{Type: "room_started", RoomName: "media", At: testCreatedAt},
			wantErr: ErrInvalidRoom},
		{name: "missing lifecycle room", event: LifecycleEvent{ID: "four", Type: "room_finished", At: testCreatedAt},
			wantErr: ErrInvalidRoom},
		{name: "missing departing identity", event: LifecycleEvent{ID: "five", Type: "participant_left",
			RoomName: "media", At: testCreatedAt}, wantErr: ErrInvalidRoom},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeLifecycleStore{}
			media := &fakeMediaGateway{state: test.media, participants: test.participants}
			err := NewHandleLifecycleEvent(store, media).Execute(t.Context(), test.event)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Execute() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if len(store.events) != 0 {
					t.Errorf("stored events = %d, want 0", len(store.events))
				}

				return
			}

			if len(store.events) != 1 || store.events[0].Action != test.wantAction {
				t.Errorf("stored events = %+v, want action %q", store.events, test.wantAction)
			}
		})
	}
}

func TestReconcileRooms(t *testing.T) {
	tests := []struct {
		name        string
		status      Status
		media       *MediaRoomState
		now         time.Time
		locked      bool
		lastEmptyAt time.Time
		wantAction  LifecycleAction
	}{
		{name: "active media starts open room", status: StatusOpen, media: &MediaRoomState{Exists: true, ParticipantCount: 1},
			now: testCreatedAt.Add(time.Minute), locked: true, wantAction: LifecycleStart},
		{name: "active media recovers a recently expired room", status: StatusExpired,
			media: &MediaRoomState{Exists: true, ParticipantCount: 1},
			now:   testCreatedAt.Add(time.Minute), locked: true, wantAction: LifecycleStart},
		{name: "unused link expires", status: StatusOpen, media: &MediaRoomState{},
			now: testCreatedAt.Add(2 * OpenRoomLifetime), locked: true, wantAction: "expire"},
		{name: "unexpired link stays open", status: StatusOpen, media: &MediaRoomState{},
			now: testCreatedAt.Add(time.Minute), locked: true},
		{name: "empty active room starts grace period", status: StatusActive, media: &MediaRoomState{Exists: true},
			now: testCreatedAt.Add(time.Minute), locked: true, wantAction: LifecycleIdle},
		{name: "missing active room starts grace period", status: StatusActive, media: &MediaRoomState{},
			now: testCreatedAt.Add(time.Minute), locked: true, wantAction: LifecycleIdle},
		{name: "empty active room remains within grace", status: StatusActive, media: &MediaRoomState{},
			lastEmptyAt: testCreatedAt.Add(time.Minute), now: testCreatedAt.Add(2 * time.Minute), locked: true},
		{name: "empty active room finishes after grace", status: StatusActive, media: &MediaRoomState{},
			lastEmptyAt: testCreatedAt.Add(time.Minute), now: testCreatedAt.Add(11 * time.Minute),
			locked: true, wantAction: "finish"},
		{name: "rejoined room resets empty timer", status: StatusActive, media: &MediaRoomState{Exists: true, ParticipantCount: 1},
			lastEmptyAt: testCreatedAt.Add(time.Minute), now: testCreatedAt.Add(2 * time.Minute),
			locked: true, wantAction: LifecycleStart},
		{name: "occupied active room remains", status: StatusActive, media: &MediaRoomState{Exists: true, ParticipantCount: 2},
			now: testCreatedAt.Add(time.Minute), locked: true},
		{name: "another replica holds lock", status: StatusActive, media: &MediaRoomState{},
			now: testCreatedAt.Add(time.Minute)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeLifecycleStore{locked: test.locked, candidates: []LifecycleCandidate{{
				Name: "media", Status: test.status, ExpiresAt: testCreatedAt.Add(OpenRoomLifetime),
				LastEmptyAt: test.lastEmptyAt,
			}}}
			media := &fakeMediaGateway{state: test.media}
			err := NewReconcileRooms(store, media, &fakeClock{now: test.now}).Execute(t.Context())
			if err != nil {
				t.Fatalf("Execute() error = %v", err)
			}

			if store.action != test.wantAction || store.released != test.locked {
				t.Errorf("action = %q, released = %t; want %q, %t", store.action, store.released,
					test.wantAction, test.locked)
			}

			if test.locked && media.stateCalls != 1 || !test.locked && media.stateCalls != 0 {
				t.Errorf("RoomState() calls = %d, locked = %t", media.stateCalls, test.locked)
			}
		})
	}
}
