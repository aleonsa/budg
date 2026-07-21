package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

// stubCategoryStore is an in-memory CategoryStore for handler tests.
type stubCategoryStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.Category
	createInput  store.CategoryInput
	updateID     string
	updatePatch  store.CategoryPatch
	deleteID     string
	createResult store.Category
	updateResult store.Category
}

func (s *stubCategoryStore) List(_ context.Context, _ string) ([]store.Category, error) {
	return s.listResult, s.listErr
}

func (s *stubCategoryStore) Create(_ context.Context, _ string, in store.CategoryInput) (store.Category, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubCategoryStore) Update(_ context.Context, _, id string, patch store.CategoryPatch) (store.Category, error) {
	s.updateID = id
	s.updatePatch = patch
	return s.updateResult, s.updateErr
}

func (s *stubCategoryStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newCategoriesRouter(stub CategoryStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Categories:     stub,
	})
}

// Alias so we don't leak the unexported interface into the public API.
type CategoryStoreForTest = httpapi.CategoryStore

func doRequest(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestListCategoriesReturnsData(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{
		listResult: []store.Category{
			{ID: "cat-1", UserID: "user-1", Name: "Food", Kind: "expense", Color: "blue", Icon: "Utensils", SortOrder: 1},
			{ID: "cat-2", UserID: "user-1", Name: "Salary", Kind: "income", Color: "green", Icon: "Wallet", SortOrder: 0},
		},
	}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/categories", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.Category `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("len(data) = %d, want 2", len(body.Data))
	}
	if body.Data[0].ID != "cat-1" || body.Data[1].ID != "cat-2" {
		t.Fatalf("data ids = %v, want [cat-1, cat-2]", []string{body.Data[0].ID, body.Data[1].ID})
	}
}

func TestListCategoriesReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{listErr: errors.New("connection lost")}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/categories", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateCategoryPersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{
		createResult: store.Category{
			ID: "cat-new", UserID: "user-1", Name: "Food", Kind: "expense",
			Color: "blue", Icon: "Utensils", SortOrder: 3,
		},
	}
	router := newCategoriesRouter(stub)

	body := `{"name":"Food","kind":"expense","color":"blue","icon":"Utensils","order":3}`
	rec := doRequest(router, http.MethodPost, "/v1/categories", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Name != "Food" || stub.createInput.Kind != "expense" {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
	var got store.Category
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.ID != "cat-new" {
		t.Fatalf("id = %q, want cat-new", got.ID)
	}
}

func TestCreateCategoryRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{}
	router := newCategoriesRouter(stub)

	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"name":`},
		{"missing name", `{"kind":"expense","color":"blue","icon":"X"}`},
		{"bad kind", `{"name":"Food","kind":"savings","color":"blue","icon":"X"}`},
		{"missing icon", `{"name":"Food","kind":"expense","color":"blue"}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := doRequest(router, http.MethodPost, "/v1/categories", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestUpdateCategoryAppliesPatchAndReturnsUpdated(t *testing.T) {
	t.Parallel()
	parent := "cat-parent"
	stub := &stubCategoryStore{
		updateResult: store.Category{ID: "cat-1", Name: "Renamed"},
	}
	router := newCategoriesRouter(stub)

	body := `{"name":"Renamed","parentId":"cat-parent"}`
	rec := doRequest(router, http.MethodPatch, "/v1/categories/cat-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "cat-1" {
		t.Fatalf("captured id = %q, want cat-1", stub.updateID)
	}
	if stub.updatePatch.Name == nil || *stub.updatePatch.Name != "Renamed" {
		t.Fatalf("captured name patch = %+v", stub.updatePatch.Name)
	}
	if !stub.updatePatch.ParentID.Set || stub.updatePatch.ParentID.Value == nil || *stub.updatePatch.ParentID.Value != parent {
		t.Fatalf("captured parent patch = %+v", stub.updatePatch.ParentID)
	}
}

// TestUpdateCategoryClearsParentExplicitly proves Field[string] actually
// distinguishes "parentId omitted" from "parentId: null" -- a plain double
// pointer (**string) cannot make this distinction with encoding/json (both
// cases decode to a nil outer pointer), which was a real, silent bug: PATCH
// {"parentId": null} used to be indistinguishable from an empty body.
func TestUpdateCategoryClearsParentExplicitly(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{updateResult: store.Category{ID: "cat-1"}}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/categories/cat-1", `{"parentId":null}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !stub.updatePatch.ParentID.Set {
		t.Fatal("parentId patch presence not captured, want Set=true for explicit null")
	}
	if stub.updatePatch.ParentID.Value != nil {
		t.Fatalf("parentId value = %v, want nil (explicit clear)", *stub.updatePatch.ParentID.Value)
	}
}

// TestUpdateCategoryOmittedParentIDLeavesItUnset proves the other half of
// the distinction: a body that never mentions parentId must leave Set
// false, so the repository knows to leave the column untouched.
func TestUpdateCategoryOmittedParentIDLeavesItUnset(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{updateResult: store.Category{ID: "cat-1"}}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/categories/cat-1", `{"name":"Renamed"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updatePatch.ParentID.Set {
		t.Fatalf("parentId patch = %+v, want Set=false when omitted", stub.updatePatch.ParentID)
	}
}

func TestUpdateCategoryReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{updateErr: store.ErrNotFound}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/categories/missing", `{"name":"X"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteCategoryReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/categories/cat-1", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "cat-1" {
		t.Fatalf("captured id = %q, want cat-1", stub.deleteID)
	}
}

func TestDeleteCategoryReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{deleteErr: store.ErrNotFound}
	router := newCategoriesRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/categories/missing", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestCategoriesRejectUnauthenticatedRequests(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{}
	// No auth middleware wired.
	router := httpapi.NewRouter(httpapi.Options{
		Database:   readyDatabase(),
		Categories: stub,
	})

	rec := doRequest(router, http.MethodGet, "/v1/categories", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// Smoke test that the authenticated request body reaches the handler exactly
// as sent (no field dropping or normalization).
func TestCreateCategoryPreservesExactBody(t *testing.T) {
	t.Parallel()
	stub := &stubCategoryStore{
		createResult: store.Category{ID: "cat-x"},
	}
	router := newCategoriesRouter(stub)

	raw := `{"name":"Pets","kind":"expense","color":"orange","icon":"PawPrint","parentId":null,"order":5}`
	req := httptest.NewRequest(http.MethodPost, "/v1/categories", bytes.NewReader([]byte(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	if stub.createInput.Name != "Pets" || stub.createInput.Kind != "expense" ||
		stub.createInput.Color != "orange" || stub.createInput.Icon != "PawPrint" ||
		stub.createInput.SortOrder != 5 {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
}
