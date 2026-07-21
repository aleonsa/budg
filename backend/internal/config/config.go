package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	Environment string
	LogLevel    slog.Level
	DatabaseURL string
}

func Load() (Config, error) {
	cfg := Config{
		Port:        envOrDefault("PORT", "8080"),
		Environment: envOrDefault("APP_ENV", "development"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
	}

	port, err := strconv.Atoi(cfg.Port)
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
	}

	switch cfg.Environment {
	case "development", "test", "production":
	default:
		return Config{}, fmt.Errorf("APP_ENV must be development, test, or production")
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(strings.ToLower(envOrDefault("LOG_LEVEL", "info")))); err != nil {
		return Config{}, fmt.Errorf("LOG_LEVEL must be debug, info, warn, or error")
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	databaseURL, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (databaseURL.Scheme != "postgres" && databaseURL.Scheme != "postgresql") || databaseURL.Host == "" {
		return Config{}, errors.New("DATABASE_URL must be a valid PostgreSQL URL")
	}
	if cfg.Environment == "production" && databaseURL.Query().Get("sslmode") != "verify-full" {
		return Config{}, errors.New("production DATABASE_URL must use sslmode=verify-full")
	}

	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
