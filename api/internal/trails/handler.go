// Package trails serves shared reader paths through the graph.
package trails

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/store"
)

const (
	// maxStops bounds a shared walk. Long enough for a real session, short
	// enough that one request cannot balloon a document.
	maxStops = 200
	// maxDurationS is a week. Beyond that the client's clock is wrong, and
	// storing it would put a nonsense number on a public page.
	maxDurationS = 7 * 24 * 60 * 60
)

type Handler struct {
	store  store.Store
	budget *apihttp.WriteLimiter
}

func New(s store.Store, budget *apihttp.WriteLimiter) *Handler {
	return &Handler{store: s, budget: budget}
}

type createRequest struct {
	Stops []struct {
		ID          string `json:"id"`
		DepthReadAt string `json:"depth_read_at"`
	} `json:"stops"`
	DurationS int `json:"duration_s"`
}

type createResponse struct {
	Slug string `json:"slug"`
	URL  string `json:"url"`
}

// Create serves POST /api/v1/trails.
//
// Idempotent on an identical stop sequence: re-posting the same walk returns
// the existing slug rather than minting a second one, so a client retrying
// after a dropped response does not litter.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body createRequest
	if !apihttp.DecodeJSON(w, r, &body) {
		return
	}

	if len(body.Stops) == 0 {
		apihttp.WriteFieldError(w, "stops", "\"stops\" must contain at least one entry.")
		return
	}
	if len(body.Stops) > maxStops {
		apihttp.WriteFieldError(w, "stops", "A trail may not exceed 200 stops.")
		return
	}
	if body.DurationS < 0 || body.DurationS > maxDurationS {
		apihttp.WriteFieldError(w, "duration_s", "\"duration_s\" is out of range.")
		return
	}

	stops := make([]store.NewTrailStop, 0, len(body.Stops))
	for i, s := range body.Stops {
		if !store.ValidConceptID(s.ID) {
			apihttp.WriteFieldError(w, "stops",
				"Stop "+strconv.Itoa(i+1)+" has an id that is not a kebab-case slug.")
			return
		}
		depth := store.Depth(s.DepthReadAt)
		if !store.ValidDepth(depth) {
			apihttp.WriteFieldError(w, "stops",
				"Stop "+strconv.Itoa(i+1)+" has an unknown \"depth_read_at\".")
			return
		}
		stops = append(stops, store.NewTrailStop{ID: s.ID, DepthReadAt: depth})
	}

	if h.budget.Reserve(w, r) {
		return
	}

	trail, err := h.store.CreateTrail(r.Context(), store.NewTrail{Stops: stops, DurationS: body.DurationS})
	switch {
	case err == nil:
		apihttp.WriteJSON(w, http.StatusCreated, createResponse{
			Slug: trail.Slug,
			URL:  "/t/" + trail.Slug,
		})
	case errors.Is(err, store.ErrNotFound):
		// A stop naming a concept that does not exist is the client's error,
		// not ours — it means a stale localStorage trail, so say which.
		apihttp.WriteFieldError(w, "stops", "A stop names a concept that does not exist.")
	default:
		apihttp.WriteInternal(w, err, "creating trail")
	}
}

// Get serves GET /api/v1/trails/{slug}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	trail, err := h.store.Trail(r.Context(), slug)
	switch {
	case err == nil:
		apihttp.WriteJSON(w, http.StatusOK, trail)
	case errors.Is(err, store.ErrNotFound):
		apihttp.WriteError(w, http.StatusNotFound, apihttp.CodeNotFound,
			"No trail with slug \""+slug+"\".")
	default:
		apihttp.WriteInternal(w, err, "fetching trail")
	}
}
