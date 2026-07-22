package agent

import (
	"encoding/json"
	"testing"
	"time"
)

func testConfirmer(t *testing.T) *Confirmer {
	t.Helper()
	confirmer, err := NewConfirmer([]byte("a-test-secret-at-least-16-bytes"), time.Minute)
	if err != nil {
		t.Fatalf("new confirmer: %v", err)
	}
	return confirmer
}

func TestConfirmerIssueThenVerifySucceeds(t *testing.T) {
	confirmer := testConfirmer(t)
	args := json.RawMessage(`{"accountId":"acc-1","amountCents":10000}`)

	token, expiresAt, err := confirmer.Issue(testUser, "create_transaction", args)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if token == "" {
		t.Fatal("issue returned an empty token")
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt = %v, want a future time", expiresAt)
	}

	if err := confirmer.Verify(token, testUser, "create_transaction", args); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestConfirmerVerifyIgnoresArgumentKeyOrder(t *testing.T) {
	confirmer := testConfirmer(t)
	token, _, err := confirmer.Issue(testUser, "create_transaction", json.RawMessage(`{"a":1,"b":2}`))
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	// Same semantic arguments, different key order and whitespace.
	if err := confirmer.Verify(token, testUser, "create_transaction", json.RawMessage(`{"b": 2, "a": 1}`)); err != nil {
		t.Fatalf("verify with reordered keys: %v", err)
	}
}

func TestConfirmerVerifyRejectsChangedArguments(t *testing.T) {
	confirmer := testConfirmer(t)
	token, _, err := confirmer.Issue(testUser, "create_transaction", json.RawMessage(`{"amountCents":10000}`))
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := confirmer.Verify(token, testUser, "create_transaction", json.RawMessage(`{"amountCents":20000}`)); err == nil {
		t.Fatal("verify accepted a token whose arguments changed")
	}
}

func TestConfirmerVerifyRejectsWrongUser(t *testing.T) {
	confirmer := testConfirmer(t)
	args := json.RawMessage(`{"accountId":"acc-1"}`)
	token, _, err := confirmer.Issue(testUser, "create_transaction", args)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := confirmer.Verify(token, "someone-else", "create_transaction", args); err == nil {
		t.Fatal("verify accepted a token issued for a different user")
	}
}

func TestConfirmerVerifyRejectsWrongTool(t *testing.T) {
	confirmer := testConfirmer(t)
	args := json.RawMessage(`{"accountId":"acc-1"}`)
	token, _, err := confirmer.Issue(testUser, "create_transaction", args)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := confirmer.Verify(token, testUser, "delete_transaction", args); err == nil {
		t.Fatal("verify accepted a token issued for a different tool")
	}
}

func TestConfirmerVerifyRejectsExpiredToken(t *testing.T) {
	confirmer, err := NewConfirmer([]byte("a-test-secret-at-least-16-bytes"), time.Millisecond)
	if err != nil {
		t.Fatalf("new confirmer: %v", err)
	}
	args := json.RawMessage(`{"accountId":"acc-1"}`)
	token, _, err := confirmer.Issue(testUser, "create_transaction", args)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if err := confirmer.Verify(token, testUser, "create_transaction", args); err == nil {
		t.Fatal("verify accepted an expired token")
	}
}

func TestConfirmerVerifyRejectsTamperedSignature(t *testing.T) {
	confirmer := testConfirmer(t)
	args := json.RawMessage(`{"accountId":"acc-1"}`)
	token, _, err := confirmer.Issue(testUser, "create_transaction", args)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	tampered := token[:len(token)-1] + "0"
	if tampered == token {
		tampered = token[:len(token)-1] + "1"
	}
	if err := confirmer.Verify(tampered, testUser, "create_transaction", args); err == nil {
		t.Fatal("verify accepted a token with a tampered signature")
	}
}

func TestConfirmerVerifyRejectsMalformedTokens(t *testing.T) {
	confirmer := testConfirmer(t)
	args := json.RawMessage(`{"accountId":"acc-1"}`)
	for _, malformed := range []string{
		"",
		"no-dot-separator",
		"not-base64!!.deadbeef",
		"e30=.not-hex",
	} {
		if err := confirmer.Verify(malformed, testUser, "create_transaction", args); err == nil {
			t.Fatalf("verify accepted malformed token %q", malformed)
		}
	}
}

func TestNewConfirmerValidatesInputs(t *testing.T) {
	if _, err := NewConfirmer([]byte("too-short"), time.Minute); err == nil {
		t.Fatal("accepted a secret shorter than 16 bytes")
	}
	if _, err := NewConfirmer([]byte("a-test-secret-at-least-16-bytes"), 0); err == nil {
		t.Fatal("accepted a non-positive ttl")
	}
}
