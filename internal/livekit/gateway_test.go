package livekit

import (
	"context"
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	livekitproto "github.com/livekit/protocol/livekit"

	"github.com/kapustaprusta/radio96/internal/room"
)

func TestNewGateway(t *testing.T) {
	tests := []struct {
		name      string
		serverURL string
		apiKey    string
		apiSecret string
		wantErr   string
	}{
		{
			name:      "secure WebSocket URL",
			serverURL: "wss://radio96.example.livekit.cloud",
			apiKey:    "api-key",
			apiSecret: "api-secret",
		},
		{
			name:      "local WebSocket URL",
			serverURL: "ws://localhost:7880",
			apiKey:    "api-key",
			apiSecret: "api-secret",
		},
		{
			name:      "empty URL",
			apiKey:    "api-key",
			apiSecret: "api-secret",
			wantErr:   "must use ws or wss",
		},
		{
			name:      "invalid URL",
			serverURL: "wss://room.example/%gh",
			apiKey:    "api-key",
			apiSecret: "api-secret",
			wantErr:   "parse LiveKit server URL",
		},
		{
			name:      "HTTP URL",
			serverURL: "https://radio96.example.livekit.cloud",
			apiKey:    "api-key",
			apiSecret: "api-secret",
			wantErr:   "must use ws or wss",
		},
		{
			name:      "URL without host",
			serverURL: "wss:///rooms",
			apiKey:    "api-key",
			apiSecret: "api-secret",
			wantErr:   "include a host",
		},
		{
			name: "credentials in URL",
			serverURL: (&url.URL{
				Scheme: "wss",
				Host:   "radio96.example.livekit.cloud",
				User:   url.User("user"),
			}).String(),
			apiKey:    "api-key",
			apiSecret: "api-secret",
			wantErr:   "must not contain credentials",
		},
		{
			name:      "empty API key",
			serverURL: "wss://radio96.example.livekit.cloud",
			apiSecret: "api-secret",
			wantErr:   "API key is required",
		},
		{
			name:      "blank API key",
			serverURL: "wss://radio96.example.livekit.cloud",
			apiKey:    "   ",
			apiSecret: "api-secret",
			wantErr:   "API key is required",
		},
		{
			name:      "empty API secret",
			serverURL: "wss://radio96.example.livekit.cloud",
			apiKey:    "api-key",
			wantErr:   "API secret is required",
		},
		{
			name:      "blank API secret",
			serverURL: "wss://radio96.example.livekit.cloud",
			apiKey:    "api-key",
			apiSecret: "   ",
			wantErr:   "API secret is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gateway, err := NewGateway(test.serverURL, test.apiKey, test.apiSecret)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("NewGateway() error = %v, want it to contain %q", err, test.wantErr)
				}

				if gateway != nil {
					t.Errorf("NewGateway() = %v, want nil", gateway)
				}

				return
			}

			if err != nil {
				t.Fatalf("NewGateway() error = %v", err)
			}

			if gateway == nil {
				t.Fatal("NewGateway() = nil, want gateway")
			}
		})
	}
}

