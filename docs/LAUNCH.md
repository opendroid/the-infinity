# Launch checklist

The ordered list of what must be true before this is posted publicly, so launch is a
sequence rather than a feeling (#66).

Most of it is already done — the site has been live on the real domain since the cutover
(#65). What remains is mostly *confirming* rather than *doing*, and the confirmations are
here because the failure modes are quiet: a leftover header, a budget alert nobody set, a
backup that has never been restored.

**Run the checks in order.** Several are cheap to run and expensive to skip, and a few
have to happen after the deploy rather than before.

---

## 1. Serving

- [x] **DNS cutover at GoDaddy** — TXT verify → A records → cert auto-provisions (#65)
- [x] `theinfinity.ai` serves over HTTPS with a valid certificate
- [x] `www.theinfinity.ai` redirects to the apex — `301`, not a certificate error
- [x] `the-infinity-ai.web.app` still serves and canonicals to the real domain
- [ ] **The API answers through the domain, not just the Cloud Run URL.** Firebase Hosting
      rewrites `/api/**` and preserves the full path, which is why the service mounts at
      `/api/v1` and not `/v1` ([ADR-0001](adr/0001-infrastructure.md)) — a mistake that
      only shows up after the first Hosting deploy

```sh
curl -sSI https://theinfinity.ai/ | head -1
curl -sSI https://www.theinfinity.ai/ | grep -i '^location'
curl -s https://theinfinity.ai/api/v1/stats | head -c 200
```

## 2. The crawler block is gone

**This is the one that fails silently.** #84 blocked crawlers on the pre-launch URL with
`robots.txt: Disallow: /` and an `X-Robots-Tag: noindex` header. A leftover header means
the site works perfectly, looks finished, and is simply never found — and nothing about it
looks wrong from the outside.

Run **after** cutover, not before:

```sh
curl -sI https://theinfinity.ai/ | grep -i x-robots-tag        # expect NOTHING
curl -s  https://theinfinity.ai/robots.txt                     # expect Allow: / + Sitemap:
curl -sI https://theinfinity.ai/t/anything | grep -i x-robots  # expect noindex — trails stay out
curl -s  https://theinfinity.ai/sitemap.xml | grep -c '<url>'  # expect one per page
```

- [x] No `X-Robots-Tag` on the site
- [x] `robots.txt` is the #62 version — `Allow: /` plus the sitemap line
- [x] `/t/**` still carries `noindex` ([ADR-0008](adr/0008-shared-trails-from-a-static-shell.md))
- [x] `sitemap.xml` and `llms.txt` both serve
- [ ] **Sitemap submitted in Google Search Console.** Live since #135 and nothing has been
      told about it. Crawl-permitted is not the same as crawled

## 3. Cost

The whole architecture is shaped by cost discipline, so this is not box-ticking.

- [ ] **Budget alerts confirmed live at $10 and $25** — set in `infra/setup.sh`, but
      confirm in the console that they exist and point at an address you read
- [ ] **`--max-instances` is set on the Cloud Run service.** `--min-instances=0` bounds
      *idle* cost and does nothing about a traffic spike; max-instances is what actually
      bounds the bill (`infra/README.md`)
- [ ] **`--service-account` is set.** Without it Cloud Run falls back to an
      Editor-privileged default identity — silently
- [ ] Daily write cap and per-IP rate limits are on (`DAILY_WRITE_CAP`,
      `RATE_LIMIT_PER_MINUTE`, `READ_RATE_LIMIT_PER_MINUTE`)
- [x] No recurring analytics cost — [ADR-0011](adr/0011-analytics-from-request-logs.md)
      chose request logs over a hosted product

```sh
gcloud run services describe api --region us-west1 \
  --format='value(spec.template.spec.serviceAccountName,spec.template.metadata.annotations)'
```

## 4. Backups

- [ ] **A restore has actually been performed**, not just an export. An export that has
      never been restored is a belief, not a backup. `infra/backups.sh` and the drill
      recorded in `infra/README.md`
- [x] `concepts` is excluded from export because it is rebuildable from git; `counters` is
      excluded because it is cheap to lose. Both reasons are written down so the next
      person does not assume `counters` can be regenerated — it cannot, it simply does not
      matter

## 5. Observability

- [x] Structured logs with trace correlation (#2) — a Cloud Trace entry expands to the log
      lines that request emitted
- [ ] **Cloud Logging linked for Hosting request logs** — the console step
      [ADR-0011](adr/0011-analytics-from-request-logs.md) depends on. Project settings →
      Integrations → Cloud Logging → Link. Until this is done there is no page-view data
      at all, and the ADR stays `proposed`
- [ ] One query run against real traffic, so the shape is known before it is needed

```sh
gcloud logging read 'resource.type=cloud_run_revision AND logName:"stdout"' \
  --limit 10 --freshness 1h --format='value(jsonPayload)'
```

## 6. The content is true

- [ ] **Every M1 and M2 issue closed.** Not deferred, not "basically done"
- [x] Every node validates against the schema, and every citation resolves
- [ ] **Citations checked for *identity*, not just resolvability.** `check:citations`
      answers "does this URL load", which a real-but-wrong paper passes — and that is by
      far the most common defect across nine verification batches, sixteen times so far.
      Twice it was the node's own `emphasis` that carried the unsourced claim
- [ ] **Every figure read against its caption.** A separate class from the text and found
      much later (#177): eleven nodes had a slider that moved nothing, and four had a
      figure that showed something other than what its caption promised. A node is not
      only its prose
- [x] 86 of 89 nodes verified. The three that are not are the frontier, and the landing
      page says so

## 7. Read it cold

**Not a tool run.** Open the site on a phone, as a stranger, having not looked at it for a
day. The things worth catching here are the ones no check can see.

- [ ] Landing page on a phone — does it say what this *is* within ten seconds?
- [ ] Search for something you would actually search for. Is the result useful?
- [ ] Read one concept end to end at Intuition depth. Does the 30-second promise hold?
- [ ] Switch to Math. Does it still make sense, and does the notation render?
- [ ] Follow three edges without going back. Does the graph pull you along?
- [ ] Walk a trail, save it, open the link on a different device
- [ ] Submit a concept request. Does the confirmation say something honest?

## 8. Accessibility

**Blocked on a person, not on code**, and deliberately listed as a launch item rather than
a nice-to-have.

- [ ] **#126 — a real screen reader session across all five routes.** Every mechanical
      check is green and none of it is the same as someone hearing the page
- [ ] **#144 — the spoken math.** `d_model` was reading as "dmodel"; ADR-0010 added a
      separator and it has still never been listened to

**The script is written**: [`screen-reader-test.md`](screen-reader-test.md) — about forty
minutes, ordered, with the exact strings to listen for taken from the real `spoken()`
rather than guessed. §1 alone closes #144 and takes ten of those minutes.

## 9. Ship

- [ ] Final pass on the deployed site, not on localhost
- [ ] Post to HN / X
- [ ] Watch the logs for the first hour — bot share, error rate, cold-start latency

---

## What this checklist is for

Four things went wrong that every test passed through:

1. A trace field written in the wrong encoding — present, plausible, and matching nothing.
2. A correlation feature that emitted nothing at all on a healthy service, because the
   only line that fires without an error was mounted in the wrong place.
3. A perf budget that reports a page as empty while a third-party script sits in its head.
4. Eleven concept pages with a slider that moved nothing, under a caption promising it
   would — six of them on pages already marked `verified` (#177).

The first three were caught by looking at the running system. The fourth was caught by
reading a check and noticing it asserted less than its name claimed: it verified that a
control names a key of `viz.params`, which was true, while nothing read that key.

Each looked correct in review and in CI. The checks above exist because the deployed system
is the only thing that can be asked whether it actually works — and because a green check
is a claim about coverage, not a proof of it.
