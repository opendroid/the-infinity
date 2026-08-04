// Command server is the theinfinity.ai API.
//
// It serves /api/v1/** and /-/health. Routes mount at /api/v1 because Firebase
// Hosting rewrites /api/** to Cloud Run preserving the full path — see ADR-0001
// and internal/router.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/ratelimit"
	"github.com/opendroid/the-infinity/api/internal/router"
	"github.com/opendroid/the-infinity/api/internal/store"
)

const (
	defaultPort  = "8080"
	readTimeout  = 5 * time.Second
	writeTimeout = 15 * time.Second
	idleTimeout  = 60 * time.Second
	// Longer than apihttp's request timeout: a request that starts just before
	// SIGTERM runs its full deadline, and Shutdown must outlast it or a clean
	// scale-down returns DeadlineExceeded and is logged as a crash.
	shutdownTimeout = 15 * time.Second
	dialTimeout     = 15 * time.Second
)

func main() {
	// Cloud Run parses structured JSON on stdout into log fields; a plain-text
	// line arrives as an unparsed blob. Set the default too, so a handler
	// reaching for the package-level slog still emits JSON.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("server exited with error", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	port := envOr("PORT", defaultPort)

	// A missing project id would otherwise surface as a 500 on the first
	// request rather than a failure to start, which is much harder to notice.
	projectID := envOr("GOOGLE_CLOUD_PROJECT", "")
	if projectID == "" {
		return errors.New("GOOGLE_CLOUD_PROJECT is not set")
	}

	// Parented on Background, not the signal context: cancelling the client's
	// context the instant SIGTERM arrives would break in-flight requests that
	// Shutdown is still draining.
	dialCtx, cancelDial := context.WithTimeout(context.Background(), dialTimeout)
	defer cancelDial()

	client, err := firestore.NewClient(dialCtx, projectID)
	if err != nil {
		return fmt.Errorf("connecting to firestore in %s: %w", projectID, err)
	}
	defer func() {
		if err := client.Close(); err != nil {
			logger.Error("closing firestore client", slog.Any("error", err))
		}
	}()

	dailyCap := int64OrDefault("DAILY_WRITE_CAP", apihttp.DefaultDailyWriteCap)
	// Reads and writes are shaped separately: a read is something a visitor's
	// browser does on their behalf, a write is something they chose to do.
	writeLimit := ratelimit.DefaultConfig()
	writeLimit.PerMinute = floatOrDefault("RATE_LIMIT_PER_MINUTE", writeLimit.PerMinute)

	readLimit := ratelimit.DefaultReadConfig()
	readLimit.PerMinute = floatOrDefault("READ_RATE_LIMIT_PER_MINUTE", readLimit.PerMinute)

	// Zero is a legitimate value here — it means "trust the last entry", which is
	// correct when nothing fronts the service — so this cannot use the
	// positive-only helpers above.
	hops := hopsOrDefault("TRUSTED_PROXY_HOPS", ratelimit.DefaultTrustedProxyHops)
	writeLimit.TrustedProxyHops = hops
	readLimit.TrustedProxyHops = hops

	handler := router.New(store.NewFirestore(client), router.Options{
		ReadLimit:  readLimit,
		WriteLimit: writeLimit,
		DailyCap:   dailyCap,
		// Already validated non-empty above, so correlation is on in production
		// and off in any test that does not ask for it.
		ProjectID: projectID,
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening",
			slog.String("addr", srv.Addr),
			slog.String("project", projectID),
			slog.Int64("daily_write_cap", dailyCap))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("listening on %s: %w", srv.Addr, err)
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutting down server: %w", err)
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func int64OrDefault(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		slog.Warn("ignoring invalid value", slog.String("key", key), slog.String("value", v))
		return fallback
	}
	return n
}

// hopsOrDefault parses a non-negative count. Unlike the other helpers, zero is
// meaningful rather than missing: it says the last X-Forwarded-For entry is the
// caller, which is true for a service nothing fronts.
func hopsOrDefault(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		slog.Warn("ignoring invalid value", slog.String("key", key), slog.String("value", v))
		return fallback
	}
	return n
}

func floatOrDefault(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil || n <= 0 {
		slog.Warn("ignoring invalid value", slog.String("key", key), slog.String("value", v))
		return fallback
	}
	return n
}
