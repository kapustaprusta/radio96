package app

import (
	"context"
	"io"
	"log/slog"
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
			name: "stops when context is cancelled",
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
			var ctx context.Context = context.Background()
			if testCase.cancelContext {
				cancelledCtx, cancel := context.WithCancel(ctx)
				cancel()
				ctx = cancelledCtx
			}

			err := New(testCase.config, discardLogger()).Run(ctx)
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

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
