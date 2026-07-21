package auth_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/aleonsa/budg/backend/internal/auth"
)

const (
	testIssuer   = "https://project.supabase.co/auth/v1"
	testAudience = "authenticated"
	testUserID   = "421d22c6-1f2f-465f-aaf8-27ffcbfcb920"
)

type signingKeys struct {
	privateKey jwk.Key
	provider   jwt.ParseOption
}

func newSigningKeys(t *testing.T) signingKeys {
	t.Helper()

	raw, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate ec key: %v", err)
	}

	priv, err := jwk.Import(raw)
	if err != nil {
		t.Fatalf("import private key: %v", err)
	}
	if err := priv.Set(jwk.KeyIDKey, "test-key"); err != nil {
		t.Fatalf("set kid: %v", err)
	}
	if err := priv.Set(jwk.AlgorithmKey, jwa.ES256()); err != nil {
		t.Fatalf("set alg: %v", err)
	}

	pub, err := priv.PublicKey()
	if err != nil {
		t.Fatalf("derive public key: %v", err)
	}
	set := jwk.NewSet()
	if err := set.AddKey(pub); err != nil {
		t.Fatalf("add public key: %v", err)
	}

	return signingKeys{privateKey: priv, provider: jwt.WithKeySet(set)}
}

func (s signingKeys) sign(t *testing.T, build func(b *jwt.Builder) *jwt.Builder) string {
	t.Helper()

	base := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{testAudience}).
		Subject(testUserID).
		IssuedAt(time.Now()).
		Expiration(time.Now().Add(time.Hour))

	token, err := build(base).Build()
	if err != nil {
		t.Fatalf("build token: %v", err)
	}

	signed, err := jwt.Sign(token, jwt.WithKey(jwa.ES256(), s.privateKey))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return string(signed)
}

func newVerifier(keys signingKeys) *auth.Verifier {
	return auth.NewVerifier(keys.provider, auth.Config{Issuer: testIssuer, Audience: testAudience})
}

func protectedHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := auth.FromContext(r.Context())
		if err != nil {
			t.Errorf("handler reached without user: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(user.ID + "|" + user.Email))
	})
}

func doRequest(handler http.Handler, authHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestMiddlewareAcceptsValidToken(t *testing.T) {
	keys := newSigningKeys(t)
	token := keys.sign(t, func(b *jwt.Builder) *jwt.Builder {
		return b.Claim("email", "user@example.com")
	})

	handler := newVerifier(keys).Middleware(protectedHandler(t))
	rec := doRequest(handler, "Bearer "+token)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != testUserID+"|user@example.com" {
		t.Fatalf("body = %q, want user id and email", body)
	}
}

func TestMiddlewareRejectsMissingAndMalformedHeaders(t *testing.T) {
	keys := newSigningKeys(t)
	handler := newVerifier(keys).Middleware(protectedHandler(t))

	for _, header := range []string{"", "token-without-scheme", "Basic abc", "Bearer ", "Bearer    "} {
		rec := doRequest(handler, header)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("header %q: status = %d, want 401", header, rec.Code)
		}
	}
}

func TestMiddlewareRejectsExpiredToken(t *testing.T) {
	keys := newSigningKeys(t)
	token := keys.sign(t, func(b *jwt.Builder) *jwt.Builder {
		return b.IssuedAt(time.Now().Add(-2 * time.Hour)).
			Expiration(time.Now().Add(-time.Hour))
	})

	handler := newVerifier(keys).Middleware(protectedHandler(t))
	rec := doRequest(handler, "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for expired token", rec.Code)
	}
}

func TestMiddlewareRejectsWrongAudienceAndIssuer(t *testing.T) {
	keys := newSigningKeys(t)

	wrongAudience := keys.sign(t, func(b *jwt.Builder) *jwt.Builder {
		return b.Audience([]string{"anon"})
	})
	wrongIssuer := keys.sign(t, func(b *jwt.Builder) *jwt.Builder {
		return b.Issuer("https://evil.example.com/auth/v1")
	})

	handler := newVerifier(keys).Middleware(protectedHandler(t))

	if rec := doRequest(handler, "Bearer "+wrongAudience); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong audience: status = %d, want 401", rec.Code)
	}
	if rec := doRequest(handler, "Bearer "+wrongIssuer); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong issuer: status = %d, want 401", rec.Code)
	}
}

func TestMiddlewareRejectsTokenSignedByUnknownKey(t *testing.T) {
	trusted := newSigningKeys(t)
	attacker := newSigningKeys(t)

	// Token is well-formed but signed by a key absent from the trusted JWKS.
	token := attacker.sign(t, func(b *jwt.Builder) *jwt.Builder { return b })

	handler := newVerifier(trusted).Middleware(protectedHandler(t))
	rec := doRequest(handler, "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for foreign signature", rec.Code)
	}
}

func TestMiddlewareRejectsHS256Token(t *testing.T) {
	keys := newSigningKeys(t)

	token, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{testAudience}).
		Subject(testUserID).
		IssuedAt(time.Now()).
		Expiration(time.Now().Add(time.Hour)).
		Build()
	if err != nil {
		t.Fatalf("build token: %v", err)
	}
	signed, err := jwt.Sign(token, jwt.WithKey(jwa.HS256(), []byte("shared-secret-attack")))
	if err != nil {
		t.Fatalf("sign hs256: %v", err)
	}

	handler := newVerifier(keys).Middleware(protectedHandler(t))
	rec := doRequest(handler, "Bearer "+string(signed))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for HS256 token", rec.Code)
	}
}

func TestFromContextWithoutUser(t *testing.T) {
	if _, err := auth.FromContext(t.Context()); err == nil {
		t.Fatal("expected error when context has no user")
	}
}
