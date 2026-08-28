package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	testCases := []struct {
		name            string
		httpAddress     string
		shutdownTimeout string
		want            Config
		wantErr         string
	}{
		{
			name: "defaults",
			want: Config{
				HTTPAddress:     defaultHTTPAddress,
				ShutdownTimeout: defaultShutdownTimeout,
			},
		},
		{
			name:            "environment values",
			httpAddress:     "127.0.0.1:9000",
			shutdownTimeout: "3s",
			want: Config{
				HTTPAddress:     "127.0.0.1:9000",
				ShutdownTimeout: 3 * time.Second,
			},
		},
		{
			name:        "invalid HTTP address",
			httpAddress: "localhost",
			wantErr:     "parse HTTP_ADDR",
		},
		{
			name:            "invalid shutdown timeout",
			shutdownTimeout: "soon",
			wantErr:         "parse SHUTDOWN_TIMEOUT",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("HTTP_ADDR", testCase.httpAddress)
			t.Setenv("SHUTDOWN_TIMEOUT", testCase.shutdownTimeout)

			got, err := Load()
			if testCase.wantErr != "" {
				assertErrorContains(t, err, testCase.wantErr)

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
