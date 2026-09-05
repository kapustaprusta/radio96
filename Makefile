GO ?= go
BINARY ?= bin/radio96
GOLANGCI_LINT ?= bin/golangci-lint
GOLANGCI_LINT_VERSION ?= v2.13.0
GOLANGCI_LINT_VERSION_NUMBER := $(patsubst v%,%,$(GOLANGCI_LINT_VERSION))
SQLC ?= bin/sqlc
SQLC_VERSION ?= v1.31.1
DOCKER_COMPOSE ?= docker compose
COMPOSE_FILE ?= deploy/compose.yaml
COMPOSE_PROJECT_NAME ?= radio96
HTTP_PORT ?= 8080
PACKAGES := ./...

ifneq (,$(wildcard .env))
include .env
export
endif

.DEFAULT_GOAL := help

.PHONY: help run build test test-race test-cover fmt fmt-check vet lint lint-fix generate sqlc-check tools ensure-golangci-lint ensure-sqlc tidy check ci clean
.PHONY: docker-up docker-down docker-logs docker-ps docker-db

COMPOSE = $(DOCKER_COMPOSE) --project-directory $(CURDIR) \
	--project-name $(COMPOSE_PROJECT_NAME) --file $(COMPOSE_FILE)

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} \
	/^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

run: ## Run the application
	$(GO) run ./cmd/radio96

build: ## Build the application binary
	mkdir -p $(dir $(BINARY))
	$(GO) build -o $(BINARY) ./cmd/radio96

docker-up: ## Build and start the local container environment
	$(COMPOSE) up --build --detach --wait
	@echo "radio96 is available at http://localhost:$(HTTP_PORT)"

docker-db: ## Start PostgreSQL and apply migrations for local Go development
	$(COMPOSE) up --detach --wait postgres
	$(COMPOSE) run --rm migrate

docker-down: ## Stop the local container environment
	$(COMPOSE) down

docker-logs: ## Follow application logs
	$(COMPOSE) logs --follow app

docker-ps: ## Show local container status
	$(COMPOSE) ps

test: ## Run unit tests
	$(GO) test $(PACKAGES)

test-race: ## Run tests with the race detector
	$(GO) test -race $(PACKAGES)

test-cover: ## Run tests and write coverage.out
	$(GO) test -coverprofile=coverage.out $(PACKAGES)

fmt: ## Format Go code
	$(GO) fmt $(PACKAGES)

fmt-check: ## Verify that Go code is formatted
	@gofmt="$$("$(GO)" env GOROOT)/bin/gofmt"; \
	if [ ! -x "$$gofmt" ]; then \
		echo "gofmt is not available: $$gofmt"; \
		exit 1; \
	fi; \
	unformatted="$$($$gofmt -l $$(find . -type f -name '*.go' -not -path './vendor/*' -not -path '*/node_modules/*'))"; \
	if [ -n "$$unformatted" ]; then \
		echo "Unformatted files:"; \
		echo "$$unformatted"; \
		exit 1; \
	fi

vet: ## Run go vet
	$(GO) vet $(PACKAGES)

lint: ensure-golangci-lint ## Run golangci-lint
	PATH="$$($(GO) env GOROOT)/bin:$$PATH" $(GOLANGCI_LINT) run $(PACKAGES)

lint-fix: ensure-golangci-lint ## Fix golangci-lint issues where possible
	PATH="$$($(GO) env GOROOT)/bin:$$PATH" $(GOLANGCI_LINT) run --fix $(PACKAGES)

generate: ensure-sqlc ## Generate Go database code
	$(SQLC) generate

sqlc-check: ensure-sqlc ## Verify generated database code is up to date
	$(SQLC) generate
	git diff --exit-code -- internal/postgres/dbgen

tools: ensure-golangci-lint ensure-sqlc ## Install development tools

ensure-golangci-lint:
	@installed_version=""; \
	if [ -x "$(GOLANGCI_LINT)" ]; then \
		installed_version="$$($(GOLANGCI_LINT) version 2>/dev/null | awk '{print $$4}')"; \
	fi; \
	if [ "$$installed_version" != "$(GOLANGCI_LINT_VERSION_NUMBER)" ]; then \
		echo "Installing golangci-lint $(GOLANGCI_LINT_VERSION)"; \
		mkdir -p $(dir $(GOLANGCI_LINT)); \
		GOBIN=$(CURDIR)/$(dir $(GOLANGCI_LINT)) $(GO) install \
			github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION); \
	fi

ensure-sqlc:
	@installed_version=""; \
	if [ -x "$(SQLC)" ]; then \
		installed_version="$$($(SQLC) version 2>/dev/null)"; \
	fi; \
	if [ "$$installed_version" != "$(SQLC_VERSION)" ]; then \
		echo "Installing sqlc $(SQLC_VERSION)"; \
		mkdir -p $(dir $(SQLC)); \
		GOBIN=$(CURDIR)/$(dir $(SQLC)) $(GO) install \
			github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION); \
	fi

tidy: ## Update go.mod and go.sum
	$(GO) mod tidy

check: fmt-check sqlc-check lint test ## Run fast local checks

ci: fmt-check sqlc-check lint test-race ## Run all CI checks

clean: ## Remove build and test artifacts
	$(GO) clean
	$(RM) $(BINARY) coverage.out
