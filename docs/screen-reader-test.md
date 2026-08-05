# Screen reader test script

The session [#126](https://github.com/opendroid/the-infinity/issues/126) and
[#144](https://github.com/opendroid/the-infinity/issues/144) are waiting on. Roughly 40
minutes, on the deployed site, with ears.

**Read this first, because #144's issue body is stale.** It ends with *"Options, none
chosen"*. Option 1 shipped: [ADR-0010](adr/0010-speaking-the-notation.md) emits a
visually-hidden ` sub ` / ` super ` around every group, and its status says so plainly —
*"accepted — shipped ahead of the listen that would confirm it."* So this is not a
bug hunt. It is a **confirm-or-reject of a fix already in production**, and the specific
risk the ADR named on itself is verbosity.

---

## Setup — 5 minutes

**macOS · VoiceOver** (built in, nothing to install)

| | |
|---|---|
| Toggle on/off | `Cmd F5` |
| VO key | `Control Option` — written `VO` below |
| Read from here | `VO A` |
| Next / previous item | `VO →` / `VO ←` |
| Activate | `VO Space` |
| Stop talking | `Control` |

Turn the speech rate **down** before starting — the default is too fast to catch a missing
word, which is the whole thing being tested for.

**Windows · NVDA** (free, nvaccess.org): `Ctrl Alt N` to start, NVDA key is `Insert`,
`Insert ↓` reads all.

Either is fine. If you have both, do §1 on both — the two differ most exactly where this
matters.

---

## 1 · The math — #144 — 10 minutes

**The quickest win, and the one that unblocks an ADR.** Three pages, linked straight to
Math depth so there is nothing to click:

- <https://theinfinity.ai/c/multi-head-attention?depth=math>
- <https://theinfinity.ai/c/mixture-of-experts?depth=math>
- <https://theinfinity.ai/c/attention?depth=math>

Navigate to the body text and read it. **What the accessibility tree now contains**, taken
from the real `spoken()` in `web/src/lib/notation.ts` rather than guessed:

> **multi-head-attention**
> MultiHead(X) = Concat(head sub 1 ,…,head sub h )W sub O where head sub i = Attention(XW sub Q super i , XW sub K super i , XW sub V super i ) and W sub O ∈ ℝ super h·d sub v ×d sub model . With d sub k = d sub v = d sub model /h …

*(Every space shown inside a group is U+00A0, not an ordinary space. That distinction is
invisible here and is the whole reason the first attempt failed.)*

> **attention**
> Attention(Q,K,V) = softmax(QKᵀ / √d sub k ) · V, with Q ∈ ℝ super n×d sub k , K ∈ ℝ super m×d sub k , V ∈ ℝ super m×d sub v .

> **mixture-of-experts**
> …y = Σ sub i∈T (g sub i / Σ sub j∈T g sub j ) · E sub i (x)…

### The four questions

1. ~~**Is the separator actually spoken?**~~ **ANSWERED — failed once, then fixed and
   confirmed (2026-08-05).** It first read "headsub1", "WsubO", "XWsubQsuperi": the words
   reached the tree and the spaces did not, because `sr-only` is absolutely positioned and
   CSS strips collapsible whitespace at the edges of a block container. The separator is
   U+00A0 now, and VoiceOver reads "d sub model". See
   [ADR-0010](adr/0010-speaking-the-notation.md), *What the listen found*.
2. ~~**Does `sub` say "sub" or "s-u-b"?**~~ **ANSWERED — it says the word.** It did not
   land in the trap that ruled out `sup`, so the word choice holds.
3. **Is `multi-head-attention` now too long to follow?** This is the real question. Nine
   separators in one sentence is what the ADR bought precision with, and it defended the
   cost without hearing it. If the sentence has become unfollowable, that is a finding and
   the ADR needs revising a second time.
4. **Does `Σ sub i∈T` survive?** The set-membership superscript is the worst case in the
   corpus. If it is unintelligible, MathML (option 3) comes back on the table.

**Questions 3 and 4 are the ones still open, and they are the whole of #144 now.** The
mechanism is settled; what is not is whether the trade was worth making. Both need
`multi-head-attention` and `mixture-of-experts` read end to end at Math depth — about a
minute each, with VoiceOver already running.

**Record the actual words.** Not "it was fine" — the sentence as spoken. That string is the
fixture the next decision rests on.

---

## 2 · Landing — #126 — 5 minutes

<https://theinfinity.ai>

- [ ] With eyes closed from a cold start: **does the first ten seconds say what this is?**
- [ ] The lemniscate is `aria-hidden`. Confirm it is silent — and that the page is not
      silent *with* it
- [ ] Does focus land somewhere sensible? The search field is the one glowing element on
      screen; it should be findable by ear too
- [ ] Tier dots carry text (`TierDot.astro` renders an `sr-only` tier name). Confirm you
      hear "verified" / "frontier" and not just a colour you cannot see

## 3 · A concept page — 10 minutes

<https://theinfinity.ai/c/attention>

- [ ] **The depth toggle is a `tablist`.** `Tab` to it, then `←` `→` `Home` `End`. Each
      should move focus *and* selection, and announce the new depth. #138 fixed the
      keyboard half; nobody has heard the announcement
- [ ] **Only one viz summary should be read.** ADR-0005 renders every depth variant and
      hides all but one. `display:none` removes a subtree from the tree — so if you hear
      two summaries, or the wrong one, that is the failure ADR-0005 assumed away
- [ ] **Edge groups.** Requires ◂ / Unlocks ▸ / Adjacent ↔ — `EdgeRow.astro` adds an
      `sr-only` aside per type. Are the three distinguishable **by ear**, or do they all
      read as an undifferentiated list of links?
- [ ] Switch to Math depth and confirm §1 behaves the same here as on the exhibit pages

## 4 · Search and the overlay — 5 minutes

<https://theinfinity.ai/search>, then the overlay from any page

- [ ] What is announced **when the overlay opens**? Focus is trapped and returned (#45),
      verified by tabbing and never by listening
- [ ] Type a query. `SearchPanel.tsx` has a `role="status"` for results and a `role="alert"`
      for errors — is the result count announced, or does it change silently?
- [ ] `↑` `↓` through results, `Enter` to choose, `Esc` to leave. Does focus come back to
      the opener audibly?

## 5 · A trail — 3 minutes

Walk three or four concepts, save the trail, open the share link.

- [ ] Does the stop list read as an **ordered path** — "1 of 4" — or as a flat list?
- [ ] `TrailRibbon.tsx` has a `role="alert"` on its error line. Force it if you can
      (offline, then save) and confirm it speaks

## 6 · The write paths — 5 minutes

Request a concept at <https://theinfinity.ai/request>, and flag something.

- [ ] **Is the confirmation announced?** This is the one #126 called out specifically: a
      `role="status"` only works if the node existed *before* the update. `LiveRegion.tsx`
      renders always for exactly this reason — confirm that it works
- [ ] Submit something invalid. Is the failure announced, or does it appear silently?

---

## What counts as done

- **#144** — the spoken form of `multi-head-attention` written down verbatim, plus a
  yes/no on whether the verbosity is acceptable. If yes, ADR-0010's status note comes off
  and #144 closes. If no, it needs a third ADR and MathML is the live option.
- **#126** — each box above ticked or turned into its own issue. The issue is the
  verification; findings are separate work.

**Every finding is its own issue.** Do not try to fix anything during the session — the
listening is the scarce resource, and stopping to fix loses the thread.

Automated tooling (axe, pa11y) is worth adding *after* this, not instead of it. It would
catch contrast and missing labels, and would have caught none of the six risks above.
