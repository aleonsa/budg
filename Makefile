NPM := npm --prefix frontend
GITLEAKS ?= gitleaks
GO ?= go

.PHONY: check check-frontend check-backend check-security format format-check lint typecheck test test-coverage build migrate-dev-status migrate-dev-up migrate-prod-status migrate-prod-up

check: check-frontend check-backend check-security

check-frontend: format-check lint typecheck test-coverage build

check-backend:
	@cd backend && $(GO) mod download
	@cd backend && $(GO) mod verify
	@cd backend && files="$$(gofmt -l .)"; if [ -n "$$files" ]; then echo "gofmt found unformatted files:"; echo "$$files"; exit 1; fi
	@cd backend && $(GO) vet ./...
	@cd backend && $(GO) test -race -coverprofile=coverage.out -covermode=atomic ./...
	@cd backend && $(GO) build ./cmd/api
	@cd backend && export PATH="$$PATH:$$($(GO) env GOPATH)/bin"; \
		$(GO) install golang.org/x/vuln/cmd/govulncheck@v1.4.0; \
		govulncheck ./...

check-security:
	@$(GITLEAKS) git --redact --no-banner .
	@$(GITLEAKS) dir --redact --no-banner .
	@$(NPM) audit --audit-level=high

format:
	@$(NPM) run format

format-check:
	@$(NPM) run format:check

lint:
	@$(NPM) run lint

typecheck:
	@$(NPM) run typecheck

test:
	@$(NPM) run test

test-coverage:
	@$(NPM) run test:coverage

build:
	@$(NPM) run build

migrate-dev-status:
	@./backend/scripts/migrate.sh dev status

migrate-dev-up:
	@./backend/scripts/migrate.sh dev up

migrate-prod-status:
	@./backend/scripts/migrate.sh prod status

migrate-prod-up:
	@test "$(CONFIRM_PRODUCTION)" = "1" || (echo "Set CONFIRM_PRODUCTION=1 to migrate production" >&2; exit 2)
	@./backend/scripts/migrate.sh prod up --confirm-production
