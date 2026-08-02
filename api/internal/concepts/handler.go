// Package concepts serves the read side of the graph.
package concepts

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// nearestLimit is how many suggestions a 404 offers. Enough to be useful,
// few enough to stay a list rather than a search result.
const nearestLimit = 3

type Handler struct {
	store store.Store
}

func New(s store.Store) *Handler { return &Handler{store: s} }

// Get serves GET /api/v1/concepts/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")

	concept, err := h.store.Concept(ctx, id)
	switch {
	case err == nil:
		apihttp.WriteJSON(w, http.StatusOK, concept)
	case errors.Is(err, store.ErrNotFound):
		h.writeNotFound(w, r, id)
	default:
		apihttp.WriteInternal(w, err, "fetching concept")
	}
}

// writeNotFound answers with suggestions, so a missing concept is a fork in the
// thread rather than a dead end.
//
// The suggestion lookup is best-effort: failing to find neighbours must not
// turn an honest 404 into a 500.
func (h *Handler) writeNotFound(w http.ResponseWriter, r *http.Request, id string) {
	nearest := []any{}
	if found, err := h.store.Nearest(r.Context(), id, nearestLimit); err == nil {
		for _, n := range found {
			nearest = append(nearest, n)
		}
	}

	apihttp.WriteJSON(w, http.StatusNotFound, apihttp.NotFoundConcept{
		Error: apihttp.Error{
			Code:    apihttp.CodeNotFound,
			Message: "No concept with id \"" + id + "\".",
		},
		ID:      id,
		Nearest: nearest,
	})
}

// Neighborhood serves GET /api/v1/concepts/{id}/neighborhood.
//
// The only call a concept page makes after hydration, and the reason it exists:
// a page cached last week shows last week's tier colours while its mini-map
// shows today's. Coordinates are computed at publish time, so this is a read.
func (h *Handler) Neighborhood(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	n, err := h.store.Neighborhood(r.Context(), id)
	switch {
	case err == nil:
		apihttp.WriteJSON(w, http.StatusOK, n)
	case errors.Is(err, store.ErrNotFound):
		apihttp.WriteError(w, http.StatusNotFound, apihttp.CodeNotFound,
			"No concept with id \""+id+"\".")
	default:
		apihttp.WriteInternal(w, err, "fetching neighborhood")
	}
}

// Stats serves GET /api/v1/stats — the landing pulse line.
//
// The landing page ships with build-time values inlined, so this never gates a
// render. It is also the highest-volume path in the surface, which is why it is
// rate limited alongside the write endpoints.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	s, err := h.store.Stats(r.Context())
	if err != nil {
		apihttp.WriteInternal(w, err, "fetching stats")
		return
	}
	apihttp.WriteJSON(w, http.StatusOK, s)
}
