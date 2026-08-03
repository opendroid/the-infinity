package inbox_test

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/inbox"
	"github.com/opendroid/the-infinity/api/internal/store"
)

var now = time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)

func at(daysAgo int) time.Time { return now.Add(-time.Duration(daysAgo) * 24 * time.Hour) }

// fake is the whole Reader. It has no write method — which is the point: see
// TestTheReaderInterfaceCannotWrite.
type fake struct {
	reviews     []store.PendingReview
	requests    []store.PendingRequest
	reviewErr   error
	requestErr  error
	gotLimit    int
	readRequest bool
}

func (f *fake) PendingReviews(_ context.Context, limit int) ([]store.PendingReview, error) {
	f.gotLimit = limit
	return f.reviews, f.reviewErr
}

func (f *fake) PendingRequests(_ context.Context, _ int) ([]store.PendingRequest, error) {
	f.readRequest = true
	return f.requests, f.requestErr
}

func render(t *testing.T, r *inbox.Report) string {
	t.Helper()
	var b strings.Builder
	if err := r.Render(&b); err != nil {
		t.Fatalf("Render: %v", err)
	}
	return b.String()
}

func collect(t *testing.T, f *fake, limit int) *inbox.Report {
	t.Helper()
	r, err := inbox.Collect(context.Background(), f, limit, now)
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	return r
}

func TestAnEmptyQueueSaysSo(t *testing.T) {
	// Printing nothing is indistinguishable from a tool that failed to look,
	// which is the state this package exists to end.
	out := render(t, collect(t, &fake{}, 100))

	for _, want := range []string{
		"concept_reviews — nothing pending",
		"concept_requests — nothing pending",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("empty report is missing %q\ngot:\n%s", want, out)
		}
	}
}

func TestAReviewRowCarriesWhatItTakesToActOnIt(t *testing.T) {
	f := &fake{reviews: []store.PendingReview{{
		ID:        "abc123",
		ConceptID: "muon-optimizer",
		Kind:      store.ReviewFlag,
		Note:      "The Newton–Schulz coefficient does not match the cited paper.",
		CreatedAt: at(6),
	}}}
	out := render(t, collect(t, f, 100))

	tests := []struct {
		name string
		want string
	}{
		{"the concept", "muon-optimizer"},
		{"which action", "flag"},
		{"how long it has waited", "6 days"},
		{"the note, which is the content of a flag", "Newton–Schulz coefficient"},
		{"the file whose PR is the fix", "content/nodes/muon-optimizer.json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(out, tt.want) {
				t.Errorf("missing %q\ngot:\n%s", tt.want, out)
			}
		})
	}
}

func TestAgeIsRelativeBecauseThatIsTheActionableNumber(t *testing.T) {
	tests := []struct {
		name    string
		created time.Time
		want    string
	}{
		{"today", now.Add(-time.Hour), "today"},
		{"singular", at(1), "1 day"},
		{"plural", at(2), "2 days"},
		{"a month of being ignored", at(31), "31 days"},
		// A doc with a bad tag or a hand-written one decodes to the zero time.
		// Printing "year 1" as an age would be nonsense presented as data.
		{"undated", time.Time{}, "undated"},
		// Clock skew between the writer and this machine. Fall back to the
		// date rather than printing a negative age.
		{"from the future", now.Add(48 * time.Hour), "2026-08-05"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fake{reviews: []store.PendingReview{
				{ConceptID: "attention", Kind: store.ReviewVolunteer, CreatedAt: tt.created},
			}}
			if out := render(t, collect(t, f, 100)); !strings.Contains(out, tt.want) {
				t.Errorf("want age %q\ngot:\n%s", tt.want, out)
			}
		})
	}
}

func TestAMalformedConceptIDNeverPrintsAPath(t *testing.T) {
	// A path built from an unvalidated id is a copy-pasteable line that leads
	// nowhere at best. The handler validates on the way in, but a document
	// predating that validation must not produce one.
	for _, id := range []string{"../../etc/passwd", "Not A Slug", "", "a/b"} {
		f := &fake{reviews: []store.PendingReview{
			{ConceptID: id, Kind: store.ReviewFlag, Note: "x", CreatedAt: at(1)},
		}}
		out := render(t, collect(t, f, 100))
		if strings.Contains(out, "content/nodes/"+id) {
			t.Errorf("printed a path for a malformed id %q\ngot:\n%s", id, out)
		}
		if !strings.Contains(out, "not a valid concept id") {
			t.Errorf("did not flag malformed id %q\ngot:\n%s", id, out)
		}
	}
}

func TestAnEmptyNotePrintsNoOrphanedIndent(t *testing.T) {
	// "volunteer" carries no note by design; a blank indented line under it
	// would read as a note that failed to load.
	f := &fake{reviews: []store.PendingReview{
		{ConceptID: "attention", Kind: store.ReviewVolunteer, Note: "   \n  ", CreatedAt: at(1)},
	}}
	for _, line := range strings.Split(render(t, collect(t, f, 100)), "\n") {
		if line != "" && strings.TrimSpace(line) == "" {
			t.Errorf("blank indented line in:\n%s", render(t, collect(t, f, 100)))
		}
	}
}

