// Command publish syncs /content/nodes to Firestore.
//
// It runs from deploy.yml on merge to main, and it is the only writer of the
// concepts collection. Firestore is downstream of git: to change a concept,
// change its JSON and open a pull request (ADR-0002).
//
//	cd api
//	go run ./cmd/publish -dry-run                 # derive and report, write nothing
//	go run ./cmd/publish -out ../content/derived.golden.json
//	go run ./cmd/publish -project the-infinity-ai # derive and write
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/publish"
)

// Bounded so a hung publish fails the deploy instead of holding a runner until
// GitHub's own timeout kills it with no useful output.
const publishTimeout = 5 * time.Minute

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("publish failed", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	var (
		nodesDir = flag.String("nodes", "../content/nodes", "directory of authored node JSON")
		project  = flag.String("project", os.Getenv("GOOGLE_CLOUD_PROJECT"), "GCP project id")
		dryRun   = flag.Bool("dry-run", false, "derive and report, but write nothing")
		out      = flag.String("out", "", "write the derived fixture to this path (implies -dry-run)")
	)
	flag.Parse()

	nodes, err := publish.Load(*nodesDir)
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		// Publishing an empty graph would delete every concept in Firestore. A
		// mistyped -nodes path should not be able to do that silently.
		return fmt.Errorf("no nodes found in %s", *nodesDir)
	}

	graph, err := publish.Derive(nodes, time.Now().UTC())
	if err != nil {
		return err
	}

	logger.Info("derived",
		slog.Int("concepts", len(graph.Concepts)),
		slog.Int("grew_this_week", graph.Stats.GrewThisWeek))

	if *out != "" {
		fixture, err := publish.Golden(graph)
		if err != nil {
			return err
		}
		if err := os.WriteFile(*out, fixture, 0o644); err != nil { //nolint:gosec // a fixture committed to a public repo
			return fmt.Errorf("writing %s: %w", *out, err)
		}
		logger.Info("wrote fixture", slog.String("path", *out))
		return nil
	}

	if *dryRun {
		return nil
	}

	if *project == "" {
		return errors.New("no project: pass -project or set GOOGLE_CLOUD_PROJECT")
	}

	ctx, cancel := context.WithTimeout(context.Background(), publishTimeout)
	defer cancel()

	client, err := firestore.NewClient(ctx, *project)
	if err != nil {
		return fmt.Errorf("connecting to firestore in %s: %w", *project, err)
	}
	defer func() {
		if err := client.Close(); err != nil {
			logger.Error("closing firestore client", slog.Any("error", err))
		}
	}()

	report, err := publish.Sync(ctx, client, graph)
	if err != nil {
		return err
	}

	logger.Info("published",
		slog.String("project", *project),
		slog.Int("concepts", report.Concepts),
		slog.Int("deleted", report.Deleted))
	return nil
}
