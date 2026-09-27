package livekit

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"

	"github.com/kapustaprusta/radio96/internal/room"
)

func TestWebhookVerifier(t *testing.T) {
	const apiKey = "test-key"
	const apiSecret = "test-secret"
	validBody := []byte(`{"id":"event-id","event":"room_started","createdAt":1780000000,"room":{"name":"media-room"}}`)
	tests := []struct {
		name       string
		body       []byte
		signedBody []byte
		key        string
		secret     string
		wantErr    error
	}{
		{name: "valid", body: validBody, key: apiKey, secret: apiSecret},
		{name: "tampered body", body: []byte(`{"id":"other"}`), signedBody: validBody,
			key: apiKey, secret: apiSecret, wantErr: room.ErrInvalidWebhookSignature},
		{name: "unknown key", body: validBody, key: "other-key", secret: apiSecret,
			wantErr: room.ErrInvalidWebhookSignature},
		{name: "malformed signed payload", body: []byte(`not json`), key: apiKey, secret: apiSecret,
			wantErr: room.ErrInvalidWebhookPayload},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			signedBody := test.signedBody
			if signedBody == nil {
				signedBody = test.body
			}

			checksum := sha256.Sum256(signedBody)
			token, err := auth.NewAccessToken(test.key, test.secret).
				SetSha256(base64.StdEncoding.EncodeToString(checksum[:])).
				SetValidFor(time.Minute).ToJWT()
			if err != nil {
				t.Fatalf("sign webhook: %v", err)
			}

			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/livekit/webhook", bytes.NewReader(test.body))
			request.Header.Set("Authorization", token)
			event, err := NewWebhookVerifier(apiKey, apiSecret).Verify(request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Verify() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if event != nil {
					t.Errorf("event = %v, want nil", event)
				}

				return
			}

			if event == nil || event.ID != "event-id" || event.Type != "room_started" || event.RoomName != "media-room" ||
				event.At.Unix() != 1780000000 {
				t.Errorf("event = %+v, want parsed lifecycle event", event)
			}
		})
	}
}
