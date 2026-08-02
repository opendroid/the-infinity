# theinfinity.ai API.
SHELL := /bin/bash
IMAGE ?= us-west1-docker.pkg.dev/the-infinity-ai/containers/api
TAG   ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

.PHONY: help run test cover lint fmt tidy docker-build check
.DEFAULT_GOAL := help

help: ## List targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

run: ## Run locally on :8080 (needs GOOGLE_CLOUD_PROJECT and application-default credentials)
	go run ./cmd/server

test: ## Table-driven tests, with the race detector
	go test -race ./...

# -coverpkg=./... so packages with no tests count as 0% rather than dropping out
# of the denominator — otherwise deleting a test raises the headline number.
# Needs a complete toolchain: a partial SDK without `covdata` fails here.
cover: ## Tests with a coverage summary across ALL packages
	go test -race -coverprofile=coverage.out -coverpkg=./... ./...
	go tool cover -func=coverage.out | tail -1

lint: ## go vet, gofmt check, and golangci-lint if installed
	go vet ./...
	@test -z "$$(gofmt -l . )" || { echo "gofmt needed:"; gofmt -l .; exit 1; }
	@if command -v golangci-lint >/dev/null; then \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed — see https://golangci-lint.run/welcome/install/"; \
		exit 1; \
	fi

fmt: ## Format
	gofmt -w .

tidy: ## Prune go.mod
	go mod tidy

docker-build: ## Multi-stage distroless nonroot image (amd64 — Cloud Run runs nothing else)
	docker build --platform linux/amd64 -t $(IMAGE):$(TAG) .

check: lint test ## What CI runs
