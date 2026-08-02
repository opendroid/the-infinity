// Package apihttp holds the router, the structured error responses, and the
// middleware every route shares.
package apihttp

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// Code is the machine-readable half of an error response. Clients branch on
// this; the message is for humans. The set matches /docs/openapi.yaml.
type Code string

const (
	CodeInvalidRequest  Code = "invalid_request"
	CodeNotFound        Code = "not_found"
	CodePayloadTooLarge Code = "payload_too_large"
	CodeRateLimited     Code = "rate_limited"
	CodeInternal        Code = "internal"
)

// Error is the shape of every error response. Handlers never write a bare
// string — a client that has to parse prose is a client that breaks when the
// prose changes.
type Error struct {
	Code    Code           `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// NotFoundConcept extends Error with the suggestions a 404 page renders, so a
// missing concept is still a place to go rather than a dead end.
type NotFoundConcept struct {
	Error
	ID      string `json:"id"`
	Nearest []any  `json:"nearest"`
}

// WriteJSON encodes v at the given status.
//
// The status is written before encoding, so an encoding failure part-way
// through cannot change it — at that point the only honest thing left is to log
// and let the truncated body surface as a transport error to the client.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encoding response body", slog.Any("error", err), slog.Int("status", status))
	}
}

// WriteError sends a structured error.
func WriteError(w http.ResponseWriter, status int, code Code, msg string) {
	WriteJSON(w, status, Error{Code: code, Message: msg})
}

// WriteFieldError sends a 400 naming the offending field, so a client can point
// at the right input rather than re-reading the whole body.
func WriteFieldError(w http.ResponseWriter, field, msg string) {
	WriteJSON(w, http.StatusBadRequest, Error{
		Code:    CodeInvalidRequest,
		Message: msg,
		Details: map[string]any{"field": field},
	})
}

// WriteRateLimited sends a 429 with Retry-After, so a client backs off by the
// interval we actually want rather than guessing.
func WriteRateLimited(w http.ResponseWriter, retryAfter int) {
	if retryAfter < 1 {
		retryAfter = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	WriteError(w, http.StatusTooManyRequests, CodeRateLimited,
		"Too many requests. Try again shortly.")
}

// WriteInternal logs the cause and returns a generic message.
//
// The error itself never reaches the client: it can name collections, ids, and
// query shapes, none of which a caller needs and some of which help an attacker.
func WriteInternal(w http.ResponseWriter, err error, op string) {
	slog.Error("request failed", slog.String("op", op), slog.Any("error", err))
	WriteError(w, http.StatusInternalServerError, CodeInternal, "Unexpected error.")
}
