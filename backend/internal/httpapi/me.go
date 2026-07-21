package httpapi

import (
	"net/http"

	"github.com/aleonsa/budg/backend/internal/auth"
)

type meResponse struct {
	UserID        string `json:"userId"`
	Email         string `json:"email,omitempty"`
	Authenticated bool   `json:"authenticated"`
}

// meHandler returns the verified identity for the caller. It reads the user
// only from the request context populated by the auth middleware; it never
// trusts a client-supplied identifier.
type meHandler struct{}

func (h *meHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}

	writeJSON(w, http.StatusOK, meResponse{
		UserID:        user.ID,
		Email:         user.Email,
		Authenticated: true,
	})
}
