package httpapi

import (
	"net/http"
	"slices"
)

// newCORS returns middleware that allows the configured browser origins to send
// credentialed API requests. It echoes only exact-match origins so it never
// reflects an arbitrary Origin header, and it answers preflight requests before
// they reach handlers. CORS is not authentication; every /v1 route still
// requires a valid bearer token.
func newCORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := slices.Clone(allowedOrigins)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && slices.Contains(allowed, origin) {
				h := w.Header()
				h.Add("Vary", "Origin")
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
				h.Set("Access-Control-Max-Age", "600")
			}

			if r.Method == http.MethodOptions && origin != "" {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
