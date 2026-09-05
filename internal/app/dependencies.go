package app

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/livekit"
	"github.com/kapustaprusta/radio96/internal/room"
)

func openDatabase(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}

	if cfg.DatabaseConnectTimeout <= 0 {
		return nil, errors.New("DATABASE_CONNECT_TIMEOUT must be positive")
	}

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, errors.New("parse DATABASE_URL: invalid PostgreSQL connection string")
	}

	poolConfig.ConnConfig.ConnectTimeout = cfg.DatabaseConnectTimeout
	database, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, errors.New("initialize PostgreSQL connection pool")
	}

	connectCtx, cancel := context.WithTimeout(ctx, cfg.DatabaseConnectTimeout)
	defer cancel()

	if err := database.Ping(connectCtx); err != nil {
		database.Close()

		if connectCtx.Err() != nil {
			return nil, fmt.Errorf("connect PostgreSQL: %w", connectCtx.Err())
		}

		return nil, errors.New("connect PostgreSQL: connection failed")
	}

	return database, nil
}

func configuredMediaGateway(cfg *config.Config) (*boundedMediaGateway, error) {
	if cfg.MediaRequestTimeout <= 0 {
		return nil, errors.New("MEDIA_REQUEST_TIMEOUT must be positive")
	}

	gateway := &boundedMediaGateway{timeout: cfg.MediaRequestTimeout}
	if cfg.LiveKitURL == "" && cfg.LiveKitAPIKey == "" && cfg.LiveKitAPISecret == "" {
		return gateway, nil
	}

	provider, err := livekit.NewGateway(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	if err != nil {
		return nil, errors.New("configure LiveKit: invalid URL or credentials")
	}

	gateway.provider = provider

	return gateway, nil
}

type boundedMediaGateway struct {
	provider room.MediaGateway
	timeout  time.Duration
}

func (gateway *boundedMediaGateway) RoomState(ctx context.Context, roomName string) (*room.MediaRoomState, error) {
	if gateway.provider == nil {
		return nil, room.ErrMediaUnavailable
	}

	requestCtx, cancel := context.WithTimeout(ctx, gateway.timeout)
	defer cancel()

	return gateway.provider.RoomState(requestCtx, roomName)
}

func (gateway *boundedMediaGateway) IssueParticipantToken(
	ctx context.Context,
	request room.ParticipantTokenRequest,
) (*room.ParticipantToken, error) {
	if gateway.provider == nil {
		return nil, room.ErrMediaUnavailable
	}

	requestCtx, cancel := context.WithTimeout(ctx, gateway.timeout)
	defer cancel()

	if err := requestCtx.Err(); err != nil {
		return nil, err
	}

	return gateway.provider.IssueParticipantToken(requestCtx, request)
}

type systemClock struct{}

func (systemClock) Now() time.Time {
	return time.Now()
}

type randomIDGenerator struct{}

func (randomIDGenerator) Generate() (string, error) {
	return rand.Text(), nil
}

type randomInviteCodeGenerator struct{}

func (randomInviteCodeGenerator) Generate() (*room.InviteCode, error) {
	return room.GenerateInviteCode(rand.Reader)
}
