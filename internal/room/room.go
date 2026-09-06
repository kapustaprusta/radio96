package room

import (
	"fmt"
	"strings"
	"time"
)

const (
	MaxParticipants  = 8
	OpenRoomLifetime = time.Hour
)

type Status string

const (
	StatusOpen     Status = "open"
	StatusActive   Status = "active"
	StatusFinished Status = "finished"
	StatusExpired  Status = "expired"
)

type Room struct {
	id         string
	name       string
	status     Status
	inviteCode *InviteCode
	createdAt  time.Time
	expiresAt  time.Time
	startedAt  *time.Time
	finishedAt *time.Time
}

type RestoreRoomParams struct {
	ID         string
	InviteCode *InviteCode
	Name       string
	Status     Status
	CreatedAt  time.Time
	ExpiresAt  time.Time
	StartedAt  *time.Time
	FinishedAt *time.Time
}

func New(id string, inviteCode *InviteCode, name string, createdAt time.Time) (*Room, error) {
	createdAt = createdAt.UTC()

	return Restore(RestoreRoomParams{
		ID:         id,
		InviteCode: inviteCode,
		Name:       name,
		Status:     StatusOpen,
		CreatedAt:  createdAt,
		ExpiresAt:  createdAt.Add(OpenRoomLifetime),
	})
}

func Restore(params RestoreRoomParams) (*Room, error) {
	if strings.TrimSpace(params.ID) == "" {
		return nil, fmt.Errorf("%w: ID is required", ErrInvalidRoom)
	}

	if params.InviteCode == nil {
		return nil, fmt.Errorf("%w: invite code is required", ErrInvalidRoom)
	}

	if strings.TrimSpace(params.Name) == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidRoom)
	}

	if params.CreatedAt.IsZero() {
		return nil, fmt.Errorf("%w: creation time is required", ErrInvalidRoom)
	}

	if params.ExpiresAt.IsZero() || !params.ExpiresAt.After(params.CreatedAt) {
		return nil, fmt.Errorf("%w: expiry time must follow creation", ErrInvalidRoom)
	}

	createdAt := params.CreatedAt.UTC()
	expiresAt := params.ExpiresAt.UTC()
	startedAt := normalizedTime(params.StartedAt)
	finishedAt := normalizedTime(params.FinishedAt)

	if startedAt != nil && (startedAt.IsZero() || startedAt.Before(createdAt)) {
		return nil, fmt.Errorf("%w: start time cannot precede creation", ErrInvalidRoom)
	}

	if finishedAt != nil && (finishedAt.IsZero() || startedAt == nil || finishedAt.Before(*startedAt)) {
		return nil, fmt.Errorf("%w: finish time cannot precede start", ErrInvalidRoom)
	}

	if err := validateRestoredStatus(params.Status, startedAt, finishedAt); err != nil {
		return nil, err
	}

	return &Room{
		id:         params.ID,
		name:       params.Name,
		status:     params.Status,
		inviteCode: params.InviteCode,
		createdAt:  createdAt,
		expiresAt:  expiresAt,
		startedAt:  startedAt,
		finishedAt: finishedAt,
	}, nil
}

func normalizedTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	normalized := value.UTC()

	return &normalized
}

func validateRestoredStatus(status Status, startedAt, finishedAt *time.Time) error {
	valid := false

	switch status {
	case StatusOpen, StatusExpired:
		valid = startedAt == nil && finishedAt == nil
	case StatusActive:
		valid = startedAt != nil && finishedAt == nil
	case StatusFinished:
		valid = startedAt != nil && finishedAt != nil
	}

	if !valid {
		return fmt.Errorf("%w: timestamps do not match status %q", ErrInvalidRoom, status)
	}

	return nil
}

func (r *Room) ID() string {
	return r.id
}

func (r *Room) InviteCode() *InviteCode {
	return r.inviteCode
}

func (r *Room) Name() string {
	return r.name
}

func (r *Room) Status() Status {
	return r.status
}

func (r *Room) CreatedAt() time.Time {
	return r.createdAt
}

func (r *Room) ExpiresAt() time.Time {
	return r.expiresAt
}

func (r *Room) StartedAt() (time.Time, bool) {
	if r.startedAt == nil {
		return time.Time{}, false
	}

	return *r.startedAt, true
}

func (r *Room) FinishedAt() (time.Time, bool) {
	if r.finishedAt == nil {
		return time.Time{}, false
	}

	return *r.finishedAt, true
}

func (r *Room) ValidateJoin(at time.Time) error {
	switch r.status {
	case StatusOpen:
		if !at.Before(r.expiresAt) {
			return ErrRoomExpired
		}

		return nil
	case StatusActive:
		return nil
	case StatusFinished:
		return ErrRoomFinished
	case StatusExpired:
		return ErrRoomExpired
	default:
		return fmt.Errorf("%w: unknown status %q", ErrInvalidRoom, r.status)
	}
}

func (r *Room) Start(at time.Time) error {
	if r.status == StatusActive {
		return nil
	}

	if r.status != StatusOpen {
		return transitionError(r.status, StatusActive)
	}

	at, err := r.transitionTime(at)
	if err != nil {
		return err
	}

	r.status = StatusActive
	r.startedAt = &at

	return nil
}

func (r *Room) Finish(at time.Time) error {
	if r.status == StatusFinished {
		return nil
	}

	if r.status != StatusActive {
		return transitionError(r.status, StatusFinished)
	}

	at, err := r.transitionTime(at)
	if err != nil {
		return err
	}

	r.status = StatusFinished
	r.finishedAt = &at

	return nil
}

func (r *Room) Expire(at time.Time) error {
	if r.status == StatusExpired {
		return nil
	}

	if r.status != StatusOpen {
		return transitionError(r.status, StatusExpired)
	}

	at = at.UTC()
	if at.Before(r.expiresAt) {
		return ErrRoomNotExpired
	}

	r.status = StatusExpired

	return nil
}

func (r *Room) transitionTime(at time.Time) (time.Time, error) {
	if at.IsZero() || at.Before(r.createdAt) {
		return time.Time{}, fmt.Errorf("%w: transition time cannot precede creation", ErrInvalidTransition)
	}

	return at.UTC(), nil
}

func transitionError(from, to Status) error {
	return fmt.Errorf("%w: %s to %s", ErrInvalidTransition, from, to)
}
