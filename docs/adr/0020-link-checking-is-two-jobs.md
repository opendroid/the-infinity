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

**The pull-request gate is `check:explainers --fast`.** It covers 126 URLs on seven hosts,
none of them delayed, in about two seconds.

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
