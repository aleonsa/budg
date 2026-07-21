package config_test

import (
	"log/slog"
	"testing"

	"github.com/aleonsa/budg/backend/internal/config"
)

func TestLoadUsesSafeDevelopmentDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://budg_api:secret@127.0.0.1:54329/postgres?sslmode=disable")
	t.Setenv("PORT", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("LOG_LEVEL", "")

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
}

func TestLoadRejectsMissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if _, err := config.Load(); err == nil {
		t.Fatal("load config succeeded without DATABASE_URL")
	}
}

func TestLoadRejectsInvalidPortAndLogLevel(t *testing.T) {
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
