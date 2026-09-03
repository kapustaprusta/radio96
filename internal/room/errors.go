package room

import "errors"

var (
	ErrConcurrentRoomUpdate = errors.New("room was updated concurrently")
	ErrInvalidDisplayName   = errors.New("invalid display name")
	ErrInvalidInviteCode    = errors.New("invalid invite code")
	ErrInvalidRoom          = errors.New("invalid room")
	ErrInvalidTransition    = errors.New("invalid room transition")
	ErrRoomExpired          = errors.New("room expired")
	ErrRoomFinished         = errors.New("room finished")
	ErrRoomFull             = errors.New("room full")
	ErrRoomNotFound         = errors.New("room not found")
	ErrRoomNotExpired       = errors.New("room is not expired yet")
	ErrMediaUnavailable     = errors.New("media unavailable")
)
