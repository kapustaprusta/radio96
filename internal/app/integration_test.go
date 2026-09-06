package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/room"
)

func TestApplicationRoomFlow(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	t.Cleanup(cancel)
	container, err := tcpostgres.Run(
		ctx,
		"postgres:17-alpine",
		tcpostgres.WithDatabase("radio96"),
		tcpostgres.WithUsername("radio96"),
		tcpostgres.WithPassword("radio96"),
		tcpostgres.WithInitScripts(filepath.Join("..", "..", "db", "migrations", "000001_create_rooms.up.sql")),
		tcpostgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL: %v", err)
	}

	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get database URL: %v", err)
	}

	tests := []struct {
		name           string
		configureMedia bool
		wantJoinStatus int
	}{
		{name: "local mode", wantJoinStatus: http.StatusServiceUnavailable},
		{name: "configured token issuer", configureMedia: true, wantJoinStatus: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cfg := &config.Config{
				HTTPAddress: "127.0.0.1:0", ShutdownTimeout: time.Second,
				DatabaseURL: databaseURL, DatabaseConnectTimeout: 5 * time.Second, MediaRequestTimeout: time.Second,
			}
			if test.configureMedia {
				cfg.LiveKitURL = "wss://livekit.example.test"
				cfg.LiveKitAPIKey = "test-key"
				cfg.LiveKitAPISecret = strings.Repeat("x", 32)
			}

			application, err := New(ctx, cfg, discardLogger())
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}

			t.Cleanup(application.Close)
			handler := application.server.Handler
			requestStatus(t, ctx, handler, http.MethodGet, "/readyz", "", http.StatusOK)
			created := requestStatus(t, ctx, handler, http.MethodPost, "/api/v1/rooms", "", http.StatusCreated)
			var createdRoom struct {
				RoomID          string    `json:"roomId"`
				InviteURL       string    `json:"inviteUrl"`
				ExpiresAt       time.Time `json:"expiresAt"`
				MaxParticipants int       `json:"maxParticipants"`
			}
			if err := json.Unmarshal(created.Body.Bytes(), &createdRoom); err != nil {
				t.Fatal("decode created room")
			}

			if createdRoom.RoomID == "" || createdRoom.MaxParticipants != room.MaxParticipants || createdRoom.ExpiresAt.IsZero() {
				t.Fatal("create response is incomplete")
			}

			inviteCode, err := room.ParseInviteCode(strings.TrimPrefix(createdRoom.InviteURL, "/rooms/"))
			if err != nil || !strings.HasPrefix(createdRoom.InviteURL, "/rooms/") {
				t.Fatal("invalid same-origin invite URL")
			}

			var storedHash []byte
			if err := application.database.QueryRow(ctx, "SELECT invite_code_hash FROM rooms WHERE id = $1", createdRoom.RoomID).
				Scan(&storedHash); err != nil {
				t.Fatalf("select stored hash: %v", err)
			}

			if !bytes.Equal(storedHash, inviteCode.Hash().Bytes()) {
				t.Fatal("database did not persist the invite hash")
			}

			roomPath := "/api/v1/rooms/" + inviteCode.Value()
			found := requestStatus(t, ctx, handler, http.MethodGet, roomPath, "", http.StatusOK)
			var roomStatus struct {
				Status string `json:"status"`
			}
			if err := json.Unmarshal(found.Body.Bytes(), &roomStatus); err != nil || roomStatus.Status != "open" {
				t.Fatal("newly created room is not open")
			}

			joined := requestStatus(t, ctx, handler, http.MethodPost, roomPath+"/join", `{"displayName":"  Влад 🎮  "}`, test.wantJoinStatus)
			if test.configureMedia {
				assertIssuedCredentials(t, cfg, joined, createdRoom.RoomID)
			} else if !strings.Contains(joined.Body.String(), `"code":"media_unavailable"`) {
				t.Error("unconfigured media should return media_unavailable")
			}

			application.Close()
			requestStatus(t, ctx, handler, http.MethodGet, "/readyz", "", http.StatusServiceUnavailable)
			requestStatus(t, ctx, handler, http.MethodGet, "/healthz", "", http.StatusOK)
		})
	}
}

func requestStatus(
	t *testing.T, ctx context.Context, handler http.Handler, method, path, body string, wantStatus int,
) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != wantStatus {
		t.Fatalf("%s response status = %d, want %d", method, response.Code, wantStatus)
	}

	return response
}

func assertIssuedCredentials(t *testing.T, cfg *config.Config, response *httptest.ResponseRecorder, roomID string) {
	t.Helper()

	var credentials struct {
		ServerURL           string `json:"serverUrl"`
		ParticipantToken    string `json:"participantToken"`
		ParticipantIdentity string `json:"participantIdentity"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &credentials); err != nil {
		t.Fatal("decode join response")
	}

	if credentials.ServerURL != cfg.LiveKitURL || credentials.ParticipantIdentity == "" {
		t.Fatal("incomplete join credentials")
	}

	verifier, err := auth.ParseAPIToken(credentials.ParticipantToken)
	if err != nil {
		t.Fatal("parse issued participant token")
	}

	claims, grants, err := verifier.Verify(cfg.LiveKitAPISecret)
	if err != nil {
		t.Fatal("verify issued participant token")
	}

	if claims.Subject != credentials.ParticipantIdentity || grants.Video.Room != roomID || grants.Name != "Влад 🎮" {
		t.Error("issued token is not bound to the requested room and participant")
	}

	if claims.ExpiresAt.Sub(claims.IssuedAt.Time) != room.ParticipantTokenTTL {
		t.Error("issued participant token has the wrong TTL")
	}
}
