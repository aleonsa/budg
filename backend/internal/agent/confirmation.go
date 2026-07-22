package agent

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// PendingConfirmation is what the harness returns to the caller when a
// mutation tool produced a proposal instead of executing. The token is
// self-contained (see Confirmer): nothing about it is stored server-side, so
// it survives fine across stateless requests and process restarts within its
// TTL, matching this phase's "no conversation persistence" design.
type PendingConfirmation struct {
	ToolName  string
	Token     string
	ExpiresAt time.Time
}

// confirmationPayload is the self-describing content of a token: which user,
// which tool, and which exact (canonicalized) arguments it authorizes,
// scoped to an expiry. Verify checks all four; any mismatch fails closed.
type confirmationPayload struct {
	UserID    string          `json:"userId"`
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	// ExpiresAt is Unix nanoseconds, not seconds: a second-granularity
	// timestamp would round very short TTLs (as used in tests, and possibly
	// in a future low-risk-action config) up to "not yet expired".
	ExpiresAt int64 `json:"expiresAt"`
}

// Confirmer issues and verifies confirmation tokens using HMAC-SHA256 over a
// canonicalized payload. It intentionally keeps no state of its own: a token
// is valid if and only if its signature, expiry, and payload check out against
// the current request, which is what lets this phase avoid persisting
// conversations or pending-confirmation rows anywhere.
type Confirmer struct {
	secret []byte
	ttl    time.Duration
}

// NewConfirmer requires a secret of at least 16 bytes (128 bits) -- enough to
// resist brute-force forgery of the HMAC -- and a positive TTL.
func NewConfirmer(secret []byte, ttl time.Duration) (*Confirmer, error) {
	if len(secret) < 16 {
		return nil, errors.New("confirmation secret must be at least 16 bytes")
	}
	if ttl <= 0 {
		return nil, errors.New("confirmation ttl must be positive")
	}
	return &Confirmer{secret: secret, ttl: ttl}, nil
}

// Issue mints a token authorizing exactly this (userID, tool, arguments)
// triple until it expires. arguments is canonicalized before signing so that
// semantically identical JSON (e.g. reordered keys) verifies the same way
// regardless of how the caller happens to re-serialize it.
func (c *Confirmer) Issue(userID, tool string, arguments json.RawMessage) (string, time.Time, error) {
	canonical, err := canonicalizeJSON(arguments)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("canonicalize arguments: %w", err)
	}
	expiresAt := time.Now().Add(c.ttl)
	payload := confirmationPayload{
		UserID:    userID,
		Tool:      tool,
		Arguments: canonical,
		ExpiresAt: expiresAt.UnixNano(),
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("marshal confirmation payload: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)
	signature := c.sign(encoded)
	return encoded + "." + signature, expiresAt, nil
}

// Verify checks that token authorizes exactly this (userID, tool, arguments)
// triple and has not expired. Any failure -- bad signature, expired,
// mismatched user/tool, or changed arguments -- returns a non-nil error;
// callers must treat every error identically (fall back to proposing again),
// never branching behavior on which specific check failed.
func (c *Confirmer) Verify(token, userID, tool string, arguments json.RawMessage) error {
	encoded, signature, ok := strings.Cut(token, ".")
	if !ok || encoded == "" || signature == "" {
		return errors.New("malformed confirmation token")
	}
	expected := c.sign(encoded)
	// hmac.Equal requires equal-length byte slices to run in constant time;
	// mismatched lengths are simply not equal, so compare hex-decoded bytes
	// directly rather than pre-checking length ourselves.
	signatureBytes, err := hex.DecodeString(signature)
	if err != nil {
		return errors.New("malformed confirmation token signature")
	}
	expectedBytes, err := hex.DecodeString(expected)
	if err != nil {
		return fmt.Errorf("compute expected signature: %w", err)
	}
	if !hmac.Equal(signatureBytes, expectedBytes) {
		return errors.New("confirmation token signature is invalid")
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return errors.New("malformed confirmation token payload")
	}
	var payload confirmationPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return errors.New("malformed confirmation token payload")
	}
	if time.Now().UnixNano() > payload.ExpiresAt {
		return errors.New("confirmation token has expired")
	}
	if payload.UserID != userID || payload.Tool != tool {
		return errors.New("confirmation token does not match this request")
	}
	canonical, err := canonicalizeJSON(arguments)
	if err != nil {
		return fmt.Errorf("canonicalize arguments: %w", err)
	}
	if !bytes.Equal(payload.Arguments, canonical) {
		return errors.New("confirmation token arguments do not match")
	}
	return nil
}

func (c *Confirmer) sign(encoded string) string {
	mac := hmac.New(sha256.New, c.secret)
	mac.Write([]byte(encoded))
	return hex.EncodeToString(mac.Sum(nil))
}

// canonicalizeJSON produces a deterministic byte representation of arbitrary
// JSON: object keys sorted (Go's json.Marshal already sorts map[string]any
// keys), whitespace normalized. It decodes numbers with UseNumber so their
// original textual form round-trips exactly, avoiding any float64 precision
// risk for large amounts.
// confirmationTokenContextKey is unexported so no other package can collide
// with or forge this context value directly; only WithConfirmationToken can
// set it.
type confirmationTokenContextKey struct{}

// WithConfirmationToken attaches the confirmationToken from the incoming
// chat request (if any) to ctx. Mutation tool handlers read it back via
// ConfirmationTokenFromContext to decide whether THIS exact call has already
// been confirmed, or whether it must produce a fresh proposal instead.
func WithConfirmationToken(ctx context.Context, token string) context.Context {
	if token == "" {
		return ctx
	}
	return context.WithValue(ctx, confirmationTokenContextKey{}, token)
}

// ConfirmationTokenFromContext returns the token attached by
// WithConfirmationToken, or "" if the caller supplied none.
func ConfirmationTokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(confirmationTokenContextKey{}).(string)
	return token
}

func canonicalizeJSON(raw json.RawMessage) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode json: %w", err)
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal canonical json: %w", err)
	}
	return canonical, nil
}
