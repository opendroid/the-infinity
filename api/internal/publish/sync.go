package publish

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/store"
	"google.golang.org/api/iterator"
)

// Report is what a publish did, for the log line and for tests.
type Report struct {
	Concepts int
	// DeletedIDs names them, sorted. Deleted is len(DeletedIDs) and is kept
	// because callers were already logging the count.
	DeletedIDs []string
	Deleted    int
}

// Sync writes the whole graph and removes concepts git no longer has.
//
// A full re-sync every run, not a diff: a few hundred nodes is a few hundred
// writes — a fraction of a cent — and an incremental publish would need to know
// which documents changed, which is the same derivation problem again with a
// cache in front of it. The cache is where the bugs would live.
//
// Set, not Create or Update: publishing the same commit twice must leave
// identical documents, and Set replaces the whole document so a field removed
// from a node disappears from Firestore instead of lingering.
func Sync(ctx context.Context, client *firestore.Client, g *Graph) (Report, error) {
	concepts := client.Collection(store.CollConcepts)

	// Read the existing ids before writing: afterwards every id is current, and
	// there would be nothing left to identify as stale.
	existing, err := existingConceptIDs(ctx, concepts)
	if err != nil {
		return Report{}, err
	}

	bw := client.BulkWriter(ctx)
	jobs := make([]*firestore.BulkWriterJob, 0, 2*len(g.Concepts)+1)

	add := func(job *firestore.BulkWriterJob, err error) error {
		if err != nil {
			return err
		}
		jobs = append(jobs, job)
		return nil
	}

	for _, c := range g.Concepts {
		doc := concepts.Doc(c.ID)
		if err := add(bw.Set(doc, c)); err != nil {
			return Report{}, fmt.Errorf("queueing concept %s: %w", c.ID, err)
		}
		n := g.Neighborhoods[c.ID]
		if err := add(bw.Set(doc.Collection(store.SubNeighborhood).Doc(store.DocNeighborhood), n)); err != nil {
			return Report{}, fmt.Errorf("queueing neighborhood %s: %w", c.ID, err)
		}
		delete(existing, c.ID)
	}

	if err := add(bw.Set(client.Collection(store.CollCounters).Doc(store.DocStats), g.Stats)); err != nil {
		return Report{}, fmt.Errorf("queueing stats: %w", err)
	}

	// NAMED BEFORE THEY GO, not counted afterwards (#56). A count tells you
	// something was deleted and not what, and this is the one thing publish does
	// that is not additive — every other write is an upsert that can be redone by
	// running it again. It is also the operation that strands trail stops
	// (ADR-0012), so the ids are what someone would need to go looking.
	//
	// Sorted, because a map range is not stable and a deploy log that lists the
	// same two deletions in a different order every time is harder to diff than
	// one that does not.
	deleted := make([]string, 0, len(existing))
	for id := range existing {
		deleted = append(deleted, id)
	}
	slices.Sort(deleted)
	if len(deleted) > 0 {
		slog.Warn("deleting concepts absent from git",
			slog.Int("count", len(deleted)),
			slog.String("ids", strings.Join(deleted, ", ")))
	}

	// Deleting a document does not delete its subcollections, so the mini-map
	// goes explicitly. Left behind it would be an orphan nothing can reach and
	// nothing will clean up.
	for id := range existing {
		doc := concepts.Doc(id)
		if err := add(bw.Delete(doc.Collection(store.SubNeighborhood).Doc(store.DocNeighborhood))); err != nil {
			return Report{}, fmt.Errorf("queueing neighborhood delete %s: %w", id, err)
		}
		if err := add(bw.Delete(doc)); err != nil {
			return Report{}, fmt.Errorf("queueing concept delete %s: %w", id, err)
		}
	}

	bw.End()

	// End() flushes but does not report per-write failures. Without this loop a
	// publish that wrote nothing at all would exit 0.
	var failures []error
	for _, j := range jobs {
		if _, err := j.Results(); err != nil {
			failures = append(failures, err)
		}
	}
	if len(failures) > 0 {
		return Report{}, fmt.Errorf("%d write(s) failed: %w", len(failures), errors.Join(failures...))
	}

	return Report{Concepts: len(g.Concepts), Deleted: len(existing), DeletedIDs: deleted}, nil
}

// existingConceptIDs lists what is in Firestore now.
//
// DocumentRefs rather than a query: it also returns ids that exist only as a
// parent of a subcollection, which is exactly the orphan a previous incomplete
// delete would leave.
func existingConceptIDs(ctx context.Context, coll *firestore.CollectionRef) (map[string]bool, error) {
	ids := map[string]bool{}
	it := coll.DocumentRefs(ctx)
	for {
		ref, err := it.Next()
		if errors.Is(err, iterator.Done) {
			return ids, nil
		}
		if err != nil {
			return nil, fmt.Errorf("listing existing concepts: %w", err)
		}
		ids[ref.ID] = true
	}
}
