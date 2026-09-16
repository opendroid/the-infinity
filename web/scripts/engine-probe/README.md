# The engine probe

Three engines have been driven against production and agreed: **desktop Safari 26.6.2
(WebKit)**, **Firefox 156 (Gecko)** and **Chromium**, plus **Safari 26.6.1 on a real
iPhone** by hand. That is [#458](https://github.com/opendroid/the-infinity/issues/458),
closed on evidence.

These scripts are how the first two were done, committed so the next person can re-run them
([#497](https://github.com/opendroid/the-infinity/issues/497)). Four long issue comments are
a record of a pass; they are not a pass anyone can repeat.

**They are not in CI, and that is deliberate.** [ADR-0016](../../../docs/adr/0016-a-browser-smoke-test.md)
already decided that a browser matrix buys install time and flakiness for a static site.
`npm run smoke` stays the automated check, on Chromium. This is the manual pass, run by a
person after a change that could plausibly differ by engine — a new island, a CSS
`appearance: none`, anything touching focus or storage.

| file | what it does |
|---|---|
| `probe.js` | The engine-neutral DOM probe. Tokens, loaded font faces, horizontal scroll, tap-target sizes, the #472 clear control, the #468 listbox, the focus ring. Injected into the page; it is an IIFE, not a module. |
| `routes.mjs` | Runs the probe across `/`, `/concepts`, `/c/attention`, `/search?q=attention` and `/request`. |
| `interactions.mjs` | The checks a DOM probe cannot make: the slider's 24px hit box including its dead band, reflow at 320px, the `/` shortcut and focus return, the depth toggle at all three depths, the trail ribbon via `localStorage`. Writes screenshots. |

## Running it

Each browser has its own W3C WebDriver server. Start one, leave it running, then run both
scripts against it from `web/`.

### Safari

```sh
safaridriver -p 4444              # terminal 1
node scripts/engine-probe/routes.mjs
node scripts/engine-probe/interactions.mjs
```

`safaridriver` refuses to start until remote automation is enabled, which is two settings
panes and not obvious:

> Safari → Settings → Advanced → **Show features for web developers**,
> then Develop → **Allow Remote Automation**

If it reports `Address already in use`, an earlier `safaridriver` still holds the port —
`lsof -i :4444` names it.

### Firefox

```sh
geckodriver --port 4444           # terminal 1
BROWSER=firefox node scripts/engine-probe/routes.mjs
BROWSER=firefox node scripts/engine-probe/interactions.mjs
```

**geckodriver is not Firefox.** `brew install geckodriver` installs the driver alone, and a
run without the browser fails with *"unable to find binary in default location"*. Install
it with `brew install --cask firefox`, or name it — note the path ends at the binary
**inside** the bundle, not at the `.app`:

```sh
EXTRA_CAPS='{"moz:firefoxOptions":{"binary":"/Applications/Firefox.app/Contents/MacOS/firefox"}}' \
  BROWSER=firefox node scripts/engine-probe/routes.mjs
```

### Chromium

`npm run smoke` already covers Chromium and runs in CI. Driving it here needs a matching
`chromedriver`, and a mismatched pair fails in ways that look like site defects rather than
version skew.

## Environment

| | |
|---|---|
| `DRIVER` | WebDriver server (default `http://localhost:4444`) |
| `BROWSER` | `browserName` capability (default `safari`) |
| `ORIGIN` | site under test (default `https://theinfinity.ai`) |
| `OUT` | screenshot directory (default `probe-shots/`, gitignored) |
| `EXTRA_CAPS` | JSON merged into `alwaysMatch` |
| `PROBE` | probe file, `routes.mjs` only (default `./probe.js`) |

## What it will not do

**Read-only against production, on purpose.** It navigates, resizes, presses keys and
clicks. It never submits `/request`, which writes a document to Firestore, and never
activates "Copy link" on a `/t/` page, which creates a shared trail. Neither is done on a
reader's behalf, so both are left for a human — and "Copy link" additionally would hang a
driver rather than fail cleanly, because a `window.prompt` fallback blocks the session.

`safaridriver` is **macOS-only and cannot drive iPhone Safari**. The iPhone half of #458 was
done over USB through Web Inspector, pasting `probe.js` into the console. Appium plus
WebDriverAgent could automate it and costs more than the hour #458 budgeted.

## Things that cost an afternoon to learn

- **`execute/sync` takes a function BODY, not an expression.** `routes.mjs` wraps the probe
  IIFE in `return …` for exactly this reason.
- **Element-origin pointer offsets are measured from the element's CENTRE**, not its
  top-left. The slider's dead-band presses depend on it.
- **A returned `Node` comes back as an element reference**, which is how a screenshot gets
  framed on an element that has no stable selector — our ✕ is a *sibling* of the input, so
  an input-only frame crops it out and reads as "no clear control at all".
- **`document.fonts.check()` returns true when no `@font-face` matches at all**, which makes
  it vacuous as a font-loaded test. `probe.js` counts loaded faces instead.
- **`:focus-visible` correctly does not match focus arriving without a keyboard.** On iOS
  that yields `currentColor` at the UA default width — not a missing style.
- **Plant the defect before trusting the check.** Two of these checks were wrong first: the
  depth check compared the first characters of `main`, which are the breadcrumb and the tab
  labels and identical at every depth; and the first `localStorage` plant did not plant,
  because navigation reloads the page and destroyed the override before the read.
