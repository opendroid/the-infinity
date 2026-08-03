# 0008 — A shared trail is a static shell that fetches its own trail

- **Status:** accepted
- **Date:** 2026-08-03

## Context

`/t/[slug]` is route 3 of the handoff — "a wander turned into a shareable artifact; the
growth loop." It exists in the codebase, and it serves exactly one trail: the
`trail.sample.json` fixture, through a `getStaticPaths()` that returns a single entry.

That is not a partial implementation of sharing. It is a demonstration of the layout with
sharing absent, and the gap only became visible when the Share button was wired up
([#114](https://github.com/opendroid/the-infinity/issues/114)):

> With `output: 'static'`, the only shareable trail URL that resolves today is
> `/t/dense-to-sparse-9k2f`. A real slug returned by the API 404s — which would make the
> button worse than dead: it would hand the reader a link that does not work.

A trail slug is minted at runtime, by a reader, from a walk nobody could enumerate at
build time. Astro's static output can only pre-render paths `getStaticPaths()` returns.
So the serving strategy has to change before the button can ship, and CLAUDE.md §8 says a
serving strategy is decided in an ADR before the code, not during it.

The API side needs nothing: `POST /api/v1/trails` and `GET /api/v1/trails/{slug}` are
built, routed, tested — including the idempotency `openapi.yaml` promises — and specified.
Only the serving of the resulting page is open.

## Decision

**One pre-rendered shell at `/t`, a Hosting rewrite pointing `/t/**` at it, and an island
that reads the slug from `location.pathname` and calls `GET /api/v1/trails/{slug}`.**

```jsonc
// web/firebase.json
{ "source": "/t/**", "destination": "/t/index.html" }
```

Hosting matches static files before rewrites, so this only fires for paths with no file
behind them — which, after this change, is every trail.

The page ships as ordinary static HTML from the CDN. The island renders four states —
loading, ready, no such trail, and API unreachable — and the fetch is the only thing that
waits on Cloud Run.

This is not a new architecture. CLAUDE.md §1 already describes it:

> After hydration, islands call the Go API for navigation, mini-map, search, and **trails**.
> *The API is canonical; the static pages are a build-time cache.*

A shared trail is the one page with no build-time cache to be, because it did not exist at
build time. It is the pure form of the rule the rest of the site follows.

### What decided it

**Nothing is indexed, so the SEO argument is not live.** `firebase.json` sets
`X-Robots-Tag: noindex, nofollow` on `**` today. Even after that lifts at launch, a shared
trail is user-generated interaction state — reader-authored, unreviewed, unbounded in
number — and is the one route that should keep the header. The strongest case for
server-rendering evaporates on inspection.

**Static-first is a principle here, not a default.** ADR-0003 chose pre-rendering for
concept pages so first paint never waits on the API. That reasoning does not transfer: a
trail page has no pre-renderable content. Adding SSR to serve one route would trade the
whole build model for a page whose content is a database read either way.

**The API being asleep is an ordinary Tuesday.** Cloud Run scales to zero, so a shared
link opened cold pays a start-up. That is a real cost, paid on the growth loop's most
important page, and it is the honest reason the loading state has to be designed rather
than thrown in.

### The cost, stated plainly

A stranger opening a shared link sees a loading state, then the trail. On a cold instance
that is a second or two of nothing. The mitigation is that the shell paints immediately —
the topbar, the thread, and the frame are all in the static HTML — so what is waiting is
the stop list, not the page.

**Per-trail OG cards become impossible.** The handoff specifies a trail OG card (frame E,
1200×630) and this decision forecloses generating one per slug, because there is no server
to render it. That is a genuine loss on a link people paste into Slack. It is not a
regression today — no route on this site emits OG tags yet — but it means the eventual OG
work has to solve trails differently from concepts: a static card for `/t/**` naming the
product rather than the trail, or a small image endpoint on the Go API. Recorded here so
that discovery lands as a known consequence rather than a surprise.

**`/t/dense-to-sparse-9k2f` stops being a page**, and `trail.sample.json` goes with it. The
fixture modelled the *create* payload — stops of `{id, depth_read_at}` — not the `Trail` the
API returns, so it could not have been reused by the island that replaced it. Keeping an
unused file because it was once load-bearing is how a repository accumulates furniture.

### Resolved 2026-08-03 (#127): a shared card, not a per-trail one

The consequence above came due when OG tags shipped. `/t/**` gets the same
static 1200×630 card as every other route — the issue's first option — so a
shared trail unfurls with the product's name, the thread, and the shell's
generic title rather than the trail's own.

That is the honest reading of what this ADR decided. The alternatives were an
image endpoint on the Go API (`GET /trails/{slug}/card.png`), which puts a
cold Cloud Run start in front of an unfurler that will not wait for it, and
reversing this ADR to server-render the route, which is a large change to buy
one picture. Neither is worth it while the site is `noindex` and pre-launch.

Worth revisiting if shared trails turn out to be how people actually find the
site — that is the growth loop this ADR is about, and a nameless card is a
weaker link than a named one.

### Resolved at the cutover (#65): `/t/**` kept its header

The blanket `X-Robots-Tag: noindex, nofollow` on `**` came off when the domain went
live, and this route's own copy went on at the same moment — `firebase.json` now
carries it under the existing `/t/**` block, beside that route's `Cache-Control`.

Deliberately a header and not a `Disallow` line in `robots.txt`. Disallowing would
stop a crawler from fetching the page, which means it never sees the `noindex`, and a
URL linked from elsewhere can be indexed without ever being crawled. The header needs
the crawl to happen in order to work.

`web/src/lib/robots.test.ts` asserts both halves, because "the one route that should
keep the header" is exactly the kind of decision a later edit to `firebase.json`
removes without noticing.

## Alternatives rejected

**Server-render just this route.** An adapter and a second deployable, behind a Hosting
rewrite. Buys per-trail OG cards and no loading flash, and is what a content site would
do. Rejected as disproportionate: it contradicts the "no adapter, no SSR" contract stated
in `astro.config.ts`, adds a service to build, deploy, secure and pay for, and buys its
main advantage — indexability — for pages we do not want indexed.

**Keep the fixture pre-rendered and rewrite only the rest.** Costs one line and keeps a
design reference alive at a URL. Rejected because it means two implementations of one
route — a pre-rendered one nobody exercises and a fetched one every reader gets — and the
pre-rendered one is the one that would keep passing while the real page broke.

**Encode the whole trail in the URL.** `#feed-forward-network:intuition,…` — no slug, no
Firestore write, no serving problem, and it works while the API sleeps. Genuinely
attractive and rejected on cost: it discards `POST`/`GET /api/v1/trails`, already built,
tested and specified, and with them short links, the generated title, the duration, and
the idempotency that stops one walk minting a hundred slugs. Worth revisiting only if the
trails collection ever becomes a cost or privacy problem.

**Client-side fetch, but from `/404.html`.** Hosting serves the 404 page for unmatched
paths, so a trail island could live there with no rewrite at all. Rejected as a trick: the
page would be served with a 404 status, which is a lie to every crawler and cache, and the
mechanism is invisible to anyone reading the routes.

## Consequences

- `/t/**` is served by one file. Adding a real `/t/something` page later means adding it
  above the rewrite, and forgetting to would silently serve the shell.
- The trail page is the first route that renders nothing useful without JavaScript. Every
  other route degrades to readable HTML; this one degrades to a message saying a trail
  needs JavaScript, because its content is a runtime fetch. That is a real narrowing of
  the static-first promise and is why it needed an ADR rather than a commit.
- The four states are now a UI surface with a design cost, not an afterthought — the
  handoff's "API unreachable" treatment applies here more than anywhere.
- `GET /api/v1/trails/{slug}` moves onto the critical path for a shared link. It is a
  single document read, but it is the first time a page's whole content depends on the
  API answering.
