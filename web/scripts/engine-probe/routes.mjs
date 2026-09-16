#!/usr/bin/env node
/* Engine probe, part one: probe.js across all five routes (#458).
 *
 *   safaridriver -p 4444 &                                # in its own tab
 *   node scripts/engine-probe/routes.mjs                  # Safari on :4444
 *
 *   geckodriver --port 4444 &
 *   BROWSER=firefox node scripts/engine-probe/routes.mjs  # Gecko
 *
 * Env: DRIVER (default http://localhost:4444) · BROWSER (default safari)
 *      ORIGIN (default https://theinfinity.ai) · PROBE (default ./probe.js)
 *      EXTRA_CAPS (JSON merged into alwaysMatch — how to name a browser binary)
 *
 * Read-only: navigates and measures. Submits nothing, shares nothing.
 */
import { readFileSync } from 'node:fs';

const DRIVER = process.env.DRIVER ?? 'http://localhost:4444';
const BROWSER = process.env.BROWSER ?? 'safari';
const ORIGIN = process.env.ORIGIN ?? 'https://theinfinity.ai';
const PROBE = process.env.PROBE ?? new URL('./probe.js', import.meta.url).pathname;
const ROUTES = ['/', '/concepts', '/c/attention', '/search?q=attention', '/request'];

async function wd(method, path, body) {
  const res = await fetch(DRIVER + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) {
    const v = json.value ?? {};
    throw new Error(`${method} ${path} -> ${res.status} ${v.error ?? ''}: ${v.message ?? JSON.stringify(json)}`);
  }
  return json.value;
}

// The probe is an IIFE expression; execute/sync wants a function BODY.
const src = readFileSync(PROBE, 'utf8')
  .replace("return R.filter(r=>r[0]==='FAIL').length + ' failure(s) — copy the table above';", 'return R;');
const script = 'return ' + src.replace(/^[\s\S]*?(?=\(\(\) =>)/, '');

const caps = { capabilities: { alwaysMatch: { browserName: BROWSER, ...JSON.parse(process.env.EXTRA_CAPS ?? '{}') } } };

let sessionId;
try {
  ({ sessionId } = await wd('POST', '/session', caps));
} catch (e) {
  console.error('\nCould not start a session:', e.message);
  // THE HINT HAS TO MATCH THE ENGINE. This printed Safari's toggle instructions
  // at a Firefox run that could not find the browser binary, which sends the
  // reader to a settings pane that has nothing to do with the failure.
  if (BROWSER === 'safari') {
    console.error('\nFor Safari this is almost always the toggle, not the driver:');
    console.error('  Safari > Settings > Advanced > "Show features for web developers"');
    console.error('  then Develop > Allow Remote Automation\n');
  } else if (BROWSER === 'firefox') {
    console.error('\nFor Firefox, geckodriver is not the browser — install it, or say where it is:');
    console.error('  brew install --cask firefox');
    console.error('  # or, if it lives somewhere non-default (note: the binary, not the .app):');
    console.error("  EXTRA_CAPS='{\"moz:firefoxOptions\":{\"binary\":\"/Applications/Firefox.app/Contents/MacOS/firefox\"}}' \\");
    console.error('    BROWSER=firefox node scripts/engine-probe/routes.mjs\n');
  } else {
    console.error(`\nCheck that a driver for ${BROWSER} is listening on ${DRIVER}.\n`);
  }
  process.exit(1);
}

let failures = 0;
try {
  for (const route of ROUTES) {
    await wd('POST', `/session/${sessionId}/url`, { url: ORIGIN + route });
    await new Promise((r) => setTimeout(r, 1200)); // islands hydrate on idle
    let rows;
    try {
      rows = await wd('POST', `/session/${sessionId}/execute/sync`, { script, args: [] });
    } catch (e) {
      console.log(`\n=== ${route} ===\n  PROBE THREW: ${e.message}`);
      failures++;
      continue;
    }
    console.log(`\n=== ${route} ===`);
    for (const [status, check, detail] of rows) {
      if (status.trim() === 'FAIL') failures++;
      console.log(`${status} ${String(check).padEnd(30)} ${String(detail).slice(0, 90)}`);
    }
  }
} finally {
  await wd('DELETE', `/session/${sessionId}`).catch(() => {});
}

console.log(`\n${failures} FAIL row(s) across ${ROUTES.length} routes on ${BROWSER}.`);
console.log('Still needs eyes: how many ✕ in the search box, the slider drag, the / shortcut,');
console.log('Copy link on a /t/ page, and 320px reflow. See laptop-prompt.md.');
