package config

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	const databaseURL = "postgres://radio96@localhost/radio96"

	secret := strings.Repeat("x", 32)
	credentialURL := &url.URL{Scheme: "wss", Host: "livekit.test", User: url.UserPassword("user", secret)}
	defaults := Config{
		HTTPAddress:            defaultHTTPAddress,
		ShutdownTimeout:        defaultShutdownTimeout,
		DatabaseURL:            databaseURL,
		DatabaseConnectTimeout: defaultDatabaseConnectTimeout,
		MediaRequestTimeout:    defaultMediaRequestTimeout,
	}

	testCases := []struct {
		name        string
		environment map[string]string
		want        Config
		wantErr     string
	}{
		{
			name: "defaults",
			want: defaults,
		},
		{
			name: "environment values",
			environment: map[string]string{
				"HTTP_ADDR": "127.0.0.1:9000", "SHUTDOWN_TIMEOUT": "3s",
				"DATABASE_CONNECT_TIMEOUT": "2s", "MEDIA_REQUEST_TIMEOUT": "4s",
				"LIVEKIT_URL": "wss://livekit.test", "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			want: Config{
				HTTPAddress:            "127.0.0.1:9000",
				ShutdownTimeout:        3 * time.Second,
				DatabaseURL:            databaseURL,
				DatabaseConnectTimeout: 2 * time.Second,
				MediaRequestTimeout:    4 * time.Second,
				LiveKitURL:             "wss://livekit.test", LiveKitAPIKey: "test-key", LiveKitAPISecret: secret,
			},
		},
		{
			name:        "invalid HTTP address",
			environment: map[string]string{"HTTP_ADDR": "localhost"},
			wantErr:     "parse HTTP_ADDR",
		},
		{
			name:        "invalid shutdown timeout",
			environment: map[string]string{"SHUTDOWN_TIMEOUT": "soon"},
			wantErr:     "parse SHUTDOWN_TIMEOUT",
		},
		{name: "missing database", environment: map[string]string{"DATABASE_URL": ""}, wantErr: "DATABASE_URL is required"},
		{
			name: "invalid database timeout", environment: map[string]string{"DATABASE_CONNECT_TIMEOUT": "0s"},
			wantErr: "DATABASE_CONNECT_TIMEOUT must be positive",
		},
		{
			name: "invalid media timeout", environment: map[string]string{"MEDIA_REQUEST_TIMEOUT": "-1s"},
			wantErr: "MEDIA_REQUEST_TIMEOUT must be positive",
		},
		{
			name: "partial LiveKit credentials", environment: map[string]string{"LIVEKIT_API_SECRET": secret},
			wantErr: "must be set together",
		},
		{
			name: "invalid LiveKit URL",
			environment: map[string]string{
				"LIVEKIT_URL": "https://livekit.test", "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			wantErr: "LIVEKIT_URL must use ws or wss and include a host",
		},
		{
			name: "credentials in LiveKit URL",
			environment: map[string]string{
				"LIVEKIT_URL": credentialURL.String(), "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			wantErr: "LIVEKIT_URL must not contain credentials",
		},
		{
			name: "zero LiveKit port",
			environment: map[string]string{
				"LIVEKIT_URL": "wss://livekit.test:0", "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			wantErr: "LIVEKIT_URL port must be between 1 and 65535",
		},
		{
			name: "LiveKit port out of range",
			environment: map[string]string{
				"LIVEKIT_URL": "wss://livekit.test:65536", "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			wantErr: "LIVEKIT_URL port must be between 1 and 65535",
		},
		{
			name: "malformed LiveKit URL hides secrets",
			environment: map[string]string{
				"LIVEKIT_URL": "wss://%invalid/" + secret, "LIVEKIT_API_KEY": "test-key", "LIVEKIT_API_SECRET": secret,
			},
			wantErr: "LIVEKIT_URL must use ws or wss and include a host",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			for _, name := range []string{
				"HTTP_ADDR", "SHUTDOWN_TIMEOUT", "DATABASE_CONNECT_TIMEOUT", "MEDIA_REQUEST_TIMEOUT",
				"LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
			} {
				t.Setenv(name, "")
			}

			t.Setenv("DATABASE_URL", databaseURL)
			for name, value := range testCase.environment {
				t.Setenv(name, value)
			}

			got, err := Load()
			if testCase.wantErr != "" {
				assertErrorContains(t, err, testCase.wantErr)
				if got != nil {
					t.Error("Load() returned a config on error")
				}

				if strings.Contains(err.Error(), secret) {
					t.Error("Load() exposed a secret in its error")
				}

				return
			}

			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}

			if *got != testCase.want {
				t.Errorf("Load() = %+v, want %+v", *got, testCase.want)
			}
		})
	}
}

func TestAddressFromEnv(t *testing.T) {
	const (
		envName          = "TEST_ADDR"
		invalidPortError = "TEST_ADDR must contain a port between 1 and 65535"
	)

	testCases := []struct {
		name     string
		value    string
		fallback string
		want     string
		wantErr  string
	}{
		{name: "fallback", fallback: ":8080", want: ":8080"},
		{name: "empty host", value: ":8080", want: ":8080"},
		{name: "IPv4", value: "127.0.0.1:8080", want: "127.0.0.1:8080"},
		{name: "hostname", value: "localhost:8080", want: "localhost:8080"},
		{name: "IPv6", value: "[::1]:8080", want: "[::1]:8080"},
		{name: "missing port", value: "localhost", wantErr: "parse TEST_ADDR"},
		{name: "non-numeric port", value: ":http", wantErr: invalidPortError},
		{name: "zero port", value: ":0", wantErr: invalidPortError},
		{name: "port out of range", value: ":65536", wantErr: invalidPortError},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv(envName, testCase.value)

			got, err := addressFromEnv(envName, testCase.fallback)
			if testCase.wantErr != "" {
				assertErrorContains(t, err, testCase.wantErr)

				return
			}

			if err != nil {
				t.Fatalf("addressFromEnv() error = %v", err)
			}

			if got != testCase.want {
				t.Errorf("addressFromEnv() = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestDurationFromEnv(t *testing.T) {
	const envName = "TEST_DURATION"

	testCases := []struct {
		name     string
		value    string
		fallback time.Duration
		want     time.Duration
		wantErr  string
	}{
		{name: "fallback", fallback: 5 * time.Second, want: 5 * time.Second},
		{name: "environment value", value: "3s", want: 3 * time.Second},
		{name: "invalid duration", value: "soon", wantErr: "parse TEST_DURATION"},
		{name: "zero", value: "0s", wantErr: "TEST_DURATION must be positive"},
		{name: "negative", value: "-1s", wantErr: "TEST_DURATION must be positive"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv(envName, testCase.value)

			got, err := durationFromEnv(envName, testCase.fallback)
			if testCase.wantErr != "" {
				assertErrorContains(t, err, testCase.wantErr)

				return
			}

			if err != nil {
				t.Fatalf("durationFromEnv() error = %v", err)
			}

			if got != testCase.want {
				t.Errorf("durationFromEnv() = %s, want %s", got, testCase.want)
			}
		})
	}
}

func assertErrorContains(t *testing.T, err error, want string) {
	t.Helper()

	if err == nil {
		t.Fatalf("error = nil, want it to contain %q", want)
	}

	if !strings.Contains(err.Error(), want) {
		t.Errorf("error = %q, want it to contain %q", err, want)
	}
}
