// Package queues serves the two append-only submission endpoints.
//
// They share a package because they are the same shape: validate, append,
// return 202, touch nothing else. Neither mutates the graph.
//
// In particular POST /reviews does NOT promote a concept. The design handoff's
// DATA-MODEL.md says accepted reviews flip a node from frontier to verified;
// that describes the end of a human workflow, not this endpoint. Promotion
// happens by editing the node's JSON in a pull request and merging it — a
// runtime write to tier would make Firestore diverge from git, and git is the
// only writer of concept state. See ADR-0002.
package queues

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/store"
)

const (
	maxNameLen     = 120
	maxReferrerLen = 200
	maxNoteLen     = 2000
)

type Handler struct {
	store  store.Store
	budget *apihttp.WriteLimiter
}

func New(s store.Store, budget *apihttp.WriteLimiter) *Handler {
	return &Handler{store: s, budget: budget}
}

// accepted is the only success body either endpoint returns. 202 rather than
// 201: nothing has been created, and saying otherwise would promise a page that
// may never exist.
type accepted struct {
	Status string `json:"status"`
}

type conceptRequestBody struct {
	Name     string `json:"name"`
	Referrer string `json:"referrer"`
}

// CreateRequest serves POST /api/v1/requests — the 404 page's form.
func (h *Handler) CreateRequest(w http.ResponseWriter, r *http.Request) {
	var body conceptRequestBody
	if !apihttp.DecodeJSON(w, r, &body) {
		return
	}

	name := strings.TrimSpace(body.Name)
	if utf8.RuneCountInString(name) < 2 {
		apihttp.WriteFieldError(w, "name", "\"name\" must be at least 2 characters.")
		return
	}
	// Reject rather than truncate: silently storing half of what someone typed
	// is worse than telling them it was too long.
	if utf8.RuneCountInString(name) > maxNameLen {
		apihttp.WriteFieldError(w, "name", "\"name\" exceeds 120 characters.")
		return
	}
	if utf8.RuneCountInString(body.Referrer) > maxReferrerLen {
		apihttp.WriteFieldError(w, "referrer", "\"referrer\" exceeds 200 characters.")
		return
	}

	// Reserved only once the body is known good, so a rejected request costs
	// nothing — neither a budget slot nor a Firestore transaction.
	if h.budget.Reserve(w, r) {
		return
	}

	if err := h.store.EnqueueConceptRequest(r.Context(), store.ConceptRequest{
		Name:     name,
		Referrer: body.Referrer,
	}); err != nil {
		apihttp.WriteInternal(w, err, "queueing concept request")
		return
	}

	apihttp.NoStore(w)
	apihttp.WriteJSON(w, http.StatusAccepted, accepted{Status: "queued"})
}

type reviewBody struct {
	ConceptID string `json:"concept_id"`
	Kind      string `json:"kind"`
	Note      string `json:"note"`
}

// CreateReview serves POST /api/v1/reviews — the two frontier provenance
// actions. It records intent for a human; it never changes a tier.
func (h *Handler) CreateReview(w http.ResponseWriter, r *http.Request) {
	var body reviewBody
	if !apihttp.DecodeJSON(w, r, &body) {
		return
	}

	if !store.ValidConceptID(body.ConceptID) {
		apihttp.WriteFieldError(w, "concept_id",
			"\"concept_id\" must be a kebab-case slug.")
		return
	}
	kind := store.ReviewKind(body.Kind)
	if kind != store.ReviewFlag && kind != store.ReviewVolunteer {
		apihttp.WriteFieldError(w, "kind", "\"kind\" must be \"flag\" or \"volunteer\".")
		return
	}
	if utf8.RuneCountInString(body.Note) > maxNoteLen {
		apihttp.WriteFieldError(w, "note", "\"note\" exceeds 2000 characters.")
		return
	}

	if h.budget.Reserve(w, r) {
		return
	}

	err := h.store.EnqueueReview(r.Context(), store.ReviewSubmission{
		ConceptID: body.ConceptID,
		Kind:      kind,
		Note:      body.Note,
	})
	switch {
	case err == nil:
		apihttp.NoStore(w)
		apihttp.WriteJSON(w, http.StatusAccepted, accepted{Status: "queued"})
	case errors.Is(err, store.ErrNotFound):
		apihttp.WriteError(w, http.StatusNotFound, apihttp.CodeNotFound,
			"No concept with id \""+body.ConceptID+"\".")
	default:
		apihttp.WriteInternal(w, err, "queueing review")
	}
}
