#!/usr/bin/env node
/* Engine probe, part two: the checks a DOM probe cannot make (#458).
 *
 *   node scripts/engine-probe/interactions.mjs                 # Safari on :4444
 *   BROWSER=firefox node scripts/engine-probe/interactions.mjs # Gecko
 *
 * The slider, the / shortcut and the depth tabs are driven through the
 * WebDriver Actions API rather than element.click() or a synthesized event.
 * ONLY A TRUSTED POINTER GOES THROUGH HIT-TESTING, and hit-testing is the
 * question — a scripted click reports success whatever the answer is.
 *
 * Env: DRIVER · BROWSER · ORIGIN · OUT (screenshot directory).
 *
 * READ-ONLY AGAINST PRODUCTION, deliberately. It navigates, resizes, presses
 * keys and clicks, and it submits nothing: /request writes to Firestore and
 * "Copy link" creates a shared trail. Neither is done on a reader's behalf.
 * See README.md for what is left for a human because of that.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DRIVER = process.env.DRIVER ?? 'http://localhost:4444';
const BROWSER = process.env.BROWSER ?? 'safari';
const ORIGIN = process.env.ORIGIN ?? 'https://theinfinity.ai';
const EL = 'element-6066-11e4-a52e-4f735466cecf'; // the W3C element key
/** Where screenshots land. `probe-shots/` is gitignored; override with OUT. */
const OUT = process.env.OUT ?? 'probe-shots';

async function wd(method, path, body) {
  const res = await fetch(DRIVER + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) {
    const v = json.value ?? {};
    throw new Error(`${method} ${path} -> ${res.status} ${v.error ?? ''}: ${v.message ?? JSON.stringify(json)}`);
  }
  return json.value;
}

const { sessionId: s } = await wd('POST', '/session',
  { capabilities: { alwaysMatch: { browserName: BROWSER, ...JSON.parse(process.env.EXTRA_CAPS ?? '{}') } } });
