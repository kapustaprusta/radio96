package livekit

import (
	"errors"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
	livekitproto "github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/kapustaprusta/radio96/internal/room"
)

type WebhookVerifier struct {
	provider auth.KeyProvider
}

func NewWebhookVerifier(apiKey, apiSecret string) *WebhookVerifier {
	return &WebhookVerifier{provider: auth.NewSimpleKeyProvider(apiKey, apiSecret)}
}

func (verifier *WebhookVerifier) Verify(request *http.Request) (*room.LifecycleEvent, error) {
	data, err := webhook.Receive(request, verifier.provider)
	if err != nil {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			return nil, room.ErrInvalidWebhookPayload
		}

		return nil, room.ErrInvalidWebhookSignature
	}

	var event livekitproto.WebhookEvent
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true, AllowPartial: true}).Unmarshal(data, &event); err != nil {
		return nil, room.ErrInvalidWebhookPayload
	}

	if event.Id == "" || event.Event == "" || event.CreatedAt <= 0 {
		return nil, room.ErrInvalidWebhookPayload
	}

	return &room.LifecycleEvent{
		ID: event.Id, Type: event.Event, At: time.Unix(event.CreatedAt, 0).UTC(),
		RoomName: event.Room.GetName(), ParticipantIdentity: event.Participant.GetIdentity(),
	}, nil
}
