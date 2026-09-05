package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kapustaprusta/radio96/internal/room"
)

func TestCreateRoom(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		result     *room.Room
		err        error
		nilUseCase bool
		wantStatus int
		wantCode   string
		wantCalls  int
	}{
		{
			name: "created", result: newTestRoom(t, room.StatusOpen), wantStatus: http.StatusCreated, wantCalls: 1,
		},
		{
			name: "dependency failure", err: errors.New(testSecret),
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing result", wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing invite", result: new(room.Room),
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing use case", nilUseCase: true, wantStatus: http.StatusInternalServerError, wantCode: "internal_error",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/rooms", nil)
			response := httptest.NewRecorder()
			calls := 0
			deps := &Dependencies{}
			if !test.nilUseCase {
				deps.CreateRoom = createRoomFunc(func(ctx context.Context) (*room.Room, error) {
					calls++
					if ctx != request.Context() {
						t.Error("CreateRoom did not receive the request context")
					}

					return test.result, test.err
				})
			}

			NewHandler(deps).ServeHTTP(response, request)

			if test.wantCode != "" {
				assertErrorResponse(t, response, test.wantStatus, test.wantCode)
			} else {
				assertResponse(t, response, test.wantStatus, "CreateRoomResponse", map[string]any{
					"roomId":          testRoomID,
					"inviteUrl":       "/rooms/" + testInviteCode,
					"expiresAt":       testExpiresAt,
					"maxParticipants": float64(room.MaxParticipants),
				})
			}

			if calls != test.wantCalls {
				t.Errorf("Execute() calls = %d, want %d", calls, test.wantCalls)
			}
		})
	}
}

func TestGetRoom(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		inviteCode string
		result     *room.Room
		err        error
		nilUseCase bool
		wantStatus int
		wantCode   string
		wantCalls  int
	}{
		{
			name: "open", result: newTestRoom(t, room.StatusOpen), wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "active", result: newTestRoom(t, room.StatusActive), wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "finished", result: newTestRoom(t, room.StatusFinished), wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "expired", result: newTestRoom(t, room.StatusExpired), wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "not found", err: fmt.Errorf("%s: %w", testSecret, room.ErrRoomNotFound),
			wantStatus: http.StatusNotFound, wantCode: "room_not_found", wantCalls: 1,
		},
		{
			name: "invalid invite", inviteCode: "invalid-invite", err: fmt.Errorf("%s: %w", testSecret, room.ErrInvalidInviteCode),
			wantStatus: http.StatusNotFound, wantCode: "room_not_found", wantCalls: 1,
		},
		{
			name: "dependency failure", err: errors.New(testSecret),
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing result", wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing use case", nilUseCase: true, wantStatus: http.StatusInternalServerError, wantCode: "internal_error",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			inviteCode := test.inviteCode
			if inviteCode == "" {
				inviteCode = testInviteCode
			}

			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/rooms/"+inviteCode, nil)
			response := httptest.NewRecorder()
			calls := 0
			deps := &Dependencies{}
			if !test.nilUseCase {
				deps.GetRoom = getRoomFunc(func(ctx context.Context, code string) (*room.Room, error) {
					calls++
					if ctx != request.Context() || code != inviteCode {
						t.Error("GetRoom did not receive the request context and invite code")
					}

					return test.result, test.err
				})
			}

			NewHandler(deps).ServeHTTP(response, request)

			if test.wantCode != "" {
				assertErrorResponse(t, response, test.wantStatus, test.wantCode)
			} else {
				assertResponse(t, response, test.wantStatus, "RoomResponse", map[string]any{
					"status":    string(test.result.Status()),
					"expiresAt": testExpiresAt,
				})
			}

			if calls != test.wantCalls {
				t.Errorf("Execute() calls = %d, want %d", calls, test.wantCalls)
			}
		})
	}
}

