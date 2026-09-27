package room

import (
	"context"
	"time"
)

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	Generate() (string, error)
}

type InviteCodeGenerator interface {
	Generate() (*InviteCode, error)
}

type RoomCreator interface {
	Create(ctx context.Context, room *Room) error
}

type RoomRepository interface {
	FindByInviteCode(ctx context.Context, inviteCode *InviteCode) (*Room, error)
	Update(ctx context.Context, room *Room) error
}

type MediaRoomState struct {
	Exists           bool
	ParticipantCount int
	MaxParticipants  int
}

type ParticipantTokenRequest struct {
	RoomName            string
	ParticipantIdentity string
	DisplayName         string
	TTL                 time.Duration
	MaxParticipants     int
}

type ParticipantToken struct {
	ServerURL string
	Value     string
}

// AdmissionStore counts unexpired tokens that are not currently in LiveKit.
// Reserve must serialize requests for the same room across application instances.
type AdmissionStore interface {
	Reserve(ctx context.Context, roomName, identity string, connectedIdentities []string,
		expiresAt time.Time, maxParticipants int) error
}

type MediaGateway interface {
	RoomState(ctx context.Context, roomName string) (*MediaRoomState, error)
	ParticipantIdentities(ctx context.Context, roomName string) ([]string, error)
	IssueParticipantToken(ctx context.Context, request ParticipantTokenRequest) (*ParticipantToken, error)
}
