package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	livekitproto "github.com/livekit/protocol/livekit"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"google.golang.org/protobuf/proto"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/room"
)

func TestApplicationRoomFlow(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	t.Cleanup(cancel)
	options := []testcontainers.ContainerCustomizer{
		tcpostgres.WithDatabase("radio96"),
		tcpostgres.WithUsername("radio96"),
		tcpostgres.WithPassword("radio96"),
		tcpostgres.WithInitScripts(
			filepath.Join("..", "..", "db", "migrations", "000001_create_rooms.up.sql"),
			filepath.Join("..", "..", "db", "migrations", "000002_room_lifecycle.up.sql"),
		),
		tcpostgres.BasicWaitStrategies(),
	}
	if os.Getenv("RADIO96_TEST_PODMAN") == "1" {
		options = append(options, testcontainers.WithProvider(testcontainers.ProviderPodman))
	}

	container, err := tcpostgres.Run(ctx, "postgres:17-alpine", options...)
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
				mediaServer := newTestLiveKitServer(t)
				defer mediaServer.Close()
				cfg.LiveKitURL = "ws" + strings.TrimPrefix(mediaServer.URL, "http")
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
				identities := []string{assertIssuedCredentials(t, cfg, joined, createdRoom.RoomID)}
				type joinOutcome struct {
					status   int
					identity string
				}
				statuses := make(chan joinOutcome, room.MaxParticipants)
				for range room.MaxParticipants {
					go func() {
						request := httptest.NewRequestWithContext(ctx, http.MethodPost, roomPath+"/join",
							strings.NewReader(`{"displayName":"Друг"}`))
						request.Header.Set("Content-Type", "application/json")
						response := httptest.NewRecorder()
						handler.ServeHTTP(response, request)
						var credentials struct {
							ParticipantIdentity string `json:"participantIdentity"`
						}
						_ = json.Unmarshal(response.Body.Bytes(), &credentials)
						statuses <- joinOutcome{status: response.Code, identity: credentials.ParticipantIdentity}
					}()
				}

				accepted, rejected := 0, 0
				for range room.MaxParticipants {
					outcome := <-statuses
					switch outcome.status {
					case http.StatusOK:
						accepted++
						identities = append(identities, outcome.identity)
					case http.StatusConflict:
						rejected++
					}
				}

				if accepted != room.MaxParticipants-1 || rejected != 1 {
					t.Errorf("concurrent API joins = %d accepted, %d rejected; want 7 and 1", accepted, rejected)
				}

				deliverTestWebhook(t, ctx, handler, cfg, "started-event", "room_started", createdRoom.RoomID)
				deliverTestWebhook(t, ctx, handler, cfg, "started-event", "room_started", createdRoom.RoomID)
				found = requestStatus(t, ctx, handler, http.MethodGet, roomPath, "", http.StatusOK)
				if !strings.Contains(found.Body.String(), `"status":"active"`) {
					t.Error("started room did not become active")
				}

				for index, identity := range identities {
					deliverTestWebhook(t, ctx, handler, cfg, fmt.Sprintf("left-%d", index), "participant_left",
						createdRoom.RoomID, identity)
				}

				found = requestStatus(t, ctx, handler, http.MethodGet, roomPath, "", http.StatusOK)
				if !strings.Contains(found.Body.String(), `"status":"active"`) {
					t.Error("room should remain active after the last departure")
				}

				deliverTestWebhook(t, ctx, handler, cfg, "finished-event", "room_finished", createdRoom.RoomID)
				requestStatus(t, ctx, handler, http.MethodPost, roomPath+"/join", `{"displayName":"Вернулся"}`, http.StatusOK)
				if _, err := application.database.Exec(ctx, `UPDATE rooms
					SET created_at = now() - interval '12 minutes',
					    started_at = now() - interval '11 minutes',
					    last_empty_at = now() - interval '10 minutes 1 second'
					WHERE id = $1`, createdRoom.RoomID); err != nil {
					t.Fatalf("age empty room: %v", err)
				}

				found = requestStatus(t, ctx, handler, http.MethodGet, roomPath, "", http.StatusOK)
				if !strings.Contains(found.Body.String(), `"status":"finished"`) {
					t.Error("room did not finish after ten idle minutes")
				}

				requestStatus(t, ctx, handler, http.MethodPost, roomPath+"/join", `{"displayName":"Влад"}`, http.StatusGone)
			} else if !strings.Contains(joined.Body.String(), `"code":"media_unavailable"`) {
				t.Error("unconfigured media should return media_unavailable")
			}

			application.Close()
			requestStatus(t, ctx, handler, http.MethodGet, "/readyz", "", http.StatusServiceUnavailable)
			requestStatus(t, ctx, handler, http.MethodGet, "/healthz", "", http.StatusOK)
		})
	}
}

func newTestLiveKitServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var result proto.Message
		switch request.URL.Path {
		case "/twirp/livekit.RoomService/ListRooms":
			result = &livekitproto.ListRoomsResponse{}
		case "/twirp/livekit.RoomService/ListParticipants":
			result = &livekitproto.ListParticipantsResponse{}
		case "/twirp/livekit.RoomService/CreateRoom":
			payload, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("read CreateRoom request: %v", err)
				response.WriteHeader(http.StatusBadRequest)
				return
			}

			var create livekitproto.CreateRoomRequest
			if err := proto.Unmarshal(payload, &create); err != nil || create.MaxParticipants != room.MaxParticipants ||
				create.DepartureTimeout != 1 {
				t.Errorf("CreateRoom max participants = %d, departure timeout = %d, error = %v",
					create.MaxParticipants, create.DepartureTimeout, err)
				response.WriteHeader(http.StatusBadRequest)
				return
			}

			result = &livekitproto.Room{Name: create.Name, MaxParticipants: create.MaxParticipants}
		default:
			response.WriteHeader(http.StatusNotFound)
			return
		}

		payload, err := proto.Marshal(result)
		if err != nil {
			t.Errorf("encode LiveKit response: %v", err)
			response.WriteHeader(http.StatusInternalServerError)
			return
		}

		response.Header().Set("Content-Type", "application/protobuf")
		_, _ = response.Write(payload)
	}))
}

func deliverTestWebhook(t *testing.T, ctx context.Context, handler http.Handler, cfg *config.Config,
	id, eventType, roomName string, participantIdentity ...string,
) {
	t.Helper()
	payload := map[string]any{
		"id": id, "event": eventType, "createdAt": time.Now().Unix(), "room": map[string]string{"name": roomName},
	}
	if len(participantIdentity) > 0 {
		payload["participant"] = map[string]string{"identity": participantIdentity[0]}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode webhook: %v", err)
	}

	checksum := sha256.Sum256(body)
	token, err := auth.NewAccessToken(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret).
		SetSha256(base64.StdEncoding.EncodeToString(checksum[:])).SetValidFor(time.Minute).ToJWT()
	if err != nil {
		t.Fatalf("sign webhook: %v", err)
	}

	request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/livekit/webhook", bytes.NewReader(body))
	request.Header.Set("Authorization", token)
	request.Header.Set("Content-Type", "application/webhook+json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("webhook status = %d, want 204: %s", response.Code, response.Body.String())
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

func assertIssuedCredentials(t *testing.T, cfg *config.Config, response *httptest.ResponseRecorder, roomID string) string {
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

	return credentials.ParticipantIdentity
}
