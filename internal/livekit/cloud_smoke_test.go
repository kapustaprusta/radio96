package livekit

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"
	"time"

	livekitproto "github.com/livekit/protocol/livekit"
	protologger "github.com/livekit/protocol/logger"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"github.com/kapustaprusta/radio96/internal/room"
)

// This test checks the real media path, not application admission. PostgreSQL
// admission tests verify that concurrent API requests can return only eight
// credentials; LiveKit Cloud did not enforce max_participants in our smoke run.
func TestLiveKitCloudEightParticipants(t *testing.T) {
	if os.Getenv("LIVEKIT_CLOUD_SMOKE") != "1" {
		t.Skip("set LIVEKIT_CLOUD_SMOKE=1 to run against a LiveKit project")
	}

	serverURL := os.Getenv("LIVEKIT_URL")
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	if serverURL == "" || apiKey == "" || apiSecret == "" {
		t.Fatal("LiveKit Cloud credentials are required")
	}

	gateway, err := NewGateway(serverURL, apiKey, apiSecret)
	if err != nil {
		t.Fatal("invalid LiveKit Cloud configuration")
	}

	roomName := "radio96-smoke-" + rand.Text()
	cleanupClient := lksdk.NewRoomServiceClient(serverURL, apiKey, apiSecret)
	connected := make([]*lksdk.Room, 0, room.MaxParticipants)
	t.Cleanup(func() {
		for _, participant := range connected {
			participant.Disconnect()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = cleanupClient.DeleteRoom(ctx, &livekitproto.DeleteRoomRequest{Room: roomName})
	})

	for index := range room.MaxParticipants {
		ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
		credential, err := gateway.IssueParticipantToken(ctx, room.ParticipantTokenRequest{
			RoomName: roomName, ParticipantIdentity: fmt.Sprintf("participant-%d", index),
			DisplayName: "Тест", TTL: time.Minute, MaxParticipants: room.MaxParticipants,
		})
		cancel()
		if err != nil {
			t.Fatalf("issue token for participant %d: %T", index, err)
		}

		if index == 0 {
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			identities, listErr := gateway.ParticipantIdentities(ctx, roomName)
			cancel()
			if listErr != nil || len(identities) != 0 {
				t.Fatalf("new media room participants = %d, error type = %T; want zero", len(identities), listErr)
			}
		}

		participant, err := lksdk.ConnectToRoomWithToken(serverURL, credential.Value, nil,
			lksdk.WithConnectTimeout(15*time.Second), lksdk.WithLogger(protologger.GetDiscardLogger()))
		if err != nil {
			t.Fatalf("join participant %d failed: %T", index, err)
		}

		connected = append(connected, participant)
	}

	deadline := time.Now().Add(10 * time.Second)
	for {
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		state, stateErr := gateway.RoomState(ctx, roomName)
		identities, listErr := gateway.ParticipantIdentities(ctx, roomName)
		cancel()
		if stateErr == nil && listErr == nil && state != nil && state.ParticipantCount == room.MaxParticipants &&
			state.MaxParticipants == room.MaxParticipants && len(identities) == room.MaxParticipants {
			return
		}

		if time.Now().After(deadline) {
			t.Fatalf("media room did not report eight participants: state=%v, identities=%d, errors=(%T,%T)",
				state, len(identities), stateErr, listErr)
		}

		time.Sleep(200 * time.Millisecond)
	}
}
