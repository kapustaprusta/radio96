package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/httpapi"
	"github.com/kapustaprusta/radio96/internal/livekit"
	"github.com/kapustaprusta/radio96/internal/postgres"
	"github.com/kapustaprusta/radio96/internal/reconcile"
	"github.com/kapustaprusta/radio96/internal/room"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	writeTimeout      = 15 * time.Second
	idleTimeout       = 60 * time.Second
)

type App struct {
	logger          *slog.Logger
	server          *http.Server
	shutdownTimeout time.Duration
	database        *pgxpool.Pool
	worker          *reconcile.Worker
}

func New(ctx context.Context, cfg *config.Config, logger *slog.Logger) (*App, error) {
	if cfg == nil {
		return nil, errors.New("application configuration is required")
	}

	if logger == nil {
		logger = slog.Default()
	}

	gateway, err := configuredMediaGateway(cfg)
	if err != nil {
		return nil, err
	}

	database, err := openDatabase(ctx, cfg)
	if err != nil {
		return nil, err
	}

	if cfg.LiveKitURL == "" {
		logger.Warn("LiveKit is not configured; room creation is available but voice joins are disabled")
	}

	repository := postgres.NewRoomRepository(database)
	admissions := postgres.NewAdmissionRepository(database)
	lifecycleStore := postgres.NewLifecycleRepository(database)
	clock := systemClock{}
	identities := randomIDGenerator{}
	getRoom := room.NewGetRoom(repository, clock)
	if cfg.LiveKitURL != "" {
		getRoom = room.NewGetRoomWithMedia(repository, gateway, clock)
	}

	dependencies := &httpapi.Dependencies{
		CreateRoom: room.NewCreateRoom(repository, clock, identities, randomInviteCodeGenerator{}),
		GetRoom:    getRoom,
		JoinRoom:   room.NewJoinRoom(repository, gateway, admissions, clock, identities),
		Ready: func(requestCtx context.Context) error {
			checkCtx, cancel := context.WithTimeout(requestCtx, cfg.DatabaseConnectTimeout)
			defer cancel()

			return database.Ping(checkCtx)
		},
	}
	var worker *reconcile.Worker
	if cfg.LiveKitURL != "" {
		dependencies.WebhookVerifier = livekit.NewWebhookVerifier(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
		dependencies.HandleLifecycleEvent = room.NewHandleLifecycleEvent(lifecycleStore, gateway)
		worker = reconcile.NewWorker(room.NewReconcileRooms(lifecycleStore, gateway, clock), logger)
	}

	handler := httpapi.NewHandler(dependencies)

	return &App{
		logger: logger,
		server: &http.Server{
			Addr:              cfg.HTTPAddress,
			Handler:           handler,
			ReadHeaderTimeout: readHeaderTimeout,
			ReadTimeout:       readTimeout,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       idleTimeout,
		},
		shutdownTimeout: cfg.ShutdownTimeout,
		database:        database,
		worker:          worker,
	}, nil
}

func (a *App) Close() {
	if a.database != nil {
		a.database.Close()
	}
}

func (a *App) Run(ctx context.Context) error {
	if ctx.Err() != nil {
		return nil
	}

	listenConfig := net.ListenConfig{}
	listener, err := listenConfig.Listen(ctx, "tcp", a.server.Addr)
	if err != nil {
		return fmt.Errorf("listen HTTP: %w", err)
	}

	defer func() {
		_ = a.server.Close()
	}()

	serverError := make(chan error, 1)
	workerCtx, cancelWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	if a.worker != nil {
		go func() {
			defer close(workerDone)
			a.worker.Run(workerCtx)
		}()
	} else {
		close(workerDone)
	}

	defer func() {
		cancelWorker()
		<-workerDone
	}()

	go func() {
		a.logger.Info("HTTP server started", slog.String("address", listener.Addr().String()))
		serverError <- a.server.Serve(listener)
	}()

	select {
	case err := <-serverError:
		return normalizeServerError(err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.shutdownTimeout)
	defer cancel()

	if err := a.server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown HTTP server: %w", err)
	}

	a.logger.Info("HTTP server stopped")

	return normalizeServerError(<-serverError)
}

func normalizeServerError(err error) error {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return nil
	}

	return fmt.Errorf("serve HTTP: %w", err)
}
