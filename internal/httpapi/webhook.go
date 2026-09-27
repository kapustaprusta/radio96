package httpapi

import (
	"errors"
	"mime"
	"net/http"

	"github.com/kapustaprusta/radio96/internal/room"
)

const maxWebhookBodyBytes = 64 << 10

func (api *handler) livekitWebhook(response http.ResponseWriter, request *http.Request) {
	if api.dependencies.WebhookVerifier == nil || api.dependencies.HandleLifecycleEvent == nil {
		writeAPIError(response, http.StatusServiceUnavailable, "media_unavailable", "Media is unavailable.")
		return
	}

	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/webhook+json" {
		writeInvalidRequest(response)
		return
	}

	request.Body = http.MaxBytesReader(response, request.Body, maxWebhookBodyBytes)
	event, err := api.dependencies.WebhookVerifier.Verify(request)
	if errors.Is(err, room.ErrInvalidWebhookSignature) {
		writeAPIError(response, http.StatusUnauthorized, "invalid_webhook_signature", "Webhook signature is invalid.")
		return
	}

	if err != nil || event == nil {
		writeInvalidRequest(response)
		return
	}

	if err := api.dependencies.HandleLifecycleEvent.Execute(request.Context(), *event); err != nil {
		if errors.Is(err, room.ErrInvalidRoom) {
			writeInvalidRequest(response)
		} else {
			writeInternalError(response)
		}

		return
	}

	response.WriteHeader(http.StatusNoContent)
}
