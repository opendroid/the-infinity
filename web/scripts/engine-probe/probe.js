/* theinfinity.ai — engine probe for #458. READ-ONLY: measures the DOM, sends
   nothing, creates no server state. Paste into the Safari console on each of
   /, /concepts, /c/attention, /search?q=attention, /request  */
(() => {
  const R = [], ok = (k,v)=>R.push(['ok  ',k,v]), bad = (k,v)=>R.push(['FAIL',k,v]), na = (k,v)=>R.push(['--  ',k,v]);
  const cs = (el,p)=>getComputedStyle(el).getPropertyValue(p).trim();

  // engine + page
  na('engine', navigator.userAgent);
  na('page', location.pathname + location.search);
  na('viewport', innerWidth + 'x' + innerHeight + ' dpr' + devicePixelRatio);

  // 1. design tokens resolve (Tailwind v4 leans on @property; old engines drop it)
  const bg = cs(document.body,'background-color'), thread = cs(document.documentElement,'--color-thread');
  (bg.replace(/\s/g,'')==='rgb(11,14,26)' ? ok : bad)('tokens: body background', bg + '  (want rgb(11, 14, 26))');
  (thread.toLowerCase()==='#8f7bff' ? ok : bad)('tokens: --color-thread', thread + '  (want #8F7BFF)');

  // 2. fonts actually loaded, not silently falling back
  // NOT document.fonts.check(): it returns true when NO @font-face matches, so a
  // blocked font CDN reads as a pass. Count actually-loaded faces instead.
  ['Unbounded','Schibsted Grotesk','JetBrains Mono'].forEach(f => {
    const loaded = [...document.fonts].filter(x => x.family.replace(/["']/g,'') === f && x.status === 'loaded').length;
    (loaded > 0 ? ok : bad)('font loaded: '+f, loaded + ' face(s)');
  });

  // 3. no horizontal scroll (WCAG 1.4.10 reflow) — resize to 320px wide and re-run
  const sw = document.documentElement.scrollWidth;
  (sw <= innerWidth + 1 ? ok : bad)('reflow: no h-scroll', `scrollWidth ${sw} vs viewport ${innerWidth}`);

  // 4. standalone tap targets >= 24px (WCAG 2.5.8) — same rule CI runs, inline links exempt
  const small = [];
  document.querySelectorAll('a[href],button,[role="tab"]').forEach(el => {
    if (el.offsetParent === null) return;
    const parent = el.parentElement;
    const neighbours = parent ? [...parent.childNodes].filter(n => n!==el && (n.textContent||'').trim()!=='').length : 0;
    if (getComputedStyle(el).display === 'inline' && neighbours > 0) return;
    const b = el.getBoundingClientRect();
    if (b.height > 0 && b.height < 24) small.push(`"${(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,22)}" ${Math.round(b.height)}px`);
  });
  (small.length===0 ? ok : bad)('tap targets >= 24px', small.length ? small.join(', ') : 'all pass');

  // 5. #450 the slider's HIT BOX (not the painted thumb) — engine-specific
  const rng = document.querySelector('input[type=range]');
  if (!rng) na('#450 slider', 'none on this page');
  else { const b = rng.getBoundingClientRect();
    (b.height >= 24 ? ok : bad)('#450 slider hit box', `${Math.round(b.width)}x${Math.round(b.height)} (want height >= 24)`); }

  // 6. #472 exactly ONE clear control — the whole point was Chromium/Safari
  //    drawing a native one beside ours. A script cannot see the native ✕;
  //    count ours, then LOOK at the field.
  // role=combobox is what distinguishes the island's field from the landing
  // page's plain GET form, which has no clear control BY DECISION (ADR-0023).
  const si = document.querySelector('input[type=search][role=combobox]');
  const plain = document.querySelector('input[type=search]:not([role=combobox])');
  if (!si) na('#472 search field', plain
      ? 'this page has the plain GET form (ADR-0023), not the island — no clear control expected'
      : 'none on this page — press / to open the overlay, or go to /search');
  else { const mine = document.querySelectorAll('[aria-label="Clear search"]');
    (mine.length===1 ? ok : bad)('#472 our clear control', mine.length + ' found (want exactly 1)');
    if (mine[0]) { const b = mine[0].getBoundingClientRect();
      (b.width>=24 && b.height>=24 ? ok : bad)('#472 clear control size', `${Math.round(b.width)}x${Math.round(b.height)}`); }
    na('#472 EYEBALL THIS', 'how many ✕ do you see in the box? 1 = correct, 2 = native one leaked through'); }

  // 7. #468 the results listbox: option role on the anchor, nothing nested
  const lb = document.querySelector('[role="listbox"]');
  if (!lb) na('#468 listbox', 'no results on screen — search for "attention" first');
  else { const opts = lb.querySelectorAll('[role="option"]');
    (opts.length>0 ? ok : bad)('#468 options present', opts.length);
    const nested = [...opts].filter(o => o.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
    (nested.length===0 ? ok : bad)('#468 no nested interactive', nested.length ? nested.length+' option(s) contain a focusable child' : 'clean');
    const ad = document.querySelector('[aria-activedescendant]');
    (ad ? ok : na)('#468 aria-activedescendant', ad ? ad.getAttribute('aria-activedescendant') : 'not set (only set once you arrow down)'); }

  // 8. focus ring paints (handoff: 2px thread violet, offset 2)
  const first = document.querySelector('a[href],button');
  if (first) { first.focus();
    const o = cs(first,'outline-color') + ' / ' + cs(first,'outline-width');
    na('focus ring on first control', o + '  — and LOOK: is it visible?'); first.blur(); }

  console.log('%c' + location.pathname + location.search, 'font-weight:bold');
  console.table(R.map(([s,k,v])=>({status:s,check:k,detail:v})));
  return R.filter(r=>r[0]==='FAIL').length + ' failure(s) — copy the table above';
})();