const go = (u) => wd('POST', `/session/${s}/url`, { url: ORIGIN + u });
const js = (script) => wd('POST', `/session/${s}/execute/sync`, { script, args: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** `sel` is a CSS selector; `script` returns a Node, which W3C hands back as an
 *  element reference — the way to frame an element that has no stable selector. */
const shot = async (name, { sel, script } = {}) => {
  let b64;
  if (sel || script) {
    const el = script
      ? await wd('POST', `/session/${s}/execute/sync`, { script, args: [] })
      : await wd('POST', `/session/${s}/element`, { using: 'css selector', value: sel });
    b64 = await wd('GET', `/session/${s}/element/${el[EL]}/screenshot`);
  } else {
    b64 = await wd('GET', `/session/${s}/screenshot`);
  }
  // EVERY FILE CARRIES ITS ENGINE. These were hardcoded to `safari-*`, so the
  // Firefox run overwrote the Safari PNGs — the run producing new coverage
  // destroying the evidence for the old. The engine is the first thing you
  // need to know about a screenshot, so it goes in the name.
  const file = `${BROWSER}-${name}.png`;
  // INTO AN IGNORED DIRECTORY, NOT BESIDE THE SCRIPT. These used to land next
  // to the .mjs, which was harmless in a scratchpad and is not once the script
  // lives in the repository: a `git add -A` during an unrelated change would
  // sweep a dozen PNGs in with it.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
  console.log(`  wrote ${relative(process.cwd(), join(OUT, file))}`);
};

const el = async (sel) => wd('POST', `/session/${s}/element`, { using: 'css selector', value: sel });
/** A real driver click: scrolls into view and dispatches a trusted event. */
const click = async (sel) => wd(`POST`, `/session/${s}/element/${(await el(sel))[EL]}/click`, {});

const R = [];
const say = (k, v) => { R.push([k, v]); console.log(`  ${k.padEnd(34)} ${v}`); };

try {
  // 1 — A PICTURE OF THE SEARCH FIELD. The whole of #472: our clear control
  //     is countable from the DOM, the browser's native one is not. Only an
  //     image settles how many the reader actually sees.
  console.log(`\n=== #472  the search field, as ${BROWSER} paints it ===`);
  await go('/search?q=attention');
  await wait(1500);
  // THE WRAPPER, NOT THE INPUT. Our ✕ is a SIBLING button, so an input-only
  // frame crops it out and the picture reads as "no clear control at all".
  // The native ✕, if Safari still draws one, sits INSIDE the input. Only a
  // frame containing both can answer how many the reader sees.
  await shot('search-field', { script: 'return document.querySelector("#search-q").parentElement;' });
  await shot('search-input-only', { sel: 'input[type=search][role=combobox]' });
  await shot('search-page');

  // 2 — WCAG 1.4.10 reflow at 320 CSS px. The automation window opens at
  //     800x600, so nothing above has been checked at phone width.
  console.log('\n=== 1.4.10  reflow at 320px ===');
  await wd('POST', `/session/${s}/window/rect`, { width: 320, height: 800 });
  for (const route of ['/', '/concepts', '/c/attention', '/search?q=attention', '/request']) {
    await go(route);
    await wait(900);
    const over = await js('return document.documentElement.scrollWidth - window.innerWidth;');
    say(`${route} h-overflow`, over <= 1 ? `ok (${over}px)` : `FAIL — ${over}px of horizontal scroll`);
  }
  // BACK TO THE CONCEPT PAGE BEFORE SHOOTING. The loop above ends on /request,
  // so a shot taken here pictured /request under a filename saying `concept`.
  // The concept page is the one worth a picture at this width: it is the
  // 1fr/288px grid collapsing to one column.
  await go('/c/attention');
  await wait(900);
  await shot('320-concept');

  // 3 — the "/" shortcut, and Escape handing focus back to the opener (#405).
  //     A real key event through the Actions API, not a synthesized one:
  //     Safari ignores untrusted events for this, which is the point.
  console.log('\n=== the / shortcut and Escape ===');
  await wd('POST', `/session/${s}/window/rect`, { width: 1280, height: 900 });
  await go('/c/attention');
  await wait(1200);
  const key = (value) => wd('POST', `/session/${s}/actions`, {
    actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }],
  });
  // FOCUS SOMETHING FIRST. With nothing focused the opener IS <body>, so
  // Escape correctly returns focus to <body> and a naive check calls that a
  // failure. This exact trap already cost one false finding this project.
  await js('document.querySelector("header a[href]").focus();');
  const opener = await js('return document.activeElement ? document.activeElement.outerHTML.slice(0,60) : "none";');
  say('focus parked on', opener.replace(/\s+/g, ' '));
  await key('/');
  await wait(700);
  const opened = await js('return !!document.querySelector(\'input[type=search][role=combobox]\');');
  say('/ opens the overlay', opened ? 'ok' : 'FAIL — no combobox appeared');
  if (opened) await shot('overlay');
  await key(''); // Escape
  await wait(700);
  const closed = await js('return !document.querySelector(\'input[type=search][role=combobox]\');');
  say('Escape closes it', closed ? 'ok' : 'FAIL — still open');
  // The real assertion: the SAME node got focus back, not merely "not body".
  const back = await js('return document.activeElement === document.querySelector("header a[href]");');
  const after = await js('return document.activeElement ? document.activeElement.outerHTML.slice(0,60) : "none";');
  say('focus after Escape', back ? 'ok — returned to the opener' : `FAIL — went to ${after.replace(/\s+/g, ' ')}`);
  // 4 — #450: DOES WEBKIT HIT-TEST THE DEAD BAND?
  //
  // global.css gives input[type=range] height:24px so the target meets WCAG
  // 2.2 AA 2.5.8. The PAINTED thumb is 13x13, so ~6px at the top and ~6px at
  // the bottom of the control are inside its box and outside anything visible.
  // Chromium hit-tests that strip (measured: a press 3px from the top moved
  // the value 8 -> 14). Whether WebKit does is the open question in #458.
  //
  // Actions API, not element.click() and not a synthesized MouseEvent: only a
  // trusted pointer goes through hit-testing, which is the entire thing under
  // test. A scripted click would pass whatever the answer is.
  console.log('\n=== #450  the 24px hit box, pressed where nothing is painted ===');
  await go('/c/attention');
  await wait(1200);

  const slider = await js('return document.querySelector("input[type=range]");');
  if (!slider || !slider[EL]) {
    say('slider', 'FAIL — no range input on /c/attention');
  } else {
    const sid = slider[EL];
    const geom = await js(`return (() => {
      const el = document.querySelector('input[type=range]');
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })();`);
    say('hit box', `${geom.w} x ${geom.h}` + (geom.h >= 24 ? '' : '  FAIL — under 24px'));

    const THUMB = 13;
    const halfDead = geom.h / 2 - THUMB / 2;        // ~5.5px of unpainted box
    const dyTop = -Math.round(geom.h / 2 - 3);      // 3px below the top edge
    const dyBottom = Math.round(geom.h / 2 - 3);    // 3px above the bottom edge
    say('dead band', `${halfDead.toFixed(1)}px top and bottom; pressing at dy=${dyTop} and dy=${dyBottom}`);

    // Offsets are from the element's CENTRE, per the W3C element origin.
    const at = (dx, dy) => ({ type: 'pointerMove', duration: 0, origin: { [EL]: sid }, x: dx, y: dy });
    const press = async (acts) => wd('POST', `/session/${s}/actions`,
      { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: acts }] });
    const value = () => js('return document.querySelector("input[type=range]").value;');
    const readout = () => js('return (document.querySelector("output") || {}).textContent || "";');

    const tap = async (label, dx, dy) => {
      const before = await value();
      await press([at(dx, dy), { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 120 }, { type: 'pointerUp', button: 0 }]);
      await wait(300);
      const after = await value();
      say(label, before !== after ? `ok — ${before} -> ${after}` : `FAIL — stayed at ${before}, nothing hit`);
      return before !== after;
    };

    const w = geom.w;
    await tap('press 3px below the TOP edge', Math.round(w * 0.30), dyTop);
    await tap('press 3px above the BOTTOM edge', -Math.round(w * 0.30), dyBottom);

    // The drag is the case 2.5.8 is really about: a fingertip lands nowhere
    // near the thumb's centre and then MOVES.
    const beforeDrag = await value();
    await press([
      at(-Math.round(w * 0.35), dyTop),
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 250, origin: 'pointer', x: Math.round(w * 0.5), y: 0 },
      { type: 'pointerUp', button: 0 },
    ]);
    await wait(300);
    const afterDrag = await value();
    say('drag starting in the dead band', beforeDrag !== afterDrag ? `ok — ${beforeDrag} -> ${afterDrag}` : `FAIL — stayed at ${beforeDrag}`);

    // Control. If this passes while the two above fail, the finding is clean:
    // only the painted thumb is hittable and the 24px box is decoration.
    await tap('CONTROL — press on the thumb row', Math.round(w * 0.45), 0);

    const out = await readout();
    say('the figure agrees', out.trim() !== '' ? `output reads "${out.trim()}"` : 'FAIL — output is empty');
    await shot('slider', { script: 'return document.querySelector("input[type=range]").parentElement;' });
  }

  // 5 — THE DEPTH TOGGLE. #458 names "all three depths" and the earlier passes
  //     never activated one: the tap-target guard queries [role="tab"], so it
  //     MEASURED the tabs and clicked none. A size check reading green is easy
  //     to mistake for coverage.
  //
  //     ADR-0005 makes this CSS-only — DepthToggle publishes data-depth on the
  //     scope and three rules decide which panel shows — so what is being tested
  //     is whether WebKit applies those attribute selectors, not whether some
  //     JavaScript ran.
  console.log('\n=== ADR-0005  the depth toggle, all three depths ===');
  await go('/c/attention');
  await wait(1200);

  const visible = () => js(`return (() => {
    const shown = ['intuition','engineer','math'].filter((d) => {
      const p = document.getElementById('body-' + d);
      return p && p.offsetParent !== null;
    });
    const tab = document.querySelector('[role="tab"][aria-selected="true"]');
    return {
      shown,
      selected: tab ? (tab.getAttribute('aria-controls') || '').replace('body-', '') : null,
      scope: (document.querySelector('[data-depth-scope]') || {}).dataset?.depth ?? null,
      // The VISIBLE PANEL's text, not main's. main starts with the breadcrumb,
      // the title and the tab labels, which are identical at every depth — so
      // comparing its first characters reported "nothing changed" while the
      // toggle was working perfectly.
      text: shown.map((d) => document.getElementById('body-' + d).innerText.slice(0, 120)).join('|'),
    };
  })();`);

  const first = await visible();
  say('opens on', `${first.selected} — panel(s) visible: ${first.shown.join(', ') || 'none'}`);

  let previous = first.text;
  for (const depth of ['engineer', 'math', 'intuition']) {
    await click(`[role="tab"][aria-controls="body-${depth}"]`);
    await wait(400);
    const v = await visible();
    const ok =
      v.selected === depth &&
      v.shown.length === 1 &&
      v.shown[0] === depth &&
      v.text !== previous &&
      v.text.length > 0;
    say(
      `${depth} tab`,
      ok
        ? `ok — one panel shown, aria-selected moved, body changed`
        : `FAIL — selected=${v.selected} visible=[${v.shown.join(',')}] textChanged=${v.text !== previous}`,
    );
    previous = v.text;
    // SHOOT THE DEPTH WE ARE ON, not whichever was clicked last. This used to
    // sit after the loop, so the file named for `math` pictured `intuition` —
    // the loop ends on intuition deliberately, to leave the page as a reader
    // would find it. The evidence has to be taken while the depth is selected.
    if (depth === 'math') await shot('depth-math');
  }

  // 6 — THE TRAIL RIBBON, which is really a localStorage test.
  //
  //     TrailRibbon.tsx: "After hydration it reads localStorage and shows the
  //     walk." Safari is the browser where that is most likely to differ — ITP
  //     evicts script-written storage after seven days without interaction, and
  //     Private Browsing has historically THROWN on write rather than returning
  //     null. This is the highest Safari-specific risk in the app and no pass
  //     had touched it.
  console.log('\n=== the trail ribbon (localStorage) ===');
  await go('/c/attention');
  await wait(300);
  await js('try { window.localStorage.clear(); } catch (e) {} return null;');

  const walk = ['attention', 'softmax'];
  for (const id of walk) {
    await go(`/c/${id}`);
    await wait(1200);
  }

  const trail = await js(`return (() => {
    let raw = null, threw = null;
    try { raw = window.localStorage.getItem('trail'); } catch (e) { threw = String(e); }
    let stops = null;
    try { stops = JSON.parse(raw || 'null'); } catch (e) {}
    const ribbon = document.querySelector('nav[aria-label="Your thread"]');
    return {
      threw,
      stored: Array.isArray(stops) ? stops.map((x) => x && x.id) : null,
      beads: ribbon ? ribbon.querySelectorAll('a[href^="/c/"]').length : -1,
      // DOUBLE BACKSLASH, AND IT MATTERS. This whole block is a TEMPLATE
      // LITERAL sent to the browser, and an untagged template eats an escaped
      // s down to a bare one — so this shipped as /s+/g and replaced the
      // letter "s" with spaces instead of collapsing whitespace. It passed
      // anyway, because the word it looks for, "trail", contains no s.
      header: (document.querySelector('header') || {}).innerText?.replace(/\\s+/g, ' ') ?? '',
    };
  })();`);

  if (trail.threw) {
    say('localStorage', `FAIL — threw: ${trail.threw}`);
  } else if (trail.stored === null) {
    say('localStorage', 'FAIL — nothing stored after walking two concepts');
  } else {
    const kept = trail.stored.join(' → ');
    say('localStorage survived', trail.stored.length === walk.length ? `ok — ${kept}` : `FAIL — ${kept}`);
  }
  say('ribbon beads', trail.beads >= 1 ? `ok — ${trail.beads} link(s) in the ribbon` : `FAIL — no ribbon rendered`);
  say('header count', /trail/i.test(trail.header) ? `ok — "${trail.header.match(/trail[^A-Z]*/i)?.[0]?.trim()}"` : 'FAIL — no trail count');
  await shot('trail-ribbon');

} finally {
  await wd('DELETE', `/session/${s}`).catch(() => {});
}

const fails = R.filter(([, v]) => String(v).startsWith('FAIL')).length;
console.log(`\n${fails} FAIL row(s). PNGs in ${OUT}/ — ${BROWSER}-search-field.png is the one to look at.`);
console.log('Left for a human: "Copy link" on a /t/ page. It creates a shared trail,');
console.log('so it is not done on a reader\'s behalf, and a window.prompt fallback');
console.log('would hang a driver rather than fail cleanly. See README.md.');
