package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/kapustaprusta/radio96/internal/config"
)

func TestRun(t *testing.T) {
	testCases := []struct {
		name          string
		config        *config.Config
		cancelContext bool
		wantErr       string
	}{
		{
			name: "does not start with a cancelled context",
			config: &config.Config{
				HTTPAddress:     "127.0.0.1:0",
				ShutdownTimeout: time.Second,
			},
			cancelContext: true,
		},
		{
			name: "returns listen error",
			config: &config.Config{
				HTTPAddress:     "invalid address",
				ShutdownTimeout: time.Second,
			},
			wantErr: "listen HTTP",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			if testCase.cancelContext {
				cancelledCtx, cancel := context.WithCancel(ctx)
				cancel()
				ctx = cancelledCtx
			}

			application := &App{
				logger:          discardLogger(),
				server:          &http.Server{Addr: testCase.config.HTTPAddress, ReadHeaderTimeout: readHeaderTimeout},
				shutdownTimeout: testCase.config.ShutdownTimeout,
			}
			err := application.Run(ctx)
			if testCase.wantErr == "" {
				if err != nil {
					t.Fatalf("Run() error = %v", err)
				}

				return
			}

			if err == nil {
				t.Fatalf("Run() error = nil, want it to contain %q", testCase.wantErr)
			}

			if !strings.Contains(err.Error(), testCase.wantErr) {
				t.Errorf("Run() error = %q, want it to contain %q", err, testCase.wantErr)
			}
		})
	}
}

func TestRunShutdown(t *testing.T) {
	tests := []struct {
		name            string
		shutdownTimeout time.Duration
		closeListener   bool
		finishRequest   bool
		wantRunErr      error
	}{
		{
			name: "cancellation waits for an active request", shutdownTimeout: 2 * time.Second, finishRequest: true,
		},
		{
			name: "shutdown deadline cancels an active request", shutdownTimeout: 50 * time.Millisecond,
			wantRunErr: context.DeadlineExceeded,
		},
		{
			name: "listener failure cancels an active request", shutdownTimeout: 2 * time.Second,
			closeListener: true, wantRunErr: net.ErrClosed,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()

			runCtx, cancelRun := context.WithCancel(ctx)
			defer cancelRun()

			listening := make(chan net.Listener, 1)
			requestStarted := make(chan struct{})
			finishRequest := make(chan struct{})
			handlerResult := make(chan error, 1)
			shutdownStarted := make(chan struct{})
			application := &App{
				logger:          discardLogger(),
				shutdownTimeout: test.shutdownTimeout,
				server: &http.Server{
					Addr:              "127.0.0.1:0",
					ReadHeaderTimeout: readHeaderTimeout,
					BaseContext: func(listener net.Listener) context.Context {
						listening <- listener
						return ctx
					},
					Handler: http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
						close(requestStarted)

						select {
						case <-finishRequest:
							response.WriteHeader(http.StatusNoContent)
						case <-request.Context().Done():
						}

						handlerResult <- request.Context().Err()
					}),
				},
			}
			application.server.RegisterOnShutdown(func() { close(shutdownStarted) })
			t.Cleanup(func() { _ = application.server.Close() })

			runResult := make(chan error, 1)
			go func() { runResult <- application.Run(runCtx) }()

			var listener net.Listener
			select {
			case listener = <-listening:
			case err := <-runResult:
				t.Fatalf("Run() stopped before serving: %v", err)
			case <-ctx.Done():
				t.Fatal("HTTP server did not start before the test deadline")
			}

			request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+listener.Addr().String()+"/", nil)
			if err != nil {
				t.Fatalf("create request: %v", err)
			}

			client := &http.Client{Timeout: 3 * time.Second}
			t.Cleanup(client.CloseIdleConnections)
			clientResult := make(chan error, 1)
			go func() {
				response, err := client.Do(request)
				if err != nil {
					clientResult <- err
					return
				}

				closeErr := response.Body.Close()
				if response.StatusCode != http.StatusNoContent {
					clientResult <- fmt.Errorf("response status = %d, want %d", response.StatusCode, http.StatusNoContent)
					return
				}

				clientResult <- closeErr
			}()

			select {
			case <-requestStarted:
			case <-ctx.Done():
				t.Fatal("request did not reach the handler before the test deadline")
			}

			if test.closeListener {
				if err := listener.Close(); err != nil {
					t.Fatalf("close listener: %v", err)
				}
			} else {
				cancelRun()

				select {
				case <-shutdownStarted:
				case <-ctx.Done():
					t.Fatal("HTTP shutdown did not start before the test deadline")
				}
			}

			if test.finishRequest {
				select {
				case err := <-runResult:
					t.Fatalf("Run() did not wait for the active request: %v", err)
				default:
				}

				close(finishRequest)
			}

			select {
			case err := <-runResult:
				if !errors.Is(err, test.wantRunErr) {
					t.Errorf("Run() error = %v, want %v", err, test.wantRunErr)
				}
			case <-ctx.Done():
				t.Fatal("Run() did not stop before the test deadline")
			}

			cleanupCtx, cancelCleanup := context.WithTimeout(ctx, time.Second)
			defer cancelCleanup()

			select {
			case err := <-handlerResult:
				var wantErr error
				if !test.finishRequest {
					wantErr = context.Canceled
				}

				if !errors.Is(err, wantErr) {
					t.Errorf("handler context error = %v, want %v", err, wantErr)
				}
			case <-cleanupCtx.Done():
				t.Fatal("active handler was not stopped when Run() returned")
			}

			select {
			case err := <-clientResult:
				if test.finishRequest && err != nil {
					t.Errorf("graceful shutdown interrupted the response: %v", err)
				}

				if !test.finishRequest && err == nil {
					t.Error("forced close did not interrupt the response")
				}
			case <-cleanupCtx.Done():
				t.Fatal("HTTP client remained connected after Run() stopped")
			}
		})
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}
