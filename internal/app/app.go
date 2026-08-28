package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/kapustaprusta/radio96/internal/config"
	"github.com/kapustaprusta/radio96/internal/httpapi"
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
}

func New(cfg *config.Config, logger *slog.Logger) *App {
	return &App{
		logger: logger,
		server: &http.Server{
			Addr:              cfg.HTTPAddress,
			Handler:           httpapi.NewHandler(),
			ReadHeaderTimeout: readHeaderTimeout,
			ReadTimeout:       readTimeout,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       idleTimeout,
		},
		shutdownTimeout: cfg.ShutdownTimeout,
	}
}

func (a *App) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", a.server.Addr)
	if err != nil {
		return fmt.Errorf("listen HTTP: %w", err)
	}

	serverError := make(chan error, 1)

	go func() {
		a.logger.Info("HTTP server started", slog.String("address", listener.Addr().String()))
		serverError <- a.server.Serve(listener)
	}()

	select {
	case err := <-serverError:
		return normalizeServerError(err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.shutdownTimeout)
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