func TestJoinRoomRequest(t *testing.T) {
	t.Parallel()

	validBody := `{"displayName":" Влад 🎮 "}`
	tests := []struct {
		name        string
		body        string
		contentType string
		wantName    string
		wantStatus  int
		wantCalls   int
	}{
		{
			name: "valid Unicode name", body: validBody, contentType: "application/json",
			wantName: " Влад 🎮 ", wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "content type with charset", body: validBody, contentType: "application/json; charset=utf-8",
			wantName: " Влад 🎮 ", wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "trailing whitespace", body: validBody + "\n \t", contentType: "application/json",
			wantName: " Влад 🎮 ", wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "body at limit", body: validBody + strings.Repeat(" ", maxJoinBodyBytes-len(validBody)),
			contentType: "application/json", wantName: " Влад 🎮 ", wantStatus: http.StatusOK, wantCalls: 1,
		},
		{
			name: "missing content type", body: validBody, wantStatus: http.StatusBadRequest,
		},
		{
			name: "wrong content type", body: validBody, contentType: "text/plain", wantStatus: http.StatusBadRequest,
		},
		{
			name: "malformed content type", body: validBody, contentType: "application/json; charset", wantStatus: http.StatusBadRequest,
		},
		{
			name: "empty body", contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "empty object", body: `{}`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "null body", body: `null`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "array body", body: `[]`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "string body", body: `"Vlad"`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "null name", body: `{"displayName":null}`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "numeric name", body: `{"displayName":1}`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "wrong field casing", body: `{"DisplayName":"Vlad"}`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "unknown field", body: `{"displayName":"Vlad","microphone":false}`,
			contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "malformed JSON", body: `{"displayName":`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "second object", body: validBody + `{}`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "trailing null", body: validBody + `null`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "trailing garbage", body: validBody + `garbage`, contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid UTF-8", body: "{\"displayName\":\"\xff\"}", contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
		{
			name: "oversized body", body: validBody + strings.Repeat(" ", maxJoinBodyBytes-len(validBody)+1),
			contentType: "application/json", wantStatus: http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(
				t.Context(), http.MethodPost, "/api/v1/rooms/"+testInviteCode+"/join", strings.NewReader(test.body),
			)
			request.Header.Set("Content-Type", test.contentType)
			response := httptest.NewRecorder()
			calls := 0
			deps := &Dependencies{
				JoinRoom: joinRoomFunc(func(ctx context.Context, code, name string) (*room.JoinRoomResult, error) {
					calls++
					if ctx != request.Context() || code != testInviteCode || name != test.wantName {
						t.Error("JoinRoom did not receive the request context, invite code and unmodified display name")
					}

					return testJoinResult(), nil
				}),
			}

			NewHandler(deps).ServeHTTP(response, request)

			if test.wantStatus == http.StatusOK {
				assertResponse(t, response, test.wantStatus, "JoinRoomResponse", map[string]any{
					"serverUrl":           "wss://radio96.example.livekit.cloud",
					"participantToken":    "test-participant-token",
					"participantIdentity": "test-participant-identity",
				})
			} else {
				assertErrorResponse(t, response, test.wantStatus, "invalid_request")
			}

			if calls != test.wantCalls {
				t.Errorf("Execute() calls = %d, want %d", calls, test.wantCalls)
			}
		})
	}
}

func TestJoinRoomErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		result     *room.JoinRoomResult
		nilUseCase bool
		wantStatus int
		wantCode   string
		wantCalls  int
	}{
		{
			name: "invalid invite", err: room.ErrInvalidInviteCode,
			wantStatus: http.StatusNotFound, wantCode: "room_not_found", wantCalls: 1,
		},
		{
			name: "invalid name", err: room.ErrInvalidDisplayName,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_name", wantCalls: 1,
		},
		{
			name: "not found", err: room.ErrRoomNotFound,
			wantStatus: http.StatusNotFound, wantCode: "room_not_found", wantCalls: 1,
		},
		{
			name: "full", err: room.ErrRoomFull, wantStatus: http.StatusConflict, wantCode: "room_full", wantCalls: 1,
		},
		{
			name: "expired", err: room.ErrRoomExpired, wantStatus: http.StatusGone, wantCode: "room_expired", wantCalls: 1,
		},
		{
			name: "finished", err: room.ErrRoomFinished, wantStatus: http.StatusGone, wantCode: "room_finished", wantCalls: 1,
		},
		{
			name: "media unavailable", err: room.ErrMediaUnavailable,
			wantStatus: http.StatusServiceUnavailable, wantCode: "media_unavailable", wantCalls: 1,
		},
		{
			name: "unknown", err: errors.New(testSecret),
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "canceled request", err: context.Canceled,
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing result", wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing server URL", result: &room.JoinRoomResult{ParticipantToken: "secret", ParticipantIdentity: "identity"},
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing token", result: &room.JoinRoomResult{ServerURL: "wss://example.com", ParticipantIdentity: "identity"},
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing identity", result: &room.JoinRoomResult{ServerURL: "wss://example.com", ParticipantToken: "secret"},
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1,
		},
		{
			name: "missing use case", nilUseCase: true, wantStatus: http.StatusInternalServerError, wantCode: "internal_error",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(
				t.Context(), http.MethodPost, "/api/v1/rooms/"+testInviteCode+"/join", strings.NewReader(`{"displayName":"Vlad"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			calls := 0
			deps := &Dependencies{}
			if !test.nilUseCase {
				deps.JoinRoom = joinRoomFunc(func(_ context.Context, _, _ string) (*room.JoinRoomResult, error) {
					calls++
					if test.err != nil {
						return nil, fmt.Errorf("%s: %w", testSecret, test.err)
					}

					return test.result, test.err
				})
			}

			NewHandler(deps).ServeHTTP(response, request)

			assertErrorResponse(t, response, test.wantStatus, test.wantCode)
			if calls != test.wantCalls {
				t.Errorf("Execute() calls = %d, want %d", calls, test.wantCalls)
			}
		})
	}
}
