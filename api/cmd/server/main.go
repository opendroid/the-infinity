// Command server is the theinfinity.ai API service.
//
// This is a Phase 0 stub: it serves /healthz and nothing else, so the Cloud Run
// deployment path can be proven end-to-end before any real handler exists. The
// v1 surface (concepts, neighborhood, search, trails, requests) lands in Phase 3
// on a chi router generated from /docs/openapi.yaml.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const (
	defaultPort     = "8080"
	readTimeout     = 5 * time.Second
	writeTimeout    = 10 * time.Second
	idleTimeout     = 60 * time.Second
	shutdownTimeout = 10 * time.Second
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("server exited with error", slog.Any("error", err))
		os.Exit(1)
	}
}

// run wires up and serves the HTTP server, blocking until the process receives
// SIGINT or SIGTERM (Cloud Run sends SIGTERM before reclaiming an instance).
func run(logger *slog.Logger) error {
	// Cloud Run injects PORT; default for local runs.
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", slog.String("addr", srv.Addr))
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

// healthz reports liveness. It intentionally does not check Firestore: this
// endpoint answers "is the process up", not "is the whole system well".
func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write([]byte(`{"status":"ok"}`)); err != nil {
		slog.Error("writing healthz response", slog.Any("error", err))
	}
}
