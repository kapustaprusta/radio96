package livekit

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"

	"github.com/livekit/protocol/auth"
	livekitproto "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"github.com/kapustaprusta/radio96/internal/room"
)

type roomService interface {
	ListRooms(
		ctx context.Context,
		request *livekitproto.ListRoomsRequest,
	) (*livekitproto.ListRoomsResponse, error)
}

type Gateway struct {
	serverURL  string
	apiKey     string
	apiSecret  string
	roomClient roomService
}

func NewGateway(serverURL, apiKey, apiSecret string) (*Gateway, error) {
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return nil, fmt.Errorf("parse LiveKit server URL: %w", err)
	}

	if parsedURL.Host == "" || (parsedURL.Scheme != "ws" && parsedURL.Scheme != "wss") {
		return nil, errors.New("LiveKit server URL must use ws or wss and include a host")
	}

	if parsedURL.User != nil {
		return nil, errors.New("LiveKit server URL must not contain credentials")
	}

	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("LiveKit API key is required")
	}

	if strings.TrimSpace(apiSecret) == "" {
		return nil, errors.New("LiveKit API secret is required")
	}

	return &Gateway{
		serverURL:  serverURL,
		apiKey:     apiKey,
		apiSecret:  apiSecret,
		roomClient: lksdk.NewRoomServiceClient(serverURL, apiKey, apiSecret),
	}, nil
}

func (gateway *Gateway) RoomState(ctx context.Context, roomName string) (*room.MediaRoomState, error) {
	if strings.TrimSpace(roomName) == "" {
		return nil, errors.New("inspect LiveKit room: room name is required")
	}

	response, err := gateway.roomClient.ListRooms(ctx, &livekitproto.ListRoomsRequest{
		Names: []string{roomName},
	})
	if err != nil {
		return nil, fmt.Errorf("list LiveKit rooms: %w", err)
	}

	if response == nil {
		return nil, errors.New("list LiveKit rooms: empty response")
	}

	for _, mediaRoom := range response.Rooms {
		if mediaRoom != nil && mediaRoom.Name == roomName {
			return &room.MediaRoomState{
				Exists:           true,
				ParticipantCount: int(mediaRoom.NumParticipants),
			}, nil
		}
	}

	return &room.MediaRoomState{}, nil
}

func (gateway *Gateway) IssueParticipantToken(
	_ context.Context,
	request room.ParticipantTokenRequest,
) (*room.ParticipantToken, error) {
	if strings.TrimSpace(request.RoomName) == "" {
		return nil, errors.New("issue LiveKit participant token: room name is required")
	}

	if strings.TrimSpace(request.ParticipantIdentity) == "" {
		return nil, errors.New("issue LiveKit participant token: participant identity is required")
	}

	if strings.TrimSpace(request.DisplayName) == "" {
		return nil, errors.New("issue LiveKit participant token: display name is required")
	}

	if request.TTL <= 0 {
		return nil, errors.New("issue LiveKit participant token: TTL must be positive")
	}

	if request.MaxParticipants <= 0 {
		return nil, errors.New("issue LiveKit participant token: maximum participants must be positive")
	}

	if uint64(request.MaxParticipants) > uint64(math.MaxUint32) {
		return nil, errors.New("issue LiveKit participant token: maximum participants must fit uint32")
	}

	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     request.RoomName,
	}
	grant.SetCanPublish(true)
	grant.SetCanPublishData(false)
	grant.SetCanSubscribe(true)
	grant.SetCanPublishSources([]livekitproto.TrackSource{livekitproto.TrackSource_MICROPHONE})
	grant.SetCanUpdateOwnMetadata(false)

	token, err := auth.NewAccessToken(gateway.apiKey, gateway.apiSecret).
		SetVideoGrant(grant).
		SetIdentity(request.ParticipantIdentity).
		SetName(request.DisplayName).
		SetValidFor(request.TTL).
		SetRoomConfig(&livekitproto.RoomConfiguration{
			MaxParticipants: uint32(request.MaxParticipants),
		}).
		ToJWT()
	if err != nil {
		return nil, fmt.Errorf("sign LiveKit participant token: %w", err)
	}

	return &room.ParticipantToken{
		ServerURL: gateway.serverURL,
		Value:     token,
	}, nil
}

var _ room.MediaGateway = (*Gateway)(nil)
