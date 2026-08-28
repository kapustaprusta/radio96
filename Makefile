GO ?= go
BINARY ?= bin/radio96
GOLANGCI_LINT ?= bin/golangci-lint
GOLANGCI_LINT_VERSION ?= v2.12.2
PACKAGES := ./...

ifneq (,$(wildcard .env))
include .env
export
endif

.DEFAULT_GOAL := help

.PHONY: help run build test test-race test-cover fmt fmt-check vet lint lint-fix tools tidy check ci clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} \
	/^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

run: ## Run the application
	$(GO) run ./cmd/radio96

build: ## Build the application binary
	mkdir -p $(dir $(BINARY))
	$(GO) build -o $(BINARY) ./cmd/radio96

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
	unformatted="$$($$gofmt -l $$(find . -type f -name '*.go' -not -path './vendor/*'))"; \
	if [ -n "$$unformatted" ]; then \
		echo "Unformatted files:"; \
		echo "$$unformatted"; \
		exit 1; \
	fi

vet: ## Run go vet
	$(GO) vet $(PACKAGES)

lint: $(GOLANGCI_LINT) ## Run golangci-lint
	PATH="$$($(GO) env GOROOT)/bin:$$PATH" $(GOLANGCI_LINT) run $(PACKAGES)

lint-fix: $(GOLANGCI_LINT) ## Fix golangci-lint issues where possible
	PATH="$$($(GO) env GOROOT)/bin:$$PATH" $(GOLANGCI_LINT) run --fix $(PACKAGES)

tools: $(GOLANGCI_LINT) ## Install development tools

$(GOLANGCI_LINT):
	mkdir -p $(dir $(GOLANGCI_LINT))
	GOBIN=$(CURDIR)/$(dir $(GOLANGCI_LINT)) $(GO) install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)

tidy: ## Update go.mod and go.sum
	$(GO) mod tidy

check: fmt-check lint test ## Run fast local checks

ci: fmt-check lint test-race ## Run all CI checks

clean: ## Remove build and test artifacts
	$(GO) clean
	$(RM) $(BINARY) coverage.out
