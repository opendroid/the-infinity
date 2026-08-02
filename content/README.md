# `/content` — the graph

The canonical concept graph, version-controlled alongside the code. Firestore is
downstream of this directory, always: to change a concept, change its JSON and open a
pull request. See [ADR-0002](../docs/adr/0002-content-as-code-and-trust-tiers.md).

```
nodes/                 one JSON file per concept — the id is the filename and the URL
schema/                node.schema.json — the authored shape
derived.golden.json    DERIVED. Do not edit.
```

The rest of this file is the **authoring workflow**: how a batch of nodes gets written,
checked, and merged. It exists so the tenth batch runs like the first.

---

## The constraint that shapes all of it

**Content generation runs through Claude Code on the Max subscription, as an authoring-time
workflow. Never a paid LLM API from application code, CI, or scripts** (CLAUDE.md §3).

No inference in the request path, no API key in the runtime, no per-request model cost. That
is why what follows is *a procedure a person runs*, not a pipeline that runs itself. Nothing
in `/web/scripts` or `.github/workflows` may ever call a model.

## One batch, start to finish

### 1. Choose a cluster, not a list

A batch is a **connected neighbourhood**, not 25 unrelated concepts. Edges are the product;
a batch of isolated nodes is 25 dead ends that happen to validate.

Write the id list first, and for each one name what it `requires`. If a prerequisite is
neither in the batch nor already in `nodes/`, either add it or cut the node.

### 2. Generate

