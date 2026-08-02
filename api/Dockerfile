# Multi-stage: the toolchain never ships.
#
# Alpine for the builder, and its musl libc is irrelevant here: CGO_ENABLED=0
# below produces a binary with no libc linkage at all, which is the same reason
# it can run on distroless/static. What alpine buys is a much smaller image to
# pull on a cold CI cache — the debian-based tag spent 12.5s extracting.
FROM golang:1.26-alpine AS build

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
