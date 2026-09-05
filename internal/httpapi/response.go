package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kapustaprusta/radio96/internal/room"
)

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeRoomError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, room.ErrInvalidInviteCode), errors.Is(err, room.ErrRoomNotFound):
		writeAPIError(response, http.StatusNotFound, "room_not_found", "Room was not found.")
	case errors.Is(err, room.ErrInvalidDisplayName):
		writeAPIError(response, http.StatusBadRequest, "invalid_name", "Display name must contain 1 to 32 Unicode characters.")
	case errors.Is(err, room.ErrRoomFull):
		writeAPIError(response, http.StatusConflict, "room_full", "Room is full.")
	case errors.Is(err, room.ErrRoomExpired):
		writeAPIError(response, http.StatusGone, "room_expired", "Room invite has expired.")
	case errors.Is(err, room.ErrRoomFinished):
		writeAPIError(response, http.StatusGone, "room_finished", "Room call has finished.")
	case errors.Is(err, room.ErrMediaUnavailable):
		writeAPIError(response, http.StatusServiceUnavailable, "media_unavailable", "Audio service is temporarily unavailable.")
	default:
		writeInternalError(response)
	}
}

func writeInternalError(response http.ResponseWriter) {
	writeAPIError(response, http.StatusInternalServerError, "internal_error", "An unexpected error occurred.")
}

func writeInvalidRequest(response http.ResponseWriter) {
	writeAPIError(response, http.StatusBadRequest, "invalid_request", "Request must contain a JSON object with displayName.")
}

func writeAPIError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, errorResponse{Code: code, Message: message})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)

	_ = json.NewEncoder(response).Encode(value)
}
