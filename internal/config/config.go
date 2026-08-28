package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

const (
	defaultHTTPAddress     = ":8080"
	defaultShutdownTimeout = 10 * time.Second
)

type Config struct {
	HTTPAddress     string
	ShutdownTimeout time.Duration
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

	return &Config{
		HTTPAddress:     httpAddress,
		ShutdownTimeout: shutdownTimeout,
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
