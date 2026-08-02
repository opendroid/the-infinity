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
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/store"
)

const (
	maxNameLen     = 120
	maxReferrerLen = 200
	maxNoteLen     = 2000
)

type Handler struct {
	store store.Store
}

func New(s store.Store) *Handler { return &Handler{store: s} }

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
	if !decodeJSON(w, r, &body) {
		return
	}

	name := strings.TrimSpace(body.Name)
	if len(name) < 2 {
		apihttp.WriteFieldError(w, "name", "\"name\" must be at least 2 characters.")
		return
	}
	// Reject rather than truncate: silently storing half of what someone typed
	// is worse than telling them it was too long.
	if len(name) > maxNameLen {
		apihttp.WriteFieldError(w, "name", "\"name\" exceeds 120 characters.")
		return
	}
	if len(body.Referrer) > maxReferrerLen {
		apihttp.WriteFieldError(w, "referrer", "\"referrer\" exceeds 200 characters.")
		return
	}

	if err := h.store.EnqueueConceptRequest(r.Context(), store.ConceptRequest{
		Name:     name,
		Referrer: body.Referrer,
	}); err != nil {
		apihttp.WriteInternal(w, err, "queueing concept request")
		return
	}

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
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.ConceptID == "" {
		apihttp.WriteFieldError(w, "concept_id", "\"concept_id\" is required.")
		return
	}
	kind := store.ReviewKind(body.Kind)
	if kind != store.ReviewFlag && kind != store.ReviewVolunteer {
		apihttp.WriteFieldError(w, "kind", "\"kind\" must be \"flag\" or \"volunteer\".")
		return
	}
	if len(body.Note) > maxNoteLen {
		apihttp.WriteFieldError(w, "note", "\"note\" exceeds 2000 characters.")
		return
	}

	err := h.store.EnqueueReview(r.Context(), store.ReviewSubmission{
		ConceptID: body.ConceptID,
		Kind:      kind,
		Note:      body.Note,
	})
	switch {
	case err == nil:
		apihttp.WriteJSON(w, http.StatusAccepted, accepted{Status: "queued"})
	case errors.Is(err, store.ErrNotFound):
		apihttp.WriteError(w, http.StatusNotFound, apihttp.CodeNotFound,
			"No concept with id \""+body.ConceptID+"\".")
	default:
		apihttp.WriteInternal(w, err, "queueing review")
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			apihttp.WriteError(w, http.StatusRequestEntityTooLarge,
				apihttp.CodePayloadTooLarge, "Request body exceeds 16 KiB.")
			return false
		}
		apihttp.WriteError(w, http.StatusBadRequest, apihttp.CodeInvalidRequest,
			"Request body is not valid JSON for this endpoint.")
		return false
	}
	return true
}
