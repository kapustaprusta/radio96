package room

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type LifecycleAction string

const (
	LifecycleIgnore LifecycleAction = "ignore"
	LifecycleStart  LifecycleAction = "start"
	LifecycleIdle   LifecycleAction = "idle"
)

type LifecycleEvent struct {
	ID                  string
	RoomName            string
	ParticipantIdentity string
	Type                string
	At                  time.Time
	Action              LifecycleAction
}

type LifecycleCandidate struct {
	Name        string
	Status      Status
	ExpiresAt   time.Time
	LastEmptyAt time.Time
}

type LifecycleStore interface {
	ApplyEvent(ctx context.Context, event LifecycleEvent) error
	CleanupExpiredAdmissions(ctx context.Context, now time.Time) error
	Candidates(ctx context.Context, now time.Time) ([]LifecycleCandidate, error)
	Start(ctx context.Context, name string, at time.Time) error
	Idle(ctx context.Context, name string, at time.Time) error
	Finish(ctx context.Context, name string, at time.Time) error
	Expire(ctx context.Context, name string, at time.Time) error
	TryReconcileLock(ctx context.Context) (release func(context.Context), acquired bool, err error)
}

type HandleLifecycleEvent struct {
	store LifecycleStore
	media MediaGateway
}

func NewHandleLifecycleEvent(store LifecycleStore, media MediaGateway) *HandleLifecycleEvent {
	return &HandleLifecycleEvent{store: store, media: media}
}

func (useCase *HandleLifecycleEvent) Execute(ctx context.Context, event LifecycleEvent) error {
	if strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.Type) == "" || event.At.IsZero() {
		return fmt.Errorf("%w: incomplete lifecycle event", ErrInvalidRoom)
	}

	if (event.Type == "room_started" || event.Type == "room_finished" ||
		event.Type == "participant_joined" || event.Type == "participant_left") &&
		strings.TrimSpace(event.RoomName) == "" {
		return fmt.Errorf("%w: lifecycle room name is required", ErrInvalidRoom)
	}

	if event.Type == "participant_left" && strings.TrimSpace(event.ParticipantIdentity) == "" {
		return fmt.Errorf("%w: departing participant identity is required", ErrInvalidRoom)
	}

	event.Action = LifecycleIgnore
	switch event.Type {
	case "room_started", "participant_joined":
		event.Action = LifecycleStart
	case "room_finished":
		state, err := useCase.media.RoomState(ctx, event.RoomName)
		if err != nil || state == nil {
			return fmt.Errorf("%w: inspect room after media closure", ErrMediaUnavailable)
		}

		if !state.Exists || state.ParticipantCount == 0 {
			event.Action = LifecycleIdle
		}
	case "participant_left":
		state, err := useCase.media.RoomState(ctx, event.RoomName)
		if err != nil || state == nil {
			return fmt.Errorf("%w: inspect room after participant departure", ErrMediaUnavailable)
		}

		if !state.Exists || state.ParticipantCount == 0 {
			event.Action = LifecycleIdle
		} else if state.ParticipantCount == 1 {
			identities, err := useCase.media.ParticipantIdentities(ctx, event.RoomName)
			if err != nil {
				return fmt.Errorf("%w: list participants after departure", ErrMediaUnavailable)
			}

			if len(identities) == 0 || len(identities) == 1 && identities[0] == event.ParticipantIdentity {
				event.Action = LifecycleIdle
			}
		}
	}

	return useCase.store.ApplyEvent(ctx, event)
}

type ReconcileRooms struct {
	store LifecycleStore
	media MediaGateway
	clock Clock
}

func NewReconcileRooms(store LifecycleStore, media MediaGateway, clock Clock) *ReconcileRooms {
	return &ReconcileRooms{store: store, media: media, clock: clock}
}

func (useCase *ReconcileRooms) Execute(ctx context.Context) error {
	release, acquired, err := useCase.store.TryReconcileLock(ctx)
	if err != nil {
		return fmt.Errorf("acquire reconciliation lock: %w", err)
	}

	if !acquired {
		return nil
	}

	defer release(ctx)
	if err := useCase.store.CleanupExpiredAdmissions(ctx, useCase.clock.Now()); err != nil {
		return fmt.Errorf("remove expired room admissions: %w", err)
	}

	candidates, err := useCase.store.Candidates(ctx, useCase.clock.Now())
	if err != nil {
		return fmt.Errorf("list lifecycle candidates: %w", err)
	}

	var failures []error
	for _, candidate := range candidates {
		if err := useCase.reconcileOne(ctx, candidate); err != nil {
			failures = append(failures, err)
		}
	}

	return errors.Join(failures...)
}

func (useCase *ReconcileRooms) reconcileOne(ctx context.Context, candidate LifecycleCandidate) error {
	state, err := useCase.media.RoomState(ctx, candidate.Name)
	if err != nil || state == nil {
		return fmt.Errorf("%w: inspect lifecycle candidate", ErrMediaUnavailable)
	}

	now := useCase.clock.Now()
	switch candidate.Status {
	case StatusOpen:
		if state.Exists && state.ParticipantCount > 0 {
			return useCase.store.Start(ctx, candidate.Name, now)
		}

		if !now.Before(candidate.ExpiresAt) {
			return useCase.store.Expire(ctx, candidate.Name, now)
		}
	case StatusActive:
		if state.Exists && state.ParticipantCount > 0 {
			if !candidate.LastEmptyAt.IsZero() {
				return useCase.store.Start(ctx, candidate.Name, now)
			}

			return nil
		}

		if candidate.LastEmptyAt.IsZero() {
			return useCase.store.Idle(ctx, candidate.Name, now)
		}

		if !now.Before(candidate.LastEmptyAt.Add(EmptyRoomLifetime)) {
			return useCase.store.Finish(ctx, candidate.Name, now)
		}
	case StatusExpired:
		if state.Exists && state.ParticipantCount > 0 {
			return useCase.store.Start(ctx, candidate.Name, now)
		}
	case StatusFinished:
		return nil
	}

	return nil
}
