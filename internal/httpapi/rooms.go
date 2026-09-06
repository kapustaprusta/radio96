package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/kapustaprusta/radio96/internal/room"
)

const maxJoinBodyBytes = 4 << 10

type createRoomResponse struct {
	RoomID          string    `json:"roomId"`
	InviteURL       string    `json:"inviteUrl"`
	ExpiresAt       time.Time `json:"expiresAt"`
	MaxParticipants int       `json:"maxParticipants"`
}

type roomResponse struct {
	Status    room.Status `json:"status"`
	ExpiresAt time.Time   `json:"expiresAt"`
}

type joinRoomResponse struct {
	ServerURL           string `json:"serverUrl"`
	ParticipantToken    string `json:"participantToken"`
	ParticipantIdentity string `json:"participantIdentity"`
}

func (api *handler) createRoom(response http.ResponseWriter, request *http.Request) {
	if api.dependencies.CreateRoom == nil {
		writeInternalError(response)
		return
	}

	createdRoom, err := api.dependencies.CreateRoom.Execute(request.Context())
	if err != nil {
		writeRoomError(response, err)
		return
	}

	if createdRoom == nil || createdRoom.InviteCode() == nil {
		writeInternalError(response)
		return
	}

	writeJSON(response, http.StatusCreated, createRoomResponse{
		RoomID:          createdRoom.ID(),
		InviteURL:       "/rooms/" + createdRoom.InviteCode().Value(),
		ExpiresAt:       createdRoom.ExpiresAt(),
		MaxParticipants: room.MaxParticipants,
	})
}

func (api *handler) getRoom(response http.ResponseWriter, request *http.Request) {
	if api.dependencies.GetRoom == nil {
		writeInternalError(response)
		return
	}

	foundRoom, err := api.dependencies.GetRoom.Execute(request.Context(), request.PathValue("inviteCode"))
	if err != nil {
		writeRoomError(response, err)
		return
	}

	if foundRoom == nil {
		writeInternalError(response)
		return
	}

	writeJSON(response, http.StatusOK, roomResponse{Status: foundRoom.Status(), ExpiresAt: foundRoom.ExpiresAt()})
}

func (api *handler) joinRoom(response http.ResponseWriter, request *http.Request) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeInvalidRequest(response)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maxJoinBodyBytes))
	if err != nil || !utf8.Valid(body) {
		writeInvalidRequest(response)
		return
	}

	decoder := json.NewDecoder(bytes.NewReader(body))

	// A map enforces exact field names; struct decoding also accepts other casing.
	var input map[string]*string
	if err := decoder.Decode(&input); err != nil || len(input) != 1 || input["displayName"] == nil {
		writeInvalidRequest(response)
		return
	}

	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeInvalidRequest(response)
		return
	}

	if api.dependencies.JoinRoom == nil {
		writeInternalError(response)
		return
	}

	result, err := api.dependencies.JoinRoom.Execute(request.Context(), request.PathValue("inviteCode"), *input["displayName"])
	if err != nil {
		writeRoomError(response, err)
		return
	}

	if result == nil || result.ServerURL == "" || result.ParticipantToken == "" || result.ParticipantIdentity == "" {
		writeInternalError(response)
		return
	}

	writeJSON(response, http.StatusOK, joinRoomResponse{
		ServerURL:           result.ServerURL,
		ParticipantToken:    result.ParticipantToken,
		ParticipantIdentity: result.ParticipantIdentity,
	})
}