func TestGatewayRoomState(t *testing.T) {
	serviceErr := errors.New("service unavailable")

	tests := []struct {
		name       string
		roomName   string
		response   *livekitproto.ListRoomsResponse
		serviceErr error
		want       room.MediaRoomState
		wantErr    string
		wantCalls  int
	}{
		{
			name:     "active room",
			roomName: "room-id",
			response: &livekitproto.ListRoomsResponse{
				Rooms: []*livekitproto.Room{
					{Name: "room-id", NumParticipants: 3},
				},
			},
			want:      room.MediaRoomState{Exists: true, ParticipantCount: 3},
			wantCalls: 1,
		},
		{
			name:      "room does not exist",
			roomName:  "room-id",
			response:  &livekitproto.ListRoomsResponse{},
			wantCalls: 1,
		},
		{
			name:     "ignores a different room",
			roomName: "room-id",
			response: &livekitproto.ListRoomsResponse{
				Rooms: []*livekitproto.Room{
					nil,
					{Name: "different-room", NumParticipants: 4},
				},
			},
			wantCalls: 1,
		},
		{
			name:       "room service fails",
			roomName:   "room-id",
			serviceErr: serviceErr,
			wantErr:    "service unavailable",
			wantCalls:  1,
		},
		{
			name:      "room service returns no response",
			roomName:  "room-id",
			wantErr:   "empty response",
			wantCalls: 1,
		},
		{
			name:    "empty room name",
			wantErr: "room name is required",
		},
		{
			name:     "blank room name",
			roomName: "   ",
			wantErr:  "room name is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &fakeRoomService{
				response: test.response,
				err:      test.serviceErr,
			}
			gateway := &Gateway{roomClient: client}

			got, err := gateway.RoomState(context.Background(), test.roomName)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("RoomState() error = %v, want it to contain %q", err, test.wantErr)
				}

				if got != nil {
					t.Errorf("RoomState() = %v, want nil", got)
				}
			} else {
				if err != nil {
					t.Fatalf("RoomState() error = %v", err)
				}

				if got == nil {
					t.Fatal("RoomState() = nil, want state")
				}

				if *got != test.want {
					t.Errorf("RoomState() = %+v, want %+v", *got, test.want)
				}
			}

			if len(client.requests) != test.wantCalls {
				t.Fatalf("ListRooms() calls = %d, want %d", len(client.requests), test.wantCalls)
			}

			if test.wantCalls == 1 {
				gotNames := client.requests[0].Names
				if len(gotNames) != 1 || gotNames[0] != test.roomName {
					t.Errorf("ListRooms() names = %v, want [%q]", gotNames, test.roomName)
				}
			}
		})
	}
}

func TestGatewayIssueParticipantTokenValidation(t *testing.T) {
	validRequest := room.ParticipantTokenRequest{
		RoomName:            "room-id",
		ParticipantIdentity: "participant-id",
		DisplayName:         "Alice",
		TTL:                 10 * time.Minute,
		MaxParticipants:     room.MaxParticipants,
	}

	tests := []struct {
		name    string
		prepare func(*room.ParticipantTokenRequest)
		wantErr string
	}{
		{
			name: "empty room name",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.RoomName = ""
			},
			wantErr: "room name is required",
		},
		{
			name: "empty participant identity",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.ParticipantIdentity = ""
			},
			wantErr: "participant identity is required",
		},
		{
			name: "blank display name",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.DisplayName = "   "
			},
			wantErr: "display name is required",
		},
		{
			name: "zero TTL",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.TTL = 0
			},
			wantErr: "TTL must be positive",
		},
		{
			name: "negative TTL",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.TTL = -time.Second
			},
			wantErr: "TTL must be positive",
		},
		{
			name: "zero maximum participants",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.MaxParticipants = 0
			},
			wantErr: "maximum participants must be positive",
		},
		{
			name: "negative maximum participants",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.MaxParticipants = -1
			},
			wantErr: "maximum participants must be positive",
		},
	}

	if strconv.IntSize == 64 {
		tests = append(tests, struct {
			name    string
			prepare func(*room.ParticipantTokenRequest)
			wantErr string
		}{
			name: "maximum participants overflows uint32",
			prepare: func(request *room.ParticipantTokenRequest) {
				request.MaxParticipants = int(uint64(math.MaxUint32) + 1)
			},
			wantErr: "maximum participants must fit uint32",
		})
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validRequest
			test.prepare(&request)

			gateway := &Gateway{
				serverURL: "wss://radio96.example.livekit.cloud",
				apiKey:    "api-key",
				apiSecret: "api-secret",
			}

			got, err := gateway.IssueParticipantToken(context.Background(), request)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("IssueParticipantToken() error = %v, want it to contain %q", err, test.wantErr)
			}

			if got != nil {
				t.Errorf("IssueParticipantToken() = %v, want nil", got)
			}
		})
	}
}

