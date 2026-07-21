package config_test

import (
	"log/slog"
	"testing"

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
