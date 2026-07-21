# syntax=docker/dockerfile:1

# Build stage: compiles a static binary. Pinned to the same Go version as
# .go-version/go.mod so local, CI, and container builds never drift.
FROM golang:1.26.5-bookworm AS builder

WORKDIR /src

# Cache modules separately from source so dependency-only changes don't bust
# the layer that recompiles application code.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 produces a static binary (pgx and jwx are pure Go, no cgo
# dependency) so it runs unmodified on the distroless runtime image below.
# Tests are not run here: CI (`make check-backend`) is the gate before a merge
# ever reaches an image build; the Dockerfile only compiles what already passed.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# Runtime stage: distroless has no shell, package manager, or extra binaries,
# which shrinks the attack surface for an internet-facing API. nonroot runs
# as uid 65532, satisfying the "no root in the container" requirement.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

WORKDIR /app
COPY --from=builder /out/api /app/api

# Supabase's pooler certificate chain roots in a self-signed CA that no OS
# trust store carries, so sslmode=verify-full needs it supplied explicitly via
# the DATABASE_URL sslrootcert param. See certs/README.md.
COPY certs/supabase-root-2021-ca.pem /app/certs/supabase-root-2021-ca.pem

USER nonroot:nonroot

# The platform (Vercel container-image Functions, Cloud Run, etc.) injects
# PORT; config.Load() already reads it via envOrDefault("PORT", "8080").
EXPOSE 8080

ENTRYPOINT ["/app/api"]
