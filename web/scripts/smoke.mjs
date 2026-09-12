/**
 * The browser smoke test (ADR-0016, #357).
 *
 * Ten assertions, each covering something no other check in this repository
 * can see: whether an island actually hydrated in a browser — and, since #405,
 * whether a failed write leaves focus somewhere the reader can act from, which
 * jsdom cannot answer because it does not blur a disabled element. Vitest mounts
 * components in jsdom, `astro build` proves they compile, and `npm run perf`
 * weighs the bundles — none of that observes a handler firing.
 *
 * The class this exists for is the inert slider: eleven nodes shipped a figure
 * whose control moved nothing, and six of them were already `verified`. Reading
 * the JSON is not looking at the page.
 *
 * EVERY /api/v1 REQUEST IS STUBBED. The check is about the browser, and one that
 * also depended on Cloud Run being awake would go red for reasons it is not
 * about. Stubbing is also the only way to assert the failure path — one route
 * answers 500 on purpose so the mini-map's documented degradation is observed
 * rather than assumed.
 *
 * Needs a build first, like `npm run perf`. Starts and stops its own preview.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { chromium } from 'playwright-core';
import { glowing } from './box-shadow.mjs';

const WEB = resolve(process.cwd());
const DIST = join(WEB, 'dist');
const NODES = join(resolve(WEB, '..'), 'content/nodes');
const PORT = Number(process.env.SMOKE_PORT ?? 4322);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** A slug no concept will ever claim, so the 404 route is not a race with content. */
const MISSING = 'smoke-test-no-such-concept';

const failures = [];
const fail = (what) => failures.push(what);

/** What the script is doing, so the watchdog can say where it stopped. */
let step = 'starting';
/** The preview server, so the watchdog can stop it on its way out. */
let running = null;

/**
 * The concept page to drive.
 *
 * Chosen from content rather than hard-coded, so removing one node cannot
 * silently turn this into a test of a 404 page. The first node with a viz
 * control, in id order — which one it is does not matter, only that it has
 * something to drag.
 */
function driveable() {
  for (const file of readdirSync(NODES).filter((f) => f.endsWith('.json')).sort()) {
    const node = JSON.parse(readFileSync(join(NODES, file), 'utf8'));
    if (node.viz?.param_controls?.length) return node;
  }
  throw new Error('no concept has a viz control — there is nothing to drag');
}

/** The 404 body the API really returns, so the island parses what it parses in production. */
const notFound = (id) => ({
  error: 'not_found',
  message: `No concept with id "${id}".`,
  id,
  nearest: [
    { id: 'smoke-alpha', title: 'Smoke Alpha', tier: 'verified' },
    { id: 'smoke-beta', title: 'Smoke Beta', tier: 'frontier' },
  ],
});

/**
 * Stops the preview and everything it started.
 *
 * The server is spawned DETACHED and killed by process GROUP, and neither half
 * is optional. Through `npx` the shim exits and leaves the real server running;
 * kill only that pid and the orphan holds the pipes open, and node will not exit
 * while it does. Not hypothetical: the first version of this script ran all six
 * assertions, printed its verdict, and then hung forever — which on a laptop is
 * a stray process and in CI is a job that runs until the runner gives up rather
 * than a red build.
 */
