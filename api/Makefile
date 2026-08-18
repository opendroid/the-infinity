# theinfinity.ai API.
SHELL := /bin/bash
IMAGE ?= us-west1-docker.pkg.dev/the-infinity-ai/containers/api
TAG   ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

NODES  ?= ../content/nodes
GOLDEN ?= ../content/derived.golden.json

QUEUE_LIMIT ?= 100

.PHONY: help run publish queues golden test test-emulator cover lint fmt tidy docker-build check
.DEFAULT_GOAL := help

help: ## List targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

run: ## Run locally on :8080 (needs GOOGLE_CLOUD_PROJECT and application-default credentials)
	go run ./cmd/server

publish: ## Sync /content/nodes to Firestore (needs GOOGLE_CLOUD_PROJECT and credentials)
	go run ./cmd/publish -nodes $(NODES)

# Read-only. Nothing else reads these two collections, so without this the
# provenance buttons queue submissions no one ever sees (#115).
queues: ## Print pending flags and concept requests (needs GOOGLE_CLOUD_PROJECT and credentials)
	go run ./cmd/queues -limit $(QUEUE_LIMIT)

golden: ## Regenerate the derivation fixture both /api and /web are checked against
	go run ./cmd/publish -nodes $(NODES) -out $(GOLDEN)

test: ## Table-driven tests, with the race detector
	go test -race ./...

# The round-trip tests in internal/publish skip without this, so `make test` on a
# laptop stays one command with no daemon to start. CI always runs them.
test-emulator: ## Tests including the Firestore round-trip suite
	@command -v gcloud >/dev/null || { echo "gcloud not found — CI downloads the emulator jar directly; see .github/workflows/ci.yml"; exit 1; }
	gcloud emulators firestore start --host-port=127.0.0.1:8081 & \
	  trap 'kill %1 2>/dev/null' EXIT; \
	  for i in $$(seq 1 60); do \
	    curl -sf -o /dev/null http://127.0.0.1:8081 && break; \
	    sleep 1; \
	  done; \
	  curl -sf -o /dev/null http://127.0.0.1:8081 || \
	    { echo "the emulator did not come up — is the cloud-firestore-emulator component installed, and is :8081 free?"; exit 1; }; \
	  FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 go test -race -count=1 ./...

# -coverpkg=./... so packages with no tests count as 0% rather than dropping out
# of the denominator — otherwise deleting a test raises the headline number.
# Needs a complete toolchain: a partial SDK without `covdata` fails here.
cover: ## Tests with a coverage summary across ALL packages
	go test -race -coverprofile=coverage.out -coverpkg=./... ./...
	go tool cover -func=coverage.out | tail -1

# THE VERSION IS PINNED IN ONE FILE AND CI READS THE SAME ONE (#263), so a local
# lint that passes cannot mean a different thing from the one that gates the merge.
GOLANGCI_VERSION := $(shell cat .golangci-version)
GOLANGCI_BARE    := $(GOLANGCI_VERSION:v%=%)
GOLANGCI_PLATFORM := $(shell go env GOOS)-$(shell go env GOARCH)
GOLANGCI_DIR     := golangci-lint-$(GOLANGCI_BARE)-$(GOLANGCI_PLATFORM)
GOLANGCI         := bin/golangci-lint
# Stamped with the version, so bumping .golangci-version renames the target and
# forces a refetch rather than silently reusing whatever is already in bin/.
GOLANGCI_STAMP   := bin/.golangci-$(GOLANGCI_BARE)

# A RELEASE BINARY, NOT `go install`. This looks like the fussier choice and is
# the load-bearing one: `go install` builds golangci-lint with whatever toolchain
# ITS go.mod selects, which lags the released binaries. At v2.12.2 that is
# go1.25.13, and a linter built with go1.25 refuses a module targeting go1.26 —
#
#   can't load config: the Go language version (go1.25) used to build
#   golangci-lint is lower than the targeted Go version (1.26.0)
#
# The published binary for the same version is built with go1.26.2 and runs
# clean. So the failure was never the pin being stale; it was the install method.
$(GOLANGCI_STAMP):
	@mkdir -p bin
	@rm -f $(GOLANGCI) bin/.golangci-*
	@echo "fetching golangci-lint $(GOLANGCI_VERSION) for $(GOLANGCI_PLATFORM)…"
	@curl -sSfL "https://github.com/golangci/golangci-lint/releases/download/$(GOLANGCI_VERSION)/$(GOLANGCI_DIR).tar.gz" \
		| tar xz -C bin --strip-components=1 "$(GOLANGCI_DIR)/golangci-lint" \
		|| { echo "could not fetch golangci-lint $(GOLANGCI_VERSION) for $(GOLANGCI_PLATFORM) — check the tag in .golangci-version"; exit 1; }
	@touch $@
	@$(GOLANGCI) --version

lint: $(GOLANGCI_STAMP) ## go vet, gofmt check, and the pinned golangci-lint
	go vet ./...
	@test -z "$$(gofmt -l . )" || { echo "gofmt needed:"; gofmt -l .; exit 1; }
	@$(GOLANGCI) run

fmt: ## Format
	gofmt -w .

tidy: ## Prune go.mod
	go mod tidy

docker-build: ## Multi-stage distroless nonroot image (amd64 — Cloud Run runs nothing else)
	docker build --platform linux/amd64 -t $(IMAGE):$(TAG) .

check: lint test ## What CI runs
