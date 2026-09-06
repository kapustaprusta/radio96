package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHTTPAddress            = ":8080"
	defaultShutdownTimeout        = 10 * time.Second
	defaultDatabaseConnectTimeout = 5 * time.Second
	defaultMediaRequestTimeout    = 5 * time.Second
)

type Config struct {
	HTTPAddress            string
	ShutdownTimeout        time.Duration
	DatabaseURL            string
	DatabaseConnectTimeout time.Duration
	LiveKitURL             string
	LiveKitAPIKey          string
	LiveKitAPISecret       string
	MediaRequestTimeout    time.Duration
}

func Load() (*Config, error) {
	httpAddress, err := addressFromEnv("HTTP_ADDR", defaultHTTPAddress)
	if err != nil {
		return nil, err
	}

	shutdownTimeout, err := durationFromEnv("SHUTDOWN_TIMEOUT", defaultShutdownTimeout)
	if err != nil {
		return nil, err
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}

	databaseConnectTimeout, err := durationFromEnv("DATABASE_CONNECT_TIMEOUT", defaultDatabaseConnectTimeout)
	if err != nil {
		return nil, err
	}

	mediaRequestTimeout, err := durationFromEnv("MEDIA_REQUEST_TIMEOUT", defaultMediaRequestTimeout)
	if err != nil {
		return nil, err
	}

	liveKitURL := strings.TrimSpace(os.Getenv("LIVEKIT_URL"))
	liveKitAPIKey := strings.TrimSpace(os.Getenv("LIVEKIT_API_KEY"))
	liveKitAPISecret := strings.TrimSpace(os.Getenv("LIVEKIT_API_SECRET"))
	if liveKitURL != "" || liveKitAPIKey != "" || liveKitAPISecret != "" {
		if liveKitURL == "" || liveKitAPIKey == "" || liveKitAPISecret == "" {
			return nil, errors.New("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set together")
		}

		parsedURL, parseErr := url.Parse(liveKitURL)
		if parseErr != nil || parsedURL.Hostname() == "" || (parsedURL.Scheme != "ws" && parsedURL.Scheme != "wss") {
			return nil, errors.New("LIVEKIT_URL must use ws or wss and include a host")
		}

		if parsedURL.User != nil || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
			return nil, errors.New("LIVEKIT_URL must not contain credentials, a query or a fragment")
		}

		if port := parsedURL.Port(); port != "" {
			portNumber, portErr := strconv.ParseUint(port, 10, 16)
			if portErr != nil || portNumber == 0 {
				return nil, errors.New("LIVEKIT_URL port must be between 1 and 65535")
			}
		}
	}

	return &Config{
		HTTPAddress:            httpAddress,
		ShutdownTimeout:        shutdownTimeout,
		DatabaseURL:            databaseURL,
		DatabaseConnectTimeout: databaseConnectTimeout,
		LiveKitURL:             liveKitURL,
		LiveKitAPIKey:          liveKitAPIKey,
		LiveKitAPISecret:       liveKitAPISecret,
		MediaRequestTimeout:    mediaRequestTimeout,
	}, nil
}

func addressFromEnv(name, fallback string) (string, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback, nil
	}

	_, port, err := net.SplitHostPort(raw)
	if err != nil {
		return "", fmt.Errorf("parse %s: %w", name, err)
	}

	portNumber, err := strconv.ParseUint(port, 10, 16)
	if err != nil || portNumber == 0 {
		return "", fmt.Errorf("%s must contain a port between 1 and 65535", name)
	}

	return raw, nil
}

func durationFromEnv(name string, fallback time.Duration) (time.Duration, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback, nil
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}

	if value <= 0 {
		return 0, fmt.Errorf("%s must be positive", name)
	}

	return value, nil
}
