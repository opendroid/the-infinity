# 0016 — A browser smoke test, and one dependency to run it

- **Status:** accepted
- **Date:** 2026-09-07

## Context

9,665 tests pass and none of them has ever rendered a page.

Vitest runs jsdom against components, `astro build` proves the pages compile, and
`npm run perf` weighs the bundles. Nothing puts a browser in front of the site and
clicks something, so nothing in the repository can observe hydration at all — whether an
island mounted, whether its event handlers are attached, whether the thing a reader drags
moves anything.

[`/docs/PLAN.md`](../PLAN.md) §8 already names the consequence:

> **Tests passing is not the same as the feature working.** Four defects have now shipped
> green: a trace field in the wrong encoding, a correlation feature that emitted nothing
> on a healthy service, a perf budget reporting an empty page with a third-party script in
> its head, and the inert sliders. **Three were caught by looking at the deployed system.**

The inert sliders are the sharpest case. Eleven nodes shipped a figure whose control moved
nothing, and **six of the eleven were already `verified`** — a human had read the JSON and
signed it. Reading the JSON is not looking at the page, and neither is a unit test that
mounts a component and asserts on its props.

Before writing this, the site was driven in Chromium by hand
([#357](https://github.com/opendroid/the-infinity/issues/357)): the 404 island rendered
the suggestions the API returns, a `budget-split` slider moved its bar from 33% to 90%,
the depth toggle swapped bodies, the page survived a 500 from the mini-map endpoint, and
search returned twelve results. **Zero defects.** That is the argument for adding the check
now rather than after the next regression — the site is green, so the test starts honest.

## Decision

**Ship a browser smoke test as a plain Node script, on one new devDependency.**

`web/scripts/smoke.mjs`, run by `npm run smoke`, builds on the existing house pattern —
`perf-budget.mjs`, `check-citations.mjs` and `validate-content.mjs` are all plain scripts
under `web/scripts/`. It starts `astro preview`, drives the built site, and stops the
server.

Three choices inside that, each rejecting an alternative:

**`playwright-core`, not `playwright` or `@playwright/test`.** `playwright-core` has no
postinstall and downloads no browsers, so `npm ci` is unchanged for every developer and
every other CI job; the one job that needs a browser installs Chromium alone, explicitly.
`@playwright/test` would add a **second test runner** next to Vitest, for six assertions.

**Stubbed API responses, not live ones.** Every `/api/v1/**` request is intercepted and
answered from a fixture. The check is about the browser — did the island mount, did the
handler fire, did the DOM change — and a check that also depends on Cloud Run being awake
is a check that goes red for reasons it is not about. Stubbing is also the only way to
assert the *failure* path: one route deliberately answers 500 so the mini-map's documented
degradation can be observed rather than assumed.

**Six assertions, not a suite.** Each one covers something no other check in the repository
can see. A thick browser suite is a maintenance surface that competes with the unit tests
for the same coverage, and the first thing that happens to a slow, broad browser suite is
that people stop reading its failures.

## Consequences

**What this makes easy.** A hydration failure becomes a red build. The inert-slider class
is caught by the one assertion that can catch it — move the control, assert the figure
changed. The mini-map's documented "hides, page unaffected" degradation is exercised on
every PR instead of being a claim in ADR-0003's table.

**What it costs.** A Chromium download and a browser launch in the `web` job on every pull
request — roughly a minute. One more devDependency, and a second place where the DOM is
described, so a markup change can now break a check that is not a unit test.

**What we accept.** The smoke test is deliberately shallow and will not stay
comprehensive; it is a tripwire, not coverage. When it fails the first question is whether
the *site* broke or the *selector* did, and the script answers that by naming the element
it could not find rather than reporting a boolean.

**The escape hatch, and why it exists.** `SMOKE_CHROMIUM` overrides the browser path.
Sandboxes that ship their own Chromium cannot reach Playwright's CDN, and without the
override the check is unrunnable exactly where an agent would run it. CI leaves it unset
and uses the browser it installed.
