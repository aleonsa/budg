// Package auth verifies Supabase-issued JWTs using the project's JWKS and
// exposes the authenticated user through the request context. Identity always
// comes from the verified token; handlers never trust a client-supplied user.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// User is the verified identity extracted from a Supabase access token.
type User struct {
	ID    string
	Email string
}

type contextKey struct{}

var userContextKey = contextKey{}

// ErrNoUser is returned when the context carries no authenticated user.
var ErrNoUser = errors.New("no authenticated user in context")

// Verifier validates access tokens against a JWKS and enforces issuer,
// audience, signature, and expiration.
type Verifier struct {
	keyOption jwt.ParseOption
	issuer    string
	audience  string
}

// Config holds the verification parameters resolved from environment.
type Config struct {
	Issuer   string
	Audience string
}

// NewVerifier builds a verifier from a key-bearing parse option such as
// jwt.WithKeySet. Callers supply the trusted JWKS; symmetric secrets are never
// accepted because no HS* key is ever provided.
func NewVerifier(keyOption jwt.ParseOption, cfg Config) *Verifier {
	return &Verifier{keyOption: keyOption, issuer: cfg.Issuer, audience: cfg.Audience}
}

// NewCachedKeyOption builds a jwk.Cache-backed key option that refreshes the
// JWKS on its own schedule so the process never blocks a request on network I/O
// after the initial fetch.
func NewCachedKeyOption(ctx context.Context, jwksURL string) (jwt.ParseOption, error) {
	cache, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, fmt.Errorf("create jwks cache: %w", err)
	}
	if err := cache.Register(ctx, jwksURL); err != nil {
		return nil, fmt.Errorf("register jwks url: %w", err)
	}
	if _, err := cache.Refresh(ctx, jwksURL); err != nil {
		return nil, fmt.Errorf("initial jwks refresh: %w", err)
	}
	set, err := cache.CachedSet(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("cached jwks set: %w", err)
	}
	return jwt.WithKeySet(set), nil
}

// Verify parses and validates a raw token string, returning the user identity.
func (v *Verifier) Verify(ctx context.Context, raw string) (User, error) {
	token, err := jwt.Parse([]byte(raw),
		v.keyOption,
		jwt.WithValidate(true),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithAcceptableSkew(30*time.Second),
	)
	if err != nil {
		return User{}, fmt.Errorf("verify token: %w", err)
	}

	sub, ok := token.Subject()
	if !ok || sub == "" {
		return User{}, errors.New("token has no subject")
	}

	user := User{ID: sub}
	var email string
	if err := token.Get("email", &email); err == nil {
		user.Email = email
	}
	return user, nil
}

// Middleware returns HTTP middleware that rejects requests without a valid
// bearer token and stores the verified user in the request context.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := bearerToken(r)
		if err != nil {
			writeUnauthorized(w)
			return
		}

		user, err := v.Verify(r.Context(), raw)
		if err != nil {
			writeUnauthorized(w)
			return
		}

		next.ServeHTTP(w, r.WithContext(ContextWithUser(r.Context(), user)))
	})
}

// FromContext returns the authenticated user stored by the middleware.
func FromContext(ctx context.Context) (User, error) {
	user, ok := ctx.Value(userContextKey).(User)
	if !ok {
		return User{}, ErrNoUser
	}
	return user, nil
}

// ContextWithUser stores a verified user in the context. The middleware uses it
// after verification; it is also the composition point for future onboarding
// flows and handler tests that need an authenticated context.
func ContextWithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

func bearerToken(r *http.Request) (string, error) {
	header := r.Header.Get("Authorization")
	if header == "" {
		return "", errors.New("missing authorization header")
	}
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return "", errors.New("authorization header is not a bearer token")
	}
	token := strings.TrimSpace(header[len(prefix):])
	if token == "" {
		return "", errors.New("bearer token is empty")
	}
	return token, nil
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"a valid access token is required"}}`))
}