func TestGatewayIssueParticipantToken(t *testing.T) {
	const (
		serverURL = "wss://radio96.example.livekit.cloud"
		apiKey    = "api-key"
		apiSecret = "api-secret"
	)

	request := room.ParticipantTokenRequest{
		RoomName:            "room-id",
		ParticipantIdentity: "participant-id",
		DisplayName:         "Alice",
		TTL:                 10 * time.Minute,
		MaxParticipants:     room.MaxParticipants,
	}
	gateway := &Gateway{
		serverURL: serverURL,
		apiKey:    apiKey,
		apiSecret: apiSecret,
	}

	got, err := gateway.IssueParticipantToken(context.Background(), request)
	if err != nil {
		t.Fatalf("IssueParticipantToken() error = %v", err)
	}

	if got == nil {
		t.Fatal("IssueParticipantToken() = nil, want token")
	}

	if got.ServerURL != serverURL {
		t.Errorf("ServerURL = %q, want %q", got.ServerURL, serverURL)
	}

	if got.Value == "" {
		t.Fatal("Value = empty, want signed token")
	}

	verifier, err := auth.ParseAPIToken(got.Value)
	if err != nil {
		t.Fatalf("ParseAPIToken() error = %v", err)
	}

	if verifier.APIKey() != apiKey {
		t.Errorf("APIKey() = %q, want %q", verifier.APIKey(), apiKey)
	}

	claims, grants, err := verifier.Verify(apiSecret)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}

	if claims.Subject != request.ParticipantIdentity {
		t.Errorf("token subject = %q, want %q", claims.Subject, request.ParticipantIdentity)
	}

	if claims.ExpiresAt.Sub(claims.IssuedAt.Time) != request.TTL {
		t.Errorf(
			"token TTL = %s, want %s",
			claims.ExpiresAt.Sub(claims.IssuedAt.Time),
			request.TTL,
		)
	}

	if grants.Identity != request.ParticipantIdentity || grants.Name != request.DisplayName {
		t.Errorf(
			"participant = (%q, %q), want (%q, %q)",
			grants.Identity,
			grants.Name,
			request.ParticipantIdentity,
			request.DisplayName,
		)
	}

	videoGrant := grants.Video
	if videoGrant == nil {
		t.Fatal("video grant = nil, want room grant")
	}

	if !videoGrant.RoomJoin || videoGrant.Room != request.RoomName {
		t.Errorf("room grant = (%t, %q), want (true, %q)", videoGrant.RoomJoin, videoGrant.Room, request.RoomName)
	}

	if !videoGrant.GetCanPublishSource(livekitproto.TrackSource_MICROPHONE) {
		t.Error("microphone publishing is disabled, want enabled")
	}

	for _, source := range []livekitproto.TrackSource{
		livekitproto.TrackSource_CAMERA,
		livekitproto.TrackSource_SCREEN_SHARE,
		livekitproto.TrackSource_SCREEN_SHARE_AUDIO,
	} {
		if videoGrant.GetCanPublishSource(source) {
			t.Errorf("publishing source %s is enabled, want disabled", source)
		}
	}

	if videoGrant.GetCanPublishData() {
		t.Error("data publishing is enabled, want disabled")
	}

	if !videoGrant.GetCanSubscribe() {
		t.Error("subscribing is disabled, want enabled")
	}

	if videoGrant.GetCanUpdateOwnMetadata() {
		t.Error("own metadata updates are enabled, want disabled")
	}

	if grants.RoomConfig == nil || grants.RoomConfig.MaxParticipants != room.MaxParticipants {
		t.Errorf("room max participants = %v, want %d", grants.RoomConfig, request.MaxParticipants)
	}
}

type fakeRoomService struct {
	response *livekitproto.ListRoomsResponse
	err      error
	requests []*livekitproto.ListRoomsRequest
}

func (service *fakeRoomService) ListRooms(
	_ context.Context,
	request *livekitproto.ListRoomsRequest,
) (*livekitproto.ListRoomsResponse, error) {
	service.requests = append(service.requests, request)

	return service.response, service.err
}
