package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/room"
)

func TestNewInvalidConfiguration(t *testing.T) {
	secret := strings.Repeat("x", 32)
	tests := []struct {
		name   string
		config *config.Config
		want   string
	}{
		{name: "nil config", want: "configuration is required"},
		{
			name:   "missing database",
			config: &config.Config{MediaRequestTimeout: time.Second, DatabaseConnectTimeout: time.Second},
			want:   "DATABASE_URL is required",
		},
		{
			name: "malformed database hides connection string",
			config: &config.Config{
				DatabaseURL:         "postgres://%invalid/" + secret,
				MediaRequestTimeout: time.Second, DatabaseConnectTimeout: time.Second,
			},
			want: "invalid PostgreSQL connection string",
		},
		{
			name:   "malformed media configuration hides URL",
			config: &config.Config{MediaRequestTimeout: time.Second, LiveKitURL: "wss://%invalid/" + secret},
			want:   "configure LiveKit: invalid URL or credentials",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			application, err := New(t.Context(), test.config, discardLogger())
			if application != nil {
				application.Close()
				t.Fatal("New() returned an application for invalid configuration")
			}

			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("New() error did not contain %q", test.want)
			}

			if strings.Contains(err.Error(), secret) {
				t.Error("startup error exposed a secret")
			}
		})
	}
}

func TestBoundedMediaGateway(t *testing.T) {
	operations := []struct {
		name    string
		execute func(context.Context, *boundedMediaGateway) error
	}{
		{
			name: "room state",
			execute: func(ctx context.Context, gateway *boundedMediaGateway) error {
				_, err := gateway.RoomState(ctx, "room-id")
				return err
			},
		},
		{
			name: "participant token",
			execute: func(ctx context.Context, gateway *boundedMediaGateway) error {
				_, err := gateway.IssueParticipantToken(ctx, room.ParticipantTokenRequest{})
				return err
			},
		},
	}
	tests := []struct {
		name     string
		provider room.MediaGateway
		cancel   bool
		want     error
	}{
		{name: "unconfigured", want: room.ErrMediaUnavailable},
		{name: "deadline", provider: waitingMediaGateway{}, want: context.DeadlineExceeded},
		{name: "parent cancellation", provider: waitingMediaGateway{}, cancel: true, want: context.Canceled},
	}

	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			for _, test := range tests {
				t.Run(test.name, func(t *testing.T) {
					ctx, cancel := context.WithCancel(t.Context())
					defer cancel()
					if test.cancel {
						cancel()
					}

					gateway := &boundedMediaGateway{provider: test.provider, timeout: 10 * time.Millisecond}
					if err := operation.execute(ctx, gateway); !errors.Is(err, test.want) {
						t.Errorf("operation error = %v, want %v", err, test.want)
					}
				})
			}
		})
	}
}

func TestConfiguredMediaGatewayCreatesBoundedRoom(t *testing.T) {
	mediaServer := newTestLiveKitServer(t)
	t.Cleanup(mediaServer.Close)

	gateway, err := configuredMediaGateway(&config.Config{
		MediaRequestTimeout: time.Second,
		LiveKitURL:          "ws" + strings.TrimPrefix(mediaServer.URL, "http"),
		LiveKitAPIKey:       "test-key", LiveKitAPISecret: strings.Repeat("x", 32),
	})
	if err != nil {
		t.Fatalf("configuredMediaGateway() error = %v", err)
	}

	state, err := gateway.RoomState(t.Context(), "room-id")
	if err != nil || state == nil || state.Exists {
		t.Fatalf("RoomState() = (%v, %v), want absent room", state, err)
	}

	token, err := gateway.IssueParticipantToken(t.Context(), room.ParticipantTokenRequest{
		RoomName: "room-id", ParticipantIdentity: "participant-id", DisplayName: "Alice",
		TTL: time.Minute, MaxParticipants: room.MaxParticipants,
	})
	if err != nil || token == nil || token.Value == "" {
		t.Fatalf("IssueParticipantToken() = (%v, %v), want token", token, err)
	}
}

type waitingMediaGateway struct{}

func (waitingMediaGateway) RoomState(ctx context.Context, _ string) (*room.MediaRoomState, error) {
	<-ctx.Done()

	return nil, ctx.Err()
}

func (waitingMediaGateway) IssueParticipantToken(
	ctx context.Context,
	_ room.ParticipantTokenRequest,
) (*room.ParticipantToken, error) {
	<-ctx.Done()

	return nil, ctx.Err()
}
