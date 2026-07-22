package config_test

import (
	"log/slog"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/config"
)

func setValidAuthEnv(t *testing.T) {
	t.Helper()
	t.Setenv("SUPABASE_JWT_ISSUER", "https://project.supabase.co/auth/v1")
	t.Setenv("SUPABASE_JWKS_URL", "https://project.supabase.co/auth/v1/.well-known/jwks.json")
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
}

func TestLoadUsesSafeDevelopmentDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@127.0.0.1:54329/postgres?sslmode=disable")
	t.Setenv("PORT", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("SUPABASE_JWT_ISSUER", "https://project.supabase.co/auth/v1")
	t.Setenv("SUPABASE_JWKS_URL", "https://project.supabase.co/auth/v1/.well-known/jwks.json")
	t.Setenv("SUPABASE_JWT_AUDIENCE", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Port != "8080" {
		t.Fatalf("port = %q, want 8080", cfg.Port)
	}
	if cfg.Environment != "development" {
		t.Fatalf("environment = %q, want development", cfg.Environment)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Fatalf("log level = %v, want info", cfg.LogLevel)
	}
	if cfg.JWTAudience != "authenticated" {
		t.Fatalf("audience = %q, want authenticated default", cfg.JWTAudience)
	}
	if len(cfg.CORSOrigins) != 1 || cfg.CORSOrigins[0] != "http://localhost:5173" {
		t.Fatalf("cors origins = %v, want default localhost", cfg.CORSOrigins)
	}
}

func TestLoadRejectsMissingDatabaseURL(t *testing.T) {
	setValidAuthEnv(t)
	t.Setenv("DATABASE_URL", "")

	if _, err := config.Load(); err == nil {
		t.Fatal("load config succeeded without DATABASE_URL")
	}
}

func TestLoadRejectsInvalidPortAndLogLevel(t *testing.T) {
	setValidAuthEnv(t)
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")

	for _, tc := range []struct {
		name     string
		port     string
		logLevel string
	}{
		{name: "nonnumeric port", port: "http", logLevel: "info"},
		{name: "out of range port", port: "70000", logLevel: "info"},
		{name: "unknown log level", port: "8080", logLevel: "verbose"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PORT", tc.port)
			t.Setenv("LOG_LEVEL", tc.logLevel)
			if _, err := config.Load(); err == nil {
				t.Fatal("load config succeeded with invalid input")
			}
		})
	}
}

func TestLoadRequiresVerifiedTLSInProduction(t *testing.T) {
	setValidAuthEnv(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@db.example.com/postgres?sslmode=require")

	if _, err := config.Load(); err == nil {
		t.Fatal("load config accepted production DSN without verify-full")
	}

	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@db.example.com/postgres?sslmode=verify-full")
	if _, err := config.Load(); err != nil {
		t.Fatalf("load production config with verify-full: %v", err)
	}
}

func TestLoadRejectsInvalidAuthConfig(t *testing.T) {
	base := func() {
		t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
		setValidAuthEnv(t)
	}

	t.Run("missing issuer", func(t *testing.T) {
		base()
		t.Setenv("SUPABASE_JWT_ISSUER", "")
		if _, err := config.Load(); err == nil {
			t.Fatal("accepted empty issuer")
		}
	})

	t.Run("non https issuer", func(t *testing.T) {
		base()
		t.Setenv("SUPABASE_JWT_ISSUER", "http://project.supabase.co/auth/v1")
		if _, err := config.Load(); err == nil {
			t.Fatal("accepted non-https issuer")
		}
	})

	t.Run("missing jwks", func(t *testing.T) {
		base()
		t.Setenv("SUPABASE_JWKS_URL", "")
		if _, err := config.Load(); err == nil {
			t.Fatal("accepted empty jwks url")
		}
	})

	t.Run("non https jwks", func(t *testing.T) {
		base()
		t.Setenv("SUPABASE_JWKS_URL", "ftp://project.supabase.co/jwks")
		if _, err := config.Load(); err == nil {
			t.Fatal("accepted non-https jwks url")
		}
	})

	t.Run("blank cors", func(t *testing.T) {
		base()
		t.Setenv("CORS_ALLOWED_ORIGINS", "  ,  ")
		if _, err := config.Load(); err == nil {
			t.Fatal("accepted blank cors origins")
		}
	})
}

func TestLoadParsesMultipleCORSOrigins(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
	setValidAuthEnv(t)
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, https://app.budg.dev ")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if len(cfg.CORSOrigins) != 2 || cfg.CORSOrigins[1] != "https://app.budg.dev" {
		t.Fatalf("cors origins = %v, want trimmed pair", cfg.CORSOrigins)
	}
}

func TestLoadUsesSafeAgentDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
	setValidAuthEnv(t)
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("AGENT_MODEL", "")
	t.Setenv("AGENT_MAX_STEPS", "")
	t.Setenv("AGENT_MAX_TOOL_CALLS", "")
	t.Setenv("AGENT_TIMEOUT_SECONDS", "")
	t.Setenv("AGENT_MAX_OUTPUT_TOKENS", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Agent.Enabled {
		t.Fatal("agent enabled without OPENAI_API_KEY")
	}
	if cfg.Agent.Model != "gpt-5.4-nano" {
		t.Fatalf("agent model = %q, want gpt-5.4-nano", cfg.Agent.Model)
	}
	if cfg.Agent.MaxSteps != 6 || cfg.Agent.MaxToolCalls != 8 {
		t.Fatalf("agent limits = steps %d, tools %d", cfg.Agent.MaxSteps, cfg.Agent.MaxToolCalls)
	}
	if cfg.Agent.Timeout != 30*time.Second || cfg.Agent.MaxOutputTokens != 1200 {
		t.Fatalf("agent timeout/output = %v/%d", cfg.Agent.Timeout, cfg.Agent.MaxOutputTokens)
	}
	if len(cfg.Agent.ConfirmationSecret) != 0 {
		t.Fatal("confirmation secret should be empty when AGENT_CONFIRMATION_SECRET is unset; caller generates an ephemeral one")
	}
	if cfg.Agent.ConfirmationTTL != 5*time.Minute {
		t.Fatalf("confirmation ttl = %v, want 5m default", cfg.Agent.ConfirmationTTL)
	}
}

func TestLoadParsesAgentConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
	setValidAuthEnv(t)
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("AGENT_MODEL", "small-tool-model")
	t.Setenv("AGENT_MAX_STEPS", "4")
	t.Setenv("AGENT_MAX_TOOL_CALLS", "5")
	t.Setenv("AGENT_TIMEOUT_SECONDS", "20")
	t.Setenv("AGENT_MAX_OUTPUT_TOKENS", "700")
	t.Setenv("AGENT_CONFIRMATION_SECRET", "a-configured-secret-value-with-enough-bytes")
	t.Setenv("AGENT_CONFIRMATION_TTL_SECONDS", "120")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if !cfg.Agent.Enabled || cfg.Agent.APIKey != "test-key" || cfg.Agent.Model != "small-tool-model" {
		t.Fatalf("unexpected agent config: %+v", cfg.Agent)
	}
	if cfg.Agent.MaxSteps != 4 || cfg.Agent.MaxToolCalls != 5 {
		t.Fatalf("agent limits = steps %d, tools %d", cfg.Agent.MaxSteps, cfg.Agent.MaxToolCalls)
	}
	if cfg.Agent.Timeout != 20*time.Second || cfg.Agent.MaxOutputTokens != 700 {
		t.Fatalf("agent timeout/output = %v/%d", cfg.Agent.Timeout, cfg.Agent.MaxOutputTokens)
	}
	if string(cfg.Agent.ConfirmationSecret) != "a-configured-secret-value-with-enough-bytes" {
		t.Fatalf("confirmation secret = %q, want the configured value", cfg.Agent.ConfirmationSecret)
	}
	if cfg.Agent.ConfirmationTTL != 2*time.Minute {
		t.Fatalf("confirmation ttl = %v, want 2m", cfg.Agent.ConfirmationTTL)
	}
}

func TestLoadRejectsShortConfirmationSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
	setValidAuthEnv(t)
	t.Setenv("AGENT_CONFIRMATION_SECRET", "too-short")

	if _, err := config.Load(); err == nil {
		t.Fatal("load config accepted a confirmation secret shorter than 16 bytes")
	}
}

func TestLoadRejectsInvalidConfirmationTTL(t *testing.T) {
	for _, value := range []string{"0", "29", "1801", "many"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
			setValidAuthEnv(t)
			t.Setenv("AGENT_CONFIRMATION_TTL_SECONDS", value)
			if _, err := config.Load(); err == nil {
				t.Fatal("load config accepted an invalid confirmation ttl")
			}
		})
	}
}

func TestLoadRejectsInvalidAgentLimits(t *testing.T) {
	for _, tc := range []struct {
		name  string
		key   string
		value string
	}{
		{name: "zero steps", key: "AGENT_MAX_STEPS", value: "0"},
		{name: "too many steps", key: "AGENT_MAX_STEPS", value: "13"},
		{name: "zero tool calls", key: "AGENT_MAX_TOOL_CALLS", value: "0"},
		{name: "too many tool calls", key: "AGENT_MAX_TOOL_CALLS", value: "25"},
		{name: "short timeout", key: "AGENT_TIMEOUT_SECONDS", value: "4"},
		{name: "long timeout", key: "AGENT_TIMEOUT_SECONDS", value: "121"},
		{name: "small output", key: "AGENT_MAX_OUTPUT_TOKENS", value: "63"},
		{name: "large output", key: "AGENT_MAX_OUTPUT_TOKENS", value: "8193"},
		{name: "not an integer", key: "AGENT_MAX_STEPS", value: "many"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@localhost/postgres")
			setValidAuthEnv(t)
			t.Setenv(tc.key, tc.value)
			if _, err := config.Load(); err == nil {
				t.Fatal("load config accepted invalid agent limit")
			}
		})
	}
}
