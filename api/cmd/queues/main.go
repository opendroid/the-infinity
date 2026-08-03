// Command queues prints the two submission queues for a maintainer.
//
// `POST /api/v1/reviews` and `POST /api/v1/requests` append to Firestore and
// nothing has ever read them back (#115). The provenance buttons promise a flag
// "joins the queue for a human to look at"; this is how the human looks.
//
//	cd api
//	make queues                                    # both queues, oldest first
//	go run ./cmd/queues -project the-infinity-ai
//	go run ./cmd/queues -limit 200
//
// It reads and never writes. There is no acknowledge flag: a flag is acted on
// by editing content/nodes/<id>.json in a pull request, and merging it is the
// acknowledgement (ADR-0002).
//
// Exit status is 0 when the queues were read, whether or not anything is in
// them — "empty" is an answer, not a failure.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/inbox"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// Bounded so a hung read fails with a deadline rather than sitting on a
// terminal indefinitely.
const readTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "queues: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		project = flag.String("project", os.Getenv("GOOGLE_CLOUD_PROJECT"), "GCP project id")
		limit   = flag.Int("limit", 100, "how many of the oldest submissions to read per queue")
	)
	flag.Parse()

	if *project == "" {
		return fmt.Errorf("no project: pass -project or set GOOGLE_CLOUD_PROJECT")
	}
	if *limit < 1 {
		return fmt.Errorf("-limit must be at least 1, got %d", *limit)
	}

	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	client, err := firestore.NewClient(ctx, *project)
	if err != nil {
		return fmt.Errorf("connecting to Firestore in %s: %w", *project, err)
	}
	defer func() {
		// Reported, not discarded — but it must not mask a real failure above,
		// so it goes to stderr rather than into the exit status.
		if cerr := client.Close(); cerr != nil {
			fmt.Fprintf(os.Stderr, "queues: closing the Firestore client: %v\n", cerr)
		}
	}()

	report, err := inbox.Collect(ctx, store.NewFirestore(client), *limit, time.Now().UTC())
	if err != nil {
		return err
	}
	return report.Render(os.Stdout)
}
