package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kapustaprusta/radio96/internal/room"
)

type webhookVerifierFunc func(*http.Request) (*room.LifecycleEvent, error)

func (verify webhookVerifierFunc) Verify(request *http.Request) (*room.LifecycleEvent, error) {
	return verify(request)
}

type lifecycleEventFunc func(context.Context, room.LifecycleEvent) error

func (execute lifecycleEventFunc) Execute(ctx context.Context, event room.LifecycleEvent) error {
	return execute(ctx, event)
}

func TestLiveKitWebhook(t *testing.T) {
	valid := &room.LifecycleEvent{ID: "event-id", RoomName: "media-room", Type: "room_started", At: time.Now()}
	tests := []struct {
		name       string
		mediaType  string
		verifyErr  error
		processErr error
		wantStatus int
		wantCode   string
		wantCalls  int
	}{
		{name: "accepted", mediaType: "application/webhook+json", wantStatus: http.StatusNoContent, wantCalls: 1},
		{name: "missing content type", wantStatus: http.StatusBadRequest, wantCode: "invalid_request"},
		{name: "bad signature", mediaType: "application/webhook+json", verifyErr: room.ErrInvalidWebhookSignature,
			wantStatus: http.StatusUnauthorized, wantCode: "invalid_webhook_signature"},
		{name: "bad payload", mediaType: "application/webhook+json", verifyErr: room.ErrInvalidWebhookPayload,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request"},
		{name: "invalid event", mediaType: "application/webhook+json", processErr: room.ErrInvalidRoom,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request", wantCalls: 1},
		{name: "storage failure", mediaType: "application/webhook+json", processErr: errors.New("database unavailable"),
			wantStatus: http.StatusInternalServerError, wantCode: "internal_error", wantCalls: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			handler := NewHandler(&Dependencies{
				WebhookVerifier: webhookVerifierFunc(func(*http.Request) (*room.LifecycleEvent, error) {
					return valid, test.verifyErr
				}),
				HandleLifecycleEvent: lifecycleEventFunc(func(_ context.Context, event room.LifecycleEvent) error {
					calls++
					if event.ID != valid.ID {
						t.Errorf("event ID = %q, want %q", event.ID, valid.ID)
					}

					return test.processErr
				}),
			})
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/livekit/webhook", strings.NewReader("{}"))
			if test.mediaType != "" {
				request.Header.Set("Content-Type", test.mediaType)
			}

			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Errorf("status = %d, want %d", response.Code, test.wantStatus)
			}

			if test.wantCode != "" {
				assertErrorResponse(t, response, test.wantStatus, test.wantCode)
			} else if response.Body.Len() != 0 {
				t.Errorf("204 body = %q, want empty", response.Body.String())
			}

			if calls != test.wantCalls {
				t.Errorf("process calls = %d, want %d", calls, test.wantCalls)
			}
		})
	}
}