Paste [the prompt below](#the-prompt) into a Claude Code session with the id list. It writes
files straight into `nodes/`.

Batches of 20–30 work. Beyond that the edge set stops fitting in one head — the model's or
yours — and `requires` drifts toward "things that sound related".

### 3. Validate, before the PR and not after CI

```zsh
cd web
npm run validate:content              # schema + cross-field invariants; exits 1 on failure
npm test                              # the same, plus the schema's rejection cases
npm run check:citations -- --offline  # see "Citations" below before trusting this
```

`validate:content` catches most of it: schema violations, an `id` that does not match its
filename, an edge pointing at a node that does not exist, an `emphasis` phrase that is not a
verbatim substring of its body, a `param_controls` entry naming a param that is not in
`params`.

### 4. Regenerate the fixture

```zsh
cd api && make golden
```

Any new node changes the derived graph, so this is not optional for a content batch.

### 5. One PR per batch

Title: `content: seed batch N — <cluster>`. Every node arrives **frontier**. The review
during merge is the verification (ADR-0002); nothing else may set `review`.

## Citations: check, do not trust

**A fabricated citation is the likeliest error in a generated node and the least visible.** A
plausible arXiv id for a paper that does not exist reads exactly like a real one, and the
reader who clicks it is the one who finds out.

`npm run check:citations` does two different jobs, and the difference matters:

| Check | Needs network | Catches |
|---|---|---|
| Structural | no | a `ref` and `url` naming different papers, an impossible arXiv month, a date in the future, one ref at two urls, a non-https link |
| Resolution | **yes** | the paper not existing |

Only the second answers the actual question. The first catches the shapes a model produces
when it invents the id and the link independently, which is most of them.

### It cannot run everywhere, and it says so

An environment with a restrictive egress policy cannot reach `arxiv.org`. When every citation
fails identically the script reports **the network, not the content**, and exits 2 — a
blocked proxy and "every paper vanished at once" look the same from inside, and only one is
plausible. Reporting the first as the second invites someone to delete real citations.

`--offline` never claims the citations are valid. It claims they are *structurally consistent
and unresolved*, which is a much weaker sentence, and it prints it that way.

**Whoever opens the PR is responsible for having run the resolving check somewhere it could
resolve.** If a batch was generated without egress — as these Claude Code sessions may be —
its citations are unverified until someone runs it with network access. Say so in the PR
rather than letting a green CI imply otherwise.

## The prompt

Paste this at the repo root with the id list substituted.

````text
Read /CLAUDE.md, /content/README.md, /content/schema/README.md, and
/content/schema/node.schema.json. Then read three existing nodes in /content/nodes as
style references: muon-optimizer.json, mixture-of-experts.json, feed-forward-network.json.

Write one JSON file per concept into /content/nodes/<id>.json for these ids:

  [PASTE ID LIST]

Every file must satisfy the schema exactly:

- `id` is the kebab-case slug and matches the filename. It is the URL.
- `domain` is a two-level path, e.g. ["Architecture", "Sparsity"] — one place, not
  multi-membership.
- `bodies` has all three of intuition / engineer / math, 40–1400 characters each.
  intuition reads cold in 30 seconds. engineer says what implementing it costs, including
  the part that surprises people. math gives the formulation with its symbols defined.
  The three are the SAME concept at three depths, not three different topics.
- `emphasis` values must be VERBATIM substrings of the matching body. Copy, do not retype.
- `viz.primitive` must be a name in the schema's enum. Read /content/schema/README.md for
  what each draws AND WHICH DIRECTION ITS CONTROL RUNS. Do not invent a name, and do not
  pick a primitive whose picture would contradict your caption — if the concept runs
  against the primitive's direction, pick another or say so rather than writing a caption
  that is not true of what renders.
- `viz.caption` says what the reader sees and what dragging the control does.
  `viz.caption_engineer` only if the primitive draws a different picture at engineer depth.
- `edges.requires` and `edges.adjacent` only. Never author `unlocks` — it is inverted at
  publish time and the schema rejects it. Never author `tier` — it is derived.
- Edges may only reference ids already in /content/nodes or in this batch.
- No pair of concepts may be related in two ways at once.
- `citations`: at least one, real and resolvable, primary source where one exists.
  IF YOU ARE NOT CERTAIN A PAPER EXISTS WITH THAT EXACT ARXIV ID, DO NOT WRITE IT.
  Fewer citations is better than one invented one. If you cannot name a paper's title and
  authors, you are guessing at it.
- `provenance.drafted_at` = today, and NO `review` block. Generated nodes are frontier;
  the human merge is the verification.
- `updated_at` = today.

Then run, from /web:
  npm run validate:content
  npm run check:citations -- --offline
Fix everything they report and re-run until both are clean.

Report: how many nodes you wrote, any edge pointing at an id that does not exist yet, any
concept you dropped and why, and any citation you were not confident enough to include.
Do not open a PR — I will review the files first.
````

### Why the prompt says what it says

- **"If you are not certain a paper exists, do not write it."** The failure mode is confident
  fabrication, and the only reliable counter is making omission the acceptable outcome. One
  real citation beats three plausible ones.
- **"Read which direction its control runs."** `feed-forward-network` pointed at a primitive
  that spread a distribution while its caption said the layer came to *dominate* — opposite
  claims on one page ([#97](https://github.com/opendroid/the-infinity/issues/97)). That line
  exists to stop the next one.
- **"Copy, do not retype"** for `emphasis`: it must be a verbatim substring or the highlight
  silently disappears, and retyping is how the mismatch happens.
- **"Do not open a PR."** The batch is reviewed as files. A merge is the act of verification,
  and there is nothing to verify if generating and merging are one motion.

## What is enforced, and what rests on a human

| Rule | Enforced by |
|---|---|
| Schema shape, closed field set, closed primitive enum | `node.schema.json`, in CI |
| Exactly one of `review` / `provenance`, so the tier is unambiguous | the schema's `oneOf`, in CI |
| `id` matches filename; edges resolve; no self-links | `validate-content.mjs`, in CI |
| `emphasis` is a verbatim substring | `validate-content.mjs`, in CI |
| `param_controls` names a real param | `validate-content.mjs`, in CI |
| Citation ids internally consistent, dates possible | `check-citations.mjs` |
| **The cited paper exists** | `check-citations.mjs` **with network** — and nothing else |
| **The prose is true** | a human reading it. Nothing else, ever |

The last row is why the merge is the verification. Everything above it is a machine saying
the node is well-formed, which is not the same claim as the node being right.

## `derived.golden.json`

A test fixture, regenerated rather than written:

```zsh
cd api && make golden
```

The graph is derived twice, on purpose. `api/internal/publish` derives what the API serves;
`web/src/lib/graph.ts` derives what the static pages render. Neither can call the other —
the pages must build without the API running (ADR-0003), and the API must answer without a
Node runtime.

What that arrangement cannot survive is the two quietly disagreeing: a reader would open a
page whose edge list and mini-map describe different graphs, and nothing would be broken
enough to notice. So both derive the same values from the same nodes and both are checked
against this file. Change either derivation alone and a test goes red.

It holds only the derived fields — tier, the joined domain path, the resolved edges, the
mini-map layout. Bodies, viz, and citations pass through publish untouched, so copying them
here would make this a second copy of `nodes/` and every prose edit a fixture update.

**If a test says this file is stale**, run `make golden` and read the diff. A content change
should move only the nodes you touched. Anything more means the derivation moved, and the
other implementation needs the same change.