func TestALongNoteIsNotTruncated(t *testing.T) {
	// 2000 runes is the server's cap. A report that elides the note makes you
	// open the console anyway, so it has saved nothing.
	long := strings.Repeat("particular ", 180)
	f := &fake{reviews: []store.PendingReview{
		{ConceptID: "attention", Kind: store.ReviewFlag, Note: long, CreatedAt: at(1)},
	}}
	out := render(t, collect(t, f, 100))
	if !strings.Contains(out, strings.TrimSpace(long)) {
		t.Error("the note was truncated")
	}
	if strings.Contains(out, "…") || strings.Contains(out, "...") {
		t.Errorf("the note was elided\ngot:\n%s", out)
	}
}

func TestAFullPageSaysThereMayBeMore(t *testing.T) {
	// A silent cap reads as "that is all of them" — the report would be lying
	// about the size of the backlog it exists to reveal.
	reviews := make([]store.PendingReview, 3)
	for i := range reviews {
		reviews[i] = store.PendingReview{ConceptID: "attention", Kind: store.ReviewFlag, CreatedAt: at(i)}
	}
	full := render(t, collect(t, &fake{reviews: reviews}, 3))
	if !strings.Contains(full, "there may be more") {
		t.Errorf("a full page did not say so\ngot:\n%s", full)
	}

	short := render(t, collect(t, &fake{reviews: reviews}, 10))
	if strings.Contains(short, "there may be more") {
		t.Errorf("a partial page claimed there may be more\ngot:\n%s", short)
	}
}

func TestARequestRowQuotesFreeTextAndKeepsTheReferrer(t *testing.T) {
	f := &fake{requests: []store.PendingRequest{
		{Name: `grouped "query" attention`, Referrer: "/c/multi-head-attention", CreatedAt: at(4)},
		{Name: "flash attention", CreatedAt: at(2)},
	}}
	out := render(t, collect(t, f, 100))

	// Quoted, so a name containing whitespace or a quote cannot be mistaken for
	// two columns or for a path.
	if !strings.Contains(out, `"grouped \"query\" attention"`) {
		t.Errorf("free text was not quoted\ngot:\n%s", out)
	}
	if !strings.Contains(out, "from /c/multi-head-attention") {
		t.Errorf("lost the referrer, which is where the reader hit the dead end\ngot:\n%s", out)
	}
	if strings.Contains(out, "from \n") {
		t.Errorf("printed an empty referrer\ngot:\n%s", out)
	}
}

func TestAFailedReadIsAnErrorNotAnEmptyQueue(t *testing.T) {
	// The dangerous failure is a report that looks like "nothing pending" when
	// the read failed — it would end the investigation instead of starting one.
	boom := errors.New("deadline exceeded")

	tests := []struct {
		name string
		f    *fake
	}{
		{"reviews fail", &fake{reviewErr: boom}},
		{"requests fail", &fake{requestErr: boom}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := inbox.Collect(context.Background(), tt.f, 10, now)
			if err == nil {
				t.Fatal("want an error, got a report")
			}
			if !errors.Is(err, boom) {
				t.Errorf("the cause was not wrapped: %v", err)
			}
		})
	}
}

func TestBothQueuesAreReadEvenWhenOneIsEmpty(t *testing.T) {
	// Reading only until something is found would hide the queue that has been
	// ignored longest.
	f := &fake{}
	collect(t, f, 42)
	if !f.readRequest {
		t.Error("the concept-request queue was never read")
	}
	if f.gotLimit != 42 {
		t.Errorf("limit not passed through: got %d, want 42", f.gotLimit)
	}
}

func TestPendingCountsBothQueues(t *testing.T) {
	f := &fake{
		reviews:  []store.PendingReview{{ConceptID: "attention", Kind: store.ReviewFlag}},
		requests: []store.PendingRequest{{Name: "a"}, {Name: "b"}},
	}
	if got := collect(t, f, 100).Pending(); got != 3 {
		t.Errorf("Pending() = %d, want 3", got)
	}
}

func TestTheReaderInterfaceCannotWrite(t *testing.T) {
	// The guarantee the issue asks for — "it never writes to concepts" — is
	// structural, not behavioural: Reader exposes two reads and nothing else,
	// so a write is unrepresentable rather than merely absent. This test fails
	// the moment someone widens the interface, which is when the guarantee
	// would quietly stop holding.
	rt := reflect.TypeOf((*inbox.Reader)(nil)).Elem()

	var got []string
	for i := range rt.NumMethod() {
		got = append(got, rt.Method(i).Name)
	}
	want := []string{"PendingRequests", "PendingReviews"} // reflect sorts them

	if !reflect.DeepEqual(got, want) {
		t.Errorf("inbox.Reader methods = %v, want exactly %v", got, want)
	}
}

func TestRenderIsAllOrNothing(t *testing.T) {
	// A broken pipe part-way through must not leave half a queue on screen
	// looking like the whole of it.
	f := &fake{reviews: []store.PendingReview{
		{ConceptID: "attention", Kind: store.ReviewFlag, Note: "x", CreatedAt: at(1)},
	}}
	w := &failWriter{}
	err := collect(t, f, 100).Render(w)
	if err == nil {
		t.Fatal("want an error from a failing writer")
	}
	if w.calls != 1 {
		t.Errorf("wrote in %d calls, want 1 so a failure cannot be partial", w.calls)
	}
}

type failWriter struct{ calls int }

func (f *failWriter) Write(p []byte) (int, error) {
	f.calls++
	return 0, errors.New("broken pipe")
}