function stop(server) {
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

async function preview() {
  if (!existsSync(DIST)) throw new Error(`${DIST} does not exist — run \`npm run build\` first`);

  const astro = join(WEB, 'node_modules/.bin/astro');
  const server = spawn(astro, ['preview', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: WEB,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(ORIGIN + '/', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return server;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  stop(server);
  throw new Error(`astro preview never answered on ${ORIGIN}:\n${log.join('')}`);
}

async function main() {
  step = 'reading content';
  const node = driveable();
  step = 'starting astro preview';
  const server = await preview();
  running = server;

  // Sandboxes that ship their own Chromium cannot reach Playwright's CDN, and
  // without this the check is unrunnable exactly where an agent would run it.
  // CI leaves it unset and uses the browser it installed (ADR-0016).
  const launch = process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {};

  // The launch is INSIDE the try. It was outside, and a browser that failed to
  // start took the whole script down before the preview server was stopped —
  // one leaked server per failed run, from the error path most likely to be hit
  // on a machine that has not installed a browser.
  let browser;
  try {
    step = 'launching chromium';
    browser = await chromium.launch(launch);

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    await ctx.route('**/api/v1/**', (route) => {
      const url = route.request().url();
      if (url.includes(`/concepts/${MISSING}`)) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify(notFound(MISSING)),
        });
      }
      // Everything else fails on purpose. The mini-map's own route is the one
      // that matters: ADR-0003 promises the map hides and the page is otherwise
      // untouched, and this is the only place that claim is exercised.
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"internal","message":"stubbed failure"}',
      });
    });

    const page = await ctx.newPage();
    // Uncaught exceptions only. Failed resource loads are counted deliberately
    // NOT: the font stylesheet is a third-party request, and a check that goes
    // red when fonts.googleapis.com is unreachable is a check about the network.
    let crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));

    // Responses are RECORDED rather than waited for. `waitForResponse` only
    // watches the future, and a client:idle island has usually already made its
    // call by the time the navigation settles — so waiting for it would be a
    // race that passes or fails on machine speed.
    let seen = [];
    page.on('response', (r) => seen.push(r.url()));

    const visit = async (path) => {
      step = `visiting ${path}`;
      crashes = [];
      seen = [];
      await page.goto(ORIGIN + path, { waitUntil: 'load' });
      // Islands are client:load / client:idle; give them a beat to mount.
      await page.waitForTimeout(1500);
      await listsKeepTheirSemantics(path);
    };

    /**
     * Every unstyled list must say it is a list (#416).
     *
     * SAFARI STRIPS LIST SEMANTICS when `list-style: none` is applied, so
     * VoiceOver does not announce the list at all — and Tailwind's preflight
     * applies it to every `ul` and `ol` on the site. `role="list"` puts the
     * semantics back. It is redundant against the spec and load-bearing against
     * the implementation, which is why the validator flags it and we keep it.
     *
     * ASSERTED IN A BROWSER BECAUSE ONLY A BROWSER KNOWS. The role is in the
     * markup, but whether a list is *unstyled* is a computed style, and whether
     * it sits inside a `nav` — the one case Safari exempts — is a DOM question.
     * Chromium is not the engine with the behaviour; it is the engine that can
     * measure the condition.
     */
    async function listsKeepTheirSemantics(path) {
      const bare = await page.$$eval('ul, ol', (els) =>
        els
          // `globalThis` rather than a bare `getComputedStyle`: this callback runs
          // in the browser, but the file is linted as Node, where the browser
          // globals do not exist. Same reason the focus check above uses a
          // `:focus` selector instead of reading `document.activeElement`.
          .filter((e) => globalThis.getComputedStyle(e).listStyleType === 'none')
          .filter((e) => !e.closest('nav'))
          // listbox is a different widget with its own semantics; SearchPanel's
          // results list is correct as it is and must not be "fixed" into a list.
          .filter((e) => !['list', 'listbox', 'menu', 'none', 'presentation'].includes(e.getAttribute('role') ?? ''))
          .map((e) => `${e.tagName.toLowerCase()}.${(e.className || '(no class)').split(' ')[0]}`),
      );
      if (bare.length > 0) {
        const shown = [...new Set(bare)].slice(0, 4).join(', ');
        fail(`${path}: ${bare.length} unstyled list(s) without role="list" — Safari drops the semantics: ${shown}`);
      }
    }

    // 1 — the 404 island renders what the API hands it. Nothing else in the
    //     repository proves this island hydrates at all.
    await visit(`/c/${MISSING}`);
    const gap = await page.locator('main').innerText();
    if (!gap.includes('Smoke Alpha') || !gap.includes('Smoke Beta')) {
      fail(`/c/${MISSING}: the 404 island did not render the API's suggestions`);
    }
    if (crashes.length) fail(`/c/${MISSING} threw: ${crashes.join(' | ')}`);

    // 2 — the control moves the figure. THE INERT-SLIDER ASSERTION: eleven nodes
    //     shipped one that did not, six of them already verified.
    //
    // It reads the figure's own sr-only description rather than the figure's
    // text, and that distinction is the assertion. Every primitive renders one —
    // `describeSplit`, `describeCurve`, `describeSweep` — and it states what the
    // picture SHOWS. The visible text also carries a `name = value` echo of the
    // control, which moves whether or not the drawing does, so an assertion on
    // the whole figure passes on a slider that only relabels itself. Verified by
    // planting exactly that: a BudgetSplit reading `params[control]` instead of
    // the live value still changed its header, and the first version of this
    // check called that a pass.
    await visit(`/c/${node.id}`);
    const figure = page.locator('figure').first();
    const described = figure.locator('.sr-only').first();
    if ((await figure.count()) === 0) fail(`/c/${node.id}: no <figure> — the viz island did not render`);
    else if ((await described.count()) === 0) {
      fail(`/c/${node.id}: the figure has no sr-only description to read`);
    } else {
      const control = page.locator('input[type="range"]').first();
      if ((await control.count()) === 0) {
        fail(`/c/${node.id}: no slider, though the node declares param_controls`);
      } else {
        // WCAG 2.2 AA 2.5.8 wants 24x24. `appearance: none` with no height
        // collapsed this onto its own 3px track, and the thumb painted OUTSIDE
        // the box that receives the touch — so it looked right and measured
        // 206x3 (#450). Only a real browser computes this box.
        const box = await control.boundingBox();
        if (box && box.height < 24) {
          fail(
            `/c/${node.id}: the slider is ${Math.round(box.width)}x${Math.round(box.height)} — ` +
              'under the 24px minimum target size (WCAG 2.2 AA 2.5.8)',
          );
        }

        const before = await described.textContent();
        await control.fill(String(node.viz.param_controls[0].max));
        await page.waitForTimeout(250);
        const after = await described.textContent();
        if (before === after) {
          fail(`/c/${node.id}: the slider moved and the figure still describes itself as "${before}"`);
        }
      }
    }

    // 3 — the depth toggle swaps the body. The product's central interaction,
    //     and role="tab", not "button" — a selector written from the wrong role
    //     would pass while asserting nothing.
    const math = page.getByRole('tab', { name: /^math$/i }).first();
    if ((await math.count()) === 0) fail(`/c/${node.id}: no Math tab — the depth toggle did not hydrate`);
    else {
      const before = await page.locator('main').innerText();
      await math.click();
      await page.waitForTimeout(250);
      const after = await page.locator('main').innerText();
      if (before === after) fail(`/c/${node.id}: the Math tab changed nothing`);
      else if (!after.includes(node.bodies.math.slice(0, 60))) {
        fail(`/c/${node.id}: the Math tab did not show the node's math body`);
      }
    }

    // 4 — the page survives its API, and so does the mini-map.
    //
    // THIS ASSERTION WAS WRONG ON ITS FIRST RUN, AND THE BROWSER IS WHY IT IS
    // RIGHT NOW. It was written from `docs/openapi.yaml`, which said "on failure
    // the mini-map hides and the page is otherwise untouched", and it failed:
    // the map is rendered at build time from the same derivation the page uses,
    // and the fetch only refreshes it. So a dead API costs the reader nothing at
    // all, which is stronger than hiding and is the whole of static-first. The
    // document was the thing that was out of date (#357).
    // Checking that the island actually asked is what gives this teeth: if it
    // never hydrated, the server-rendered map would still be sitting there and
    // "the map survived" would pass without anything having happened.
    const asked = seen.some((u) => u.includes('/neighborhood'));
    if (!asked) fail(`/c/${node.id}: the mini-map island never called its endpoint — it did not hydrate`);
    if ((await page.locator('h1').count()) === 0) {
      fail(`/c/${node.id}: the page lost its heading when the mini-map API failed`);
    }
    if (asked && (await page.locator('svg[role="img"]').count()) === 0) {
      fail(`/c/${node.id}: the build-time mini-map did not survive a 500 from its endpoint`);
    }
    if (crashes.length) fail(`/c/${node.id} threw: ${crashes.join(' | ')}`);

    // 7. A FAILED SEND MUST NOT COST THE READER THEIR PLACE (#405).
    //
    // THIS ONE CANNOT BE A UNIT TEST, and that is why it is here. The defect was
    // `disabled={sending}` on the button the reader is standing on: disabling a
    // focused element hands focus to `<body>`, the send then fails, the button
    // comes back — and nothing gives focus back. jsdom does not blur on
    // `disabled`, so the vitest version of this assertion passes with the defect
    // restored. Only a real browser drops the focus, so only a real browser can
    // notice that it stopped.
    //
    // Every /api/v1 route is stubbed to 500 already, so "Share trail" fails by
    // construction — the failure path is the one worth checking, since the
    // success path navigates away.
    step = 'checking focus survives a failed share';
    const share = page.locator('button', { hasText: /^Share trail$/ });
    if ((await share.count()) === 0) {
      fail(`/c/${node.id}: no Share trail button — the trail ribbon did not hydrate`);
    } else {
      await share.first().focus();
      await share.first().click();
      // The alert is the signal the send has settled; waiting on a timer would
      // pass or fail on machine speed.
      await page.locator('[role="alert"]', { hasText: /could not be/ }).first().waitFor({ timeout: 10_000 });
      // `:focus` as a selector rather than reading `document.activeElement` in
      // an evaluate: this file is linted as Node, where `document` is not a
      // global, and the CSS form asserts something stronger anyway — that the
      // share button ITSELF holds focus, not merely that something does.
      if ((await page.locator('button:focus', { hasText: /^Share trail$/ }).count()) === 0) {
        fail(`/c/${node.id}: the share button did not keep focus after a failed share`);
      }
      if (await share.first().isDisabled()) {
        fail(`/c/${node.id}: the share button is disabled after a failed share — it cannot be retried`);
      }
    }

    // 5 — search runs client-side off the static index, with the API dead.
    await visit('/search?q=attention');
    const found = await page.locator('main').innerText();
    if (!/\d+ results? for attention/i.test(found)) {
      fail('/search?q=attention: no result count — the search island did not answer');
    }
    // The rule is unit-tested; this is the WIRING. A pure function nothing calls
    // passes its own tests forever (#452, and #429 before it).
    const box = page.locator('input[type="search"]').first();
    await box.fill('');
    await page.waitForTimeout(250);
    const cleared = await page.evaluate(() => globalThis.location.search);
    if (cleared !== '') {
      fail(`/search: clearing the box left "${cleared}" in the URL — a reload would bring the query back`);
    }
    await box.fill('softmax');
    await page.waitForTimeout(250);
    const retyped = await page.evaluate(() => globalThis.location.search);
    if (!retyped.includes('softmax')) {
      fail(`/search: typing a new query left the URL at "${retyped}"`);
    }

    if (crashes.length) fail(`/search threw: ${crashes.join(' | ')}`);

    // 6 — the landing page, which ships no JavaScript at all, still paints.
    // 8 — /concepts is where the list assertion has the most to check: one list
    //     per second-level domain, 234 of them, and no other route visits it.
    await visit('/concepts');
    if (!(await page.locator('main').innerText()).includes('concepts across')) {
      fail('/concepts: the directory did not render its summary line');
    }

    await visit('/');

    // 9 — THE SEARCH FIELD SHOWS WHERE FOCUS IS (#418). It did not: the global
    //     rule is written with `:where()`, which has zero specificity by
    //     definition, so the input's `outline-none` beat it and a keyboard user
    //     tabbing onto the primary action of the whole product was shown
    //     nothing. Every other focusable element on the site was already right.
    //
    //     Read off the WRAPPER, not the input. The ring belongs there because
    //     the form is `overflow-hidden` and would clip an outline drawn on a
    //     child — so an assertion on the input would fail the correct fix.
    step = 'checking the search field shows focus';
    const unfocused = await page.$eval('form', (e) => globalThis.getComputedStyle(e).outlineStyle);
    await page.focus('#q');
    const focused = await page.$eval('form', (e) => {
      const c = globalThis.getComputedStyle(e);
      return `${c.outlineStyle} ${c.outlineWidth}`;
    });
    if (unfocused !== 'none') {
      fail(`/: the search field draws an outline before it is focused (${unfocused})`);
    }
    if (!focused.startsWith('solid') || focused.endsWith('0px')) {
      fail(`/: focusing the search field showed no ring — computed "${focused}"`);
    }

    // 10 — THE GLOW IS LIT, AND IT IS THE ONLY ONE (#419). CLAUDE.md §5 rule 3:
    //      "at most one glowing element per screen… on the landing page that is
    //      the search field and nothing else." Both halves are asserted here —
    //      a budget nothing spends and a budget everything spends are equally
    //      wrong, and until now neither was checked by anybody.
    //
    //      The browser only MEASURES; box-shadow.mjs decides what counts. That
    //      split is the point: Tailwind v4 composes five variables, so a lit
    //      element reports four transparent placeholders before the real shadow,
    //      and judging that string is subtle enough to have its own unit tests.
    //      Judging it inline, inside page.evaluate, is what produced #419 — a
    //      bug filed against a page that was rendering correctly all along.
    step = 'checking the landing glow';
    const shadows = await page.$$eval('*', (els) =>
      els.map((e) => {
        const cls = typeof e.className === 'string' && e.className ? `.${e.className.split(' ')[0]}` : '';
        return [`${e.tagName.toLowerCase()}${cls}`, globalThis.getComputedStyle(e).boxShadow];
      }),
    );
    const lit = glowing(shadows);
    if (lit.length === 0) {
      fail('/: nothing on the landing page glows — the search field should (CLAUDE.md §5 rule 3)');
    } else if (lit.length > 1) {
      fail(`/: glow is rationed to one element, found ${lit.length} — ${lit.join(', ')}`);
    } else if (!lit[0].startsWith('form')) {
      fail(`/: the glow is on ${lit[0]}, not the search field`);
    }

    // A reader's own text is echoed back on the zero-result page, and a long
    // unbroken token has nowhere to wrap. This needs a real browser at a real
    // width: it is a layout fact, invisible to jsdom and to any DOM assertion
    // (#449). 320px is the floor WCAG 2.2 reflow names.
    step = 'checking a long query cannot widen the page';
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${ORIGIN}/search?q=${'a'.repeat(80)}`, { waitUntil: 'networkidle' });
    const spill = await page.evaluate(() => {
      const d = globalThis.document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth };
    });
    if (spill.scrollW > spill.clientW + 1) {
      fail(
        `/search: an 80-character query widened the page to ${spill.scrollW}px in a ${spill.clientW}px viewport — ` +
          'the echoed query has to wrap (WCAG 2.2 AA 1.4.10)',
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });

    // A phone held sideways is ~390px tall and the landing stack needed 402, so
    // the one action the page exists to offer started below the fold (#456).
    // CSS that quietly stops applying looks identical in a diff; only a real
    // viewport can say whether the cap is doing anything.
    // WCAG 2.2 AA 2.5.8 wants 24x24 for a standalone control, and the header's
    // links are on every page. Measured rather than asserted from the class
    // list: the first fix used `min-h-6`, which in this repo is SIX pixels —
    // tokens.json generates a pixel-keyed spacing scale, so Tailwind's usual
    // 6 = 1.5rem does not hold here. The class was present, the rule was in the
    // CSS, and nothing changed (#457).
    // axe's `nested-interactive` rule, implemented rather than imported: an
    // element with a widget role must not contain a focusable descendant. One
    // rule is not worth a new dependency, and this states the invariant in the
    // terms the page is actually built from (#468).
    //
    // Needs the results rendered, so it runs on /search with a query.
    // WCAG 1.4.1: a link sitting INSIDE a run of text needs something other than
    // colour to mark it. Violet alone fails for anyone who cannot separate it
    // from the body colour, and hover — which the CSS deferred to — never
    // arrives on a touch screen (#469).
    //
    // The heuristic is axe's `link-in-text-block`: only links whose parent holds
    // other text are in scope. A link alone in its own block is distinguished by
    // position and is deliberately not flagged.
    step = 'checking links in prose are not colour alone';
    for (const path of ['/c/attention', '/request', '/search?q=attention', '/c/qa-nope-404']) {
      await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const bare = await page.evaluate(() => {
        const out = [];
        globalThis.document.querySelectorAll('main a[href]').forEach((a) => {
          const parent = a.parentElement;
          if (!parent) return;
          const siblingText = [...parent.childNodes]
            .filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1).length;
          if (siblingText === 0) return;
          const line = globalThis.getComputedStyle(a).textDecorationLine;
          if (!line.includes('underline')) {
            out.push(`"${(a.textContent || '').trim().slice(0, 28)}"`);
          }
        });
        return out;
      });
      if (bare.length > 0) {
        fail(`${path}: ${bare.length} link(s) in prose with no underline at rest — ${bare.slice(0, 3).join(', ')}`);
      }
    }

    step = 'checking no widget contains a focusable control';
    await page.goto(`${ORIGIN}/search?q=attention`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const nested = await page.evaluate(() => {
      const WIDGET = ['option', 'tab', 'button', 'checkbox', 'radio', 'menuitem', 'switch', 'link', 'treeitem'];
      const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
      const out = [];
      globalThis.document.querySelectorAll('[role]').forEach((el) => {
        if (!WIDGET.includes(el.getAttribute('role'))) return;
        const inner = el.querySelectorAll(FOCUSABLE);
        if (inner.length > 0) {
          out.push(`${el.tagName.toLowerCase()}[role=${el.getAttribute('role')}] contains ${inner.length} focusable`);
        }
      });
      return out;
    });
    if (nested.length > 0) {
      fail(`/search: ${nested.length} widget(s) with focusable descendants — ${nested.slice(0, 3).join('; ')}`);
    }

    step = 'checking the header targets are big enough to tap';
    const small = await page.$$eval('header a, header button', (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({ name: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20), h: e.getBoundingClientRect().height }))
        .filter((e) => e.h < 24),
    );
    if (small.length > 0) {
      fail(
        `/: ${small.length} header target(s) under 24px tall — ` +
          small.map((e) => `"${e.name}" ${Math.round(e.h)}px`).join(', '),
      );
    }

    step = 'checking the search field survives a short viewport';
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
    const fold = await page.evaluate(() => {
      const box = globalThis.document.querySelector('input').getBoundingClientRect();
      return { bottom: Math.round(box.bottom), viewport: globalThis.innerHeight };
    });
    if (fold.bottom > fold.viewport) {
      fail(
        `/: in a ${fold.viewport}px-tall viewport the search field ends at ${fold.bottom}px — ` +
          'the primary action is below the fold',
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });

    const landing = await page.locator('main').innerText();
    // Anchored to the number. "concepts" alone also appears in the standfirst
    // above the search field, so the loose version passed with the count line
    // renamed — found by planting it.
    if (!/[\d,]+ concepts/.test(landing)) fail('/: the landing page did not render its count');
    if (crashes.length) fail(`/ threw: ${crashes.join(' | ')}`);
  } finally {
    if (browser) await browser.close();
    stop(server);
  }

  if (failures.length) {
    console.error(`\n${failures.length} smoke failure(s):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.log(
    `✓ smoke: 404 suggestions, ${node.id}'s slider and depth toggle, mini-map degradation, ` +
      `focus after a failed share, search, list semantics, focus ring, the one glow, reflow, prose links, nesting, tap targets, short viewport, landing`,
  );
  return 0;
}

/**
 * A hang has to look like a failure.
 *
 * Without this, a browser that never launches or a preview that never answers is
 * a CI job running until the runner's own timeout: no output, no verdict, and
 * nothing saying how far it got. The watchdog turns that into a red build naming
 * the last thing the script was doing.
 */
const BUDGET_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const watchdog = setTimeout(() => {
  console.error(`\nsmoke: gave up after ${BUDGET_MS / 1000}s — the last thing it did was "${step}"`);
  // process.exit skips the finally that would otherwise stop the server, so the
  // watchdog has to do it itself. Verified by watching it not: the timeout path
  // left an astro preview behind every time it fired.
  if (running) stop(running);
  process.exit(1);
}, BUDGET_MS);
watchdog.unref();

const code = await main();
clearTimeout(watchdog);
// Explicit, because one stray child of the preview server would otherwise hold
// the event loop open long after every assertion has answered.
process.exit(code);
