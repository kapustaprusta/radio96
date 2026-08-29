package room

import "errors"

var (
	ErrInvalidDisplayName = errors.New("invalid display name")
	ErrInvalidInviteCode  = errors.New("invalid invite code")
	ErrInvalidRoom        = errors.New("invalid room")
	ErrInvalidTransition  = errors.New("invalid room transition")
	ErrRoomExpired        = errors.New("room expired")
	ErrRoomFinished       = errors.New("room finished")
	ErrRoomNotExpired     = errors.New("room is not expired yet")
)
