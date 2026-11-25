# 0020 — Link checking is two jobs, not one

- **Status:** accepted
- **Date:** 2026-09-08

## Context

`check:citations` and `check:explainers` fetch third-party hosts. Neither had ever read
those hosts' stated policies. Reading them for the first time:

```
arxiv.org/robots.txt
  # Indiscriminate automated downloads from this site are not permitted
  User-agent: *
  Crawl-delay: 15
```

`check:citations` fires 485 arXiv URLs four at a time with no delay, on every pull request
that runs it. The violation is old — the checker never waited — and
[#374](https://github.com/opendroid/the-infinity/issues/374) made the worse half of it this
morning, replacing a serial walk with a four-way pool while optimising the runtime.

**One host's policy was very nearly recorded wrong, and the mistake is the reason this ADR
prescribes a parser rather than a table.** `en.wikipedia.org/robots.txt` contains
`Crawl-delay: 5`, and a grep finds it. It belongs to `User-agent: SemrushBot`; the `*`
group is sixty lines further down and states no delay at all. Read as a table of numbers
the file says five seconds. Read as groups it says nothing. The plan for this change
carried the wrong figure until the file was read properly.

So the real distribution is narrower than it first looked, and lopsided:

| | distinct urls | stated delay | a full sweep costs |
|---|---|---|---|
| `citations` — all `arxiv.org` | 485 | 15s | **~2h** |
| `explainers` — 7 hosts, `d2l.ai` · `lilianweng.github.io` · `en.wikipedia.org` · `huggingface.co` · `jalammar.github.io` · `colah.github.io` · `distill.pub` | 126 | none | ~3s |

Every delayed URL in the repository is a citation, and every citation is a delayed URL.
That is what forces the shape of the decision: honouring 15 seconds makes the citation
check a two-hour job, and a two-hour job cannot gate a merge.

**One honest tension, recorded rather than hidden.** `robots.txt` governs *crawlers*, and a
link checker verifying 485 URLs it already holds is arguably not "indiscriminate
downloads" — it discovers nothing and follows nothing. The counter-argument is that 485
requests in twenty seconds from one address is indistinguishable from a crawler at the
receiving end, and the sentence at the top of the file is not ambiguous. We respect it.

## Decision

**Split link checking into a gate and a sweep, and honour every stated delay in both.**

**Read the policy at runtime; never hard-code it.** `crawlDelays(hosts)` fetches
`https://<host>/robots.txt` once per host per run and parses the `User-agent: *` group. A
table of numbers in this repository would be wrong the day arXiv changed its mind, and
would have shipped Wikipedia's SemrushBot figure today. It is the same rule that already
governs citations and explainer titles: read the source, do not recall it.

**A host that publishes a delay runs at concurrency 1**, waiting the stated interval
between successive requests. `perHost` parallelism stays for hosts that publish nothing.

**`--fast` skips delayed hosts, and says which and how many.** Both checkers take it. The
success line never counts what it skipped — the discipline `--offline` already follows with
its "NOT resolved" wording.

**The pull-request gate is `check:explainers --offline`.** Structural checks only, no network
at all: a url that is not https, one that does not parse, a host the allowlist does not
admit, a missing or wrong scope, a video url with no id for oEmbed to ask about, and the
same resource described two ways on two nodes. An invented reference is caught immediately,
which is the half that was ever about the pull request.

> **Amended 2026-09-13 ([#489](https://github.com/opendroid/the-infinity/issues/489)).** This
> clause originally read *"the pull-request gate is `check:explainers --fast`… about two
> seconds"*, on the reasoning that the fast half was cheap enough to gate on. The measurement
> held and the conclusion did not: cheap is not the same as *reliable*, and a gate that
> reaches a third party fails for reasons the pull request cannot fix. Three went red in one
> session — an ADR, a Go-only change, and one that edited a single markdown file — for
> `en.wikipedia.org` and `youtube.com` not answering, and all three passed on an unchanged
> re-run. One of them took three minutes, not two seconds.
>
> The network half moved to the weekly sweep, which **already ran it in full**, so nothing
> was added and nothing is lost but latency: a video pulled from YouTube is found on Sunday
> rather than at merge. That is the identical trade this ADR already accepted for citations,
> against a larger corpus — 485 papers to 315 pages.

**The sweep is `.github/workflows/links.yml`, weekly.** It runs both checks in full with
delays honoured. Weekly rather than nightly because link rot is slow and a two-hour job
every night is disproportionate to it.

This is also the only shape [#361](https://github.com/opendroid/the-infinity/issues/361)
can take. "Every citation resolves" has been ticked in LAUNCH.md with nothing enforcing it;
it becomes enforced here, on a schedule, because the measured price of enforcing it on a
pull request is two hours.

## Consequences

**What this makes easy.** The checks become defensible. A reader who looks at what this
repository does to arxiv.org sees a client waiting fifteen seconds, which is what the file
asks for. And a claim nobody was checking starts being checked.

**What it costs, and it is the real cost.** A dead citation is now found up to a week after
it dies rather than on the pull request that would have introduced it — except that a *new*
bad citation is still caught immediately by the structural checks, which need no network:
a fabricated arXiv id, a `ref` and `url` that disagree, a future date. What moves to the
schedule is detecting *rot* in citations that were real when merged, and rot is a
weekly-scale phenomenon.

**What we accept.** The gate now covers a subset, and a subset that reports itself as a
pass is exactly the failure PLAN.md §8 names — a check that passes for the wrong reason. So
`--fast` is required to name every host it skipped and the number of entries it left
unverified, and the phrasing of the success line is a thing to protect in review, not a
detail.

**What is now load-bearing that was not.** The robots parser. If it attributes a group
wrongly in the permissive direction we are back to violating a policy while believing we
comply; in the strict direction the sweep silently gets slower. It is unit-tested against
the two real files above, including the SemrushBot group that must be ignored.

**Today `--fast` skips nothing**, because no explainer host publishes a delay. That is not
a reason to leave the flag out: the explainer allowlist grows by review
([ADR-0019](0019-an-encyclopedia-article-is-a-teaching-resource.md) added a host three days
ago), and the first delayed host added to it should slow the sweep, not the gate.

## Addendum — 2026-11-24: identity is a third check in the same job

[#558](https://github.com/opendroid/the-infinity/issues/558). Resolving a citation answers
*does this URL load*. A real paper under the wrong id passes that, and it is the defect
every verification batch has found most often (LAUNCH.md §6). `check:citations --identity`
asks the next question — is the paper at this id the one the node names — by sending every
distinct arXiv id to the export API, a hundred to a request, and comparing each stored title
with the title arXiv gives back. Both are normalised first (case, punctuation, Unicode
dashes, LaTeX, whitespace). An exact match passes, a Levenshtein similarity of 0.90 or more
warns, and anything else fails. A failure names a candidate id only when arXiv's title
search returns an exact match for the stored title.

**It is a third step in `links.yml`, after the explainers and before the sweep.** It is not
a pull-request gate, and the reason is not its price. 485 papers are five requests, under a
minute even at the three seconds between requests that arXiv's API terms ask for. The reason
is the one the 2026-09-13 amendment above records for explainers: cheap is not the same as
reliable, and a gate that reaches a third party fails for causes the pull request cannot
fix. arXiv is also the host the authoring sandbox cannot reach, so a gate on it would be red
wherever content is written. A new citation still gets the structural checks at merge, which
catch an invented id. A real id carrying the wrong title is found on Sunday, or sooner when
the job is started by hand after a large content merge.

**Three seconds is a floor, not the policy.** It is hard-coded because the API's terms state
it rather than robots.txt. The host's `robots.txt` is still read at runtime, as this ADR
requires, and a longer `Crawl-delay` there wins. Every attempt is spaced, retries included,
so a `Retry-After: 0` cannot send one straight back.
