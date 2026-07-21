package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
)

type pingFunc func(context.Context) error

func (f pingFunc) Ping(ctx context.Context) error {
	return f(ctx)
}

func readyDatabase() pingFunc {
	return func(context.Context) error { return nil }
}

func TestHealthz(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(httpapi.NewRouter(readyDatabase()))
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("request /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	if got, want := resp.Header.Get("Content-Type"), "application/json"; got != want {
		t.Fatalf("content-type = %q, want %q", got, want)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status field = %q, want %q", body.Status, "ok")
	}
}

func TestHealthzRejectsPost(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(httpapi.NewRouter(readyDatabase()))
	defer srv.Close()

	resp, err := srv.Client().Post(srv.URL+"/healthz", "application/json", nil)
	if err != nil {
		t.Fatalf("post /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
	if got, want := resp.Header.Get("Allow"), http.MethodGet; got != want {
		t.Fatalf("allow header = %q, want %q", got, want)
	}
}

func TestUnknownRoute(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(httpapi.NewRouter(readyDatabase()))
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/does-not-exist")
	if err != nil {
		t.Fatalf("request unknown route: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestReadyz(t *testing.T) {
	t.Parallel()

	deadlineSeen := make(chan bool, 1)
	database := pingFunc(func(ctx context.Context) error {
		_, ok := ctx.Deadline()
		deadlineSeen <- ok
		return nil
	})
	srv := httptest.NewServer(httpapi.NewRouter(database))
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/readyz")
	if err != nil {
		t.Fatalf("request /readyz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if got := resp.Header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type = %q, want application/json", got)
	}
	if !<-deadlineSeen {
		t.Fatal("database ping context has no deadline")
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status field = %q, want ok", body.Status)
	}
}

func TestReadyzReturnsGenericUnavailableError(t *testing.T) {
	t.Parallel()

	database := pingFunc(func(context.Context) error { return errors.New("secret database detail") })
	srv := httptest.NewServer(httpapi.NewRouter(database))
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/readyz")
	if err != nil {
		t.Fatalf("request /readyz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
	}

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Error.Code != "service_unavailable" {
		t.Fatalf("error code = %q, want service_unavailable", body.Error.Code)
	}
	if body.Error.Message != "database is unavailable" {
		t.Fatalf("error message = %q, want generic message", body.Error.Message)
	}
}

func TestReadyzRejectsPost(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(httpapi.NewRouter(readyDatabase()))
	defer srv.Close()

	resp, err := srv.Client().Post(srv.URL+"/readyz", "application/json", nil)
	if err != nil {
		t.Fatalf("post /readyz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
	if got := resp.Header.Get("Allow"); got != http.MethodGet {
		t.Fatalf("allow header = %q, want GET", got)
	}
}
