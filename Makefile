NPM := npm --prefix frontend
GITLEAKS ?= gitleaks

.PHONY: check check-frontend check-backend check-security format format-check lint typecheck test test-coverage build

check: check-frontend check-backend check-security

check-frontend: format-check lint typecheck test-coverage build

check-backend:
	@./scripts/check-backend-phase0.sh

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
