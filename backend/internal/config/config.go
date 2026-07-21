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
	JWTIssuer   string
	JWKSURL     string
	JWTAudience string
	CORSOrigins []string
}

func Load() (Config, error) {
	cfg := Config{
		Port:        envOrDefault("PORT", "8080"),
		Environment: envOrDefault("APP_ENV", "development"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTIssuer:   os.Getenv("SUPABASE_JWT_ISSUER"),
		JWKSURL:     os.Getenv("SUPABASE_JWKS_URL"),
		JWTAudience: envOrDefault("SUPABASE_JWT_AUDIENCE", "authenticated"),
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

	if cfg.JWTIssuer == "" {
		return Config{}, errors.New("SUPABASE_JWT_ISSUER is required")
	}
	issuer, err := url.Parse(cfg.JWTIssuer)
	if err != nil || issuer.Scheme != "https" || issuer.Host == "" {
		return Config{}, errors.New("SUPABASE_JWT_ISSUER must be an https URL")
	}

	if cfg.JWKSURL == "" {
		return Config{}, errors.New("SUPABASE_JWKS_URL is required")
	}
	jwks, err := url.Parse(cfg.JWKSURL)
	if err != nil || jwks.Scheme != "https" || jwks.Host == "" {
		return Config{}, errors.New("SUPABASE_JWKS_URL must be an https URL")
	}

	if cfg.JWTAudience == "" {
		return Config{}, errors.New("SUPABASE_JWT_AUDIENCE is required")
	}

	cfg.CORSOrigins = parseCORSOrigins(envOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173"))
	if len(cfg.CORSOrigins) == 0 {
		return Config{}, errors.New("CORS_ALLOWED_ORIGINS must list at least one origin")
	}

	return cfg, nil
}

func parseCORSOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
