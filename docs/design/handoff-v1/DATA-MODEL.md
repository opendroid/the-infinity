# Data model

Five records. `tier` and `reviewed` are the only fields that touch color
anywhere in the UI.

## Concept
| Field | Type | Notes |
| --- | --- | --- |
| `id` | slug | also the URL segment; stable forever, redirects on rename |
| `title` | string | node title, set in Unbounded |
| `domain` | string | `"Architecture / Sparsity"` — rendered as the mono eyebrow |
| `tier` | `"verified" \| "frontier"` | drives badge, all dots, pulse, provenance block |
| `bodies` | `{intuition, engineer, math}` | all three ship in the pre-rendered HTML |
| `emphasis` | `{depth: string}` | the substring lifted to violet weight 500 per depth |
| `viz` | object | `primitive`, `params`, `param_controls`, `caption` |
| `edges` | `{requires[], unlocks[], adjacent[]}` | ordered; groups may be empty |
| `provenance` | object \| null | frontier only: `drafted_at`, `sources[]` |
| `review` | object \| null | verified only: `reviewed_by`, `reviewed_at` |
| `updated_at` | date | feeds /changelog grouping |

Invariant: exactly one of `provenance` / `review` is non-null, and it must
agree with `tier`. A verified node with no reviewer is a data bug, not a third
visual state — there is no "stale" tier in v1.

## Edge
| Field | Type | Notes |
| --- | --- | --- |
| `from`, `to` | concept id | |
| `type` | `"requires" \| "unlocks" \| "adjacent"` | `requires`/`unlocks` are inverses; write once, render both ways |
| `reviewed` | boolean | false → dashed in the mini-map |

Edge rows take their dot color from the **target** concept's tier, never from
the edge.

## Trail
| Field | Type | Notes |
| --- | --- | --- |
| `slug` | string | `{title-slug}-{4 char nonce}` |
| `title` | string | generated from first + last stop |
| `stops` | ordered array | `{n, id, title, tier, depth_read_at}` |
| `duration_min` | int | wall time across the wander |
| `created_at` | date | |

The client-side working trail lives in localStorage under `ti.trail` as
`[{id, title, tier, depth_read_at, ts}]`. Re-visiting a node **moves** it to
the end rather than duplicating. Order is the content — this is the one place
numbering is used.

## Request
`{ name, referrer, created_at, status: "queued" | "drafted" | "published" }` —
from the 404 form. A published request becomes a frontier concept, which is what
makes /changelog worth returning to.

## Review
`{ concept_id, kind: "flag" | "volunteer", note, created_at }` — from the
frontier provenance actions. Accepted reviews flip a concept from frontier to
verified, which changes every dot on every surface that references it.
