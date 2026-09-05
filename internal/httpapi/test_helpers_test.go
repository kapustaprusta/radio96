package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/kapustaprusta/radio96/internal/room"
)

const (
	testInviteCode = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
	testRoomID     = "opaque-application-room-id"
	testExpiresAt  = "2026-09-05T13:00:00Z"
	testSecret     = "private-user:secret@localhost/internal-room"
)

type createRoomFunc func(context.Context) (*room.Room, error)

func (execute createRoomFunc) Execute(ctx context.Context) (*room.Room, error) {
	return execute(ctx)
}

type getRoomFunc func(context.Context, string) (*room.Room, error)

func (execute getRoomFunc) Execute(ctx context.Context, inviteCode string) (*room.Room, error) {
	return execute(ctx, inviteCode)
}

type joinRoomFunc func(context.Context, string, string) (*room.JoinRoomResult, error)

func (execute joinRoomFunc) Execute(ctx context.Context, inviteCode, displayName string) (*room.JoinRoomResult, error) {
	return execute(ctx, inviteCode, displayName)
}

func newTestRoom(t *testing.T, status room.Status) *room.Room {
	t.Helper()

	inviteCode, err := room.ParseInviteCode(testInviteCode)
	if err != nil {
		t.Fatalf("parse test invite: %v", err)
	}

	createdAt := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	params := room.RestoreRoomParams{
		ID:         testRoomID,
		InviteCode: inviteCode,
		Name:       "private-media-room-name",
		Status:     status,
		CreatedAt:  createdAt,
		ExpiresAt:  createdAt.Add(room.OpenRoomLifetime),
	}

	switch status {
	case room.StatusOpen, room.StatusExpired:
	case room.StatusActive, room.StatusFinished:
		startedAt := createdAt.Add(time.Minute)
		params.StartedAt = &startedAt

		if status == room.StatusFinished {
			finishedAt := createdAt.Add(2 * time.Minute)
			params.FinishedAt = &finishedAt
		}
	}

	result, err := room.Restore(params)
	if err != nil {
		t.Fatalf("restore test room: %v", err)
	}

	return result
}

func testJoinResult() *room.JoinRoomResult {
	return &room.JoinRoomResult{
		ServerURL:           "wss://radio96.example.livekit.cloud",
		ParticipantToken:    "test-participant-token",
		ParticipantIdentity: "test-participant-identity",
	}
}

func assertErrorResponse(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()

	value := readResponse(t, response, status, "Error")
	if value["code"] != code {
		t.Errorf("error code = %v, want %q", value["code"], code)
	}

	message, ok := value["message"].(string)
	if !ok || message == "" || len(value) != 2 {
		t.Error("error must contain only code and a nonempty message")
	}

	for _, secret := range []string{testInviteCode, testSecret, "postgres://", "private-media-room-name"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Error("error response contains private request or dependency data")
		}
	}
}

func assertResponse(t *testing.T, response *httptest.ResponseRecorder, status int, schema string, want map[string]any) {
	t.Helper()

	got := readResponse(t, response, status, schema)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("response = %#v, want %#v", got, want)
	}
}

func readResponse(t *testing.T, response *httptest.ResponseRecorder, status int, schema string) map[string]any {
	t.Helper()

	if response.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", response.Code, status, response.Body.String())
	}

	for header, want := range map[string]string{
		"Content-Type":                "application/json",
		"Cache-Control":               "no-store",
		"Referrer-Policy":             "no-referrer",
		"Location":                    "",
		"Access-Control-Allow-Origin": "",
	} {
		if got := response.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}

	decoder := json.NewDecoder(strings.NewReader(response.Body.String()))
	var result map[string]any
	if err := decoder.Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		t.Fatalf("response must contain exactly one JSON value; trailing error = %v", err)
	}

	if schema != "" {
		loader := openapi3.NewLoader()
		document, err := loader.LoadFromFile("../../api/openapi.yaml")
		if err != nil {
			t.Fatalf("load API contract: %v", err)
		}

		schemaValue := document.Components.Schemas[schema].Value
		if err := schemaValue.VisitJSON(result, openapi3.EnableJSONSchema2020(), openapi3.EnableFormatValidation()); err != nil {
			t.Errorf("response does not match %s: %v", schema, err)
		}
	}

	return result
}
