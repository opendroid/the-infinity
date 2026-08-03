# Multi-stage: the toolchain never ships.
#
# Alpine for the builder, and its musl libc is irrelevant here: CGO_ENABLED=0
# below produces a binary with no libc linkage at all, which is the same reason
# it can run on distroless/static. What alpine buys is a much smaller image to
# pull on a cold CI cache — the debian-based tag spent 12.5s extracting.
#
# PULLED THROUGH mirror.gcr.io, NOT DOCKER HUB. Both stages now come from
# Google's registries, so an image build depends on one host instead of two.
# Docker Hub was the one that failed: on #116 the api job died with
#
#   golang:1.26-alpine: dial tcp 100.61.215.205:443: i/o timeout
#
# while `gcr.io/distroless/...` in the same build resolved in 1.1s. A re-run of
# the identical commit passed, so it was a blip — but deploy.yml runs this same
# build AFTER cmd/publish has already synced content to Firestore, so a blip
# there leaves the database ahead of the deployed API. See #117.
#
# mirror.gcr.io is a pull-through cache of Docker Hub, so this is the same
# image: at the time of the change both registries reported
# sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 for
# this tag. It can in principle lag on a freshly-moved tag.
FROM mirror.gcr.io/library/golang:1.26-alpine AS build

WORKDIR /src

# Copied first so a source-only change reuses the cached module layer.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO off so the binary is fully static and can run on distroless/static.
# Stripping symbols and trimming paths keeps the image small and the build
# reproducible across machines.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
      -trimpath -ldflags="-s -w" \
      -o /out/server ./cmd/server

# distroless/static: no shell, no package manager, no libc. Nothing to exec into
# if the process is ever compromised.
FROM gcr.io/distroless/static-debian12:nonroot

# Runs as uid 65532. Cloud Run does not require root, and nothing here writes
# to the filesystem.
USER nonroot:nonroot

COPY --from=build /out/server /server

# Documentation only — Cloud Run injects PORT and the server reads it.
EXPOSE 8080

ENTRYPOINT ["/server"]
