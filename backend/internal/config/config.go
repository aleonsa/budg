package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type AgentConfig struct {
	Enabled         bool
	APIKey          string
	Model           string
	MaxSteps        int
	MaxToolCalls    int
	Timeout         time.Duration
	MaxOutputTokens int
	// ConfirmationSecret is empty when AGENT_CONFIRMATION_SECRET is unset.
	// The caller (cmd/api/main.go) must generate an ephemeral one in that
	// case; config.Load stays a pure function so this is testable without
	// mocking randomness. An ephemeral secret means pending confirmations do
	// not survive a process restart or, in a multi-instance deployment, a
	// request landing on a different instance -- acceptable for a personal-
	// use app (the user just sees "expired, try again"), but production
	// should set this explicitly for a stable, shared secret.
	ConfirmationSecret []byte
	ConfirmationTTL    time.Duration
}

type Config struct {
	Port        string
	Environment string
	LogLevel    slog.Level
	DatabaseURL string
	JWTIssuer   string
	JWKSURL     string
	JWTAudience string
	CORSOrigins []string
	Agent       AgentConfig
}

func Load() (Config, error) {
	maxSteps, err := boundedIntEnv("AGENT_MAX_STEPS", 6, 1, 12)
	if err != nil {
		return Config{}, err
	}
	maxToolCalls, err := boundedIntEnv("AGENT_MAX_TOOL_CALLS", 8, 1, 24)
	if err != nil {
		return Config{}, err
	}
	timeoutSeconds, err := boundedIntEnv("AGENT_TIMEOUT_SECONDS", 30, 5, 120)
	if err != nil {
		return Config{}, err
	}
	maxOutputTokens, err := boundedIntEnv("AGENT_MAX_OUTPUT_TOKENS", 1200, 64, 8192)
	if err != nil {
		return Config{}, err
	}
	confirmationTTLSeconds, err := boundedIntEnv("AGENT_CONFIRMATION_TTL_SECONDS", 300, 30, 1800)
	if err != nil {
		return Config{}, err
	}
	confirmationSecret := os.Getenv("AGENT_CONFIRMATION_SECRET")
	if confirmationSecret != "" && len(confirmationSecret) < 16 {
		return Config{}, errors.New("AGENT_CONFIRMATION_SECRET must be at least 16 characters")
	}
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))

	cfg := Config{
		Port:        envOrDefault("PORT", "8080"),
		Environment: envOrDefault("APP_ENV", "development"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTIssuer:   os.Getenv("SUPABASE_JWT_ISSUER"),
		JWKSURL:     os.Getenv("SUPABASE_JWKS_URL"),
		JWTAudience: envOrDefault("SUPABASE_JWT_AUDIENCE", "authenticated"),
		Agent: AgentConfig{
			Enabled:            apiKey != "",
			APIKey:             apiKey,
			Model:              strings.TrimSpace(envOrDefault("AGENT_MODEL", "gpt-5.4-nano")),
			MaxSteps:           maxSteps,
			MaxToolCalls:       maxToolCalls,
			Timeout:            time.Duration(timeoutSeconds) * time.Second,
			MaxOutputTokens:    maxOutputTokens,
			ConfirmationSecret: []byte(confirmationSecret),
			ConfirmationTTL:    time.Duration(confirmationTTLSeconds) * time.Second,
		},
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

func boundedIntEnv(name string, fallback, minValue, maxValue int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minValue || value > maxValue {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, minValue, maxValue)
	}
	return value, nil
}
