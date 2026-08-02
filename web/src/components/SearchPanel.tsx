import { useCallback, useEffect, useRef, useState } from 'react';
import { search, type Entry, type Hit } from '../lib/search';

/**
 * Search — the overlay, and the engine behind /search.
 *
 * The handoff specifies search as an overlay over the current page rather than
 * a route, and that is the right primary experience: a reader looking something
 * up has not asked to leave the page they are on.
 *
 * But the landing page's field is a real `<form method="get">`, so with no
 * JavaScript it navigates. That is not a fallback bolted on afterwards — it is
 * why the markup is a form, and it is what makes `/search?q=…` a URL somebody
 * can bookmark or paste. Both paths run this component and therefore the same
 * matcher; there is no second implementation to drift (#106).
 *
 * The index is fetched WHEN SEARCH OPENS, never on page load. A concept page
 * must paint without waiting for anything, and most readers never search from
 * any given page.
 */

const TIER_DOT: Record<Entry['tier'], string> = {
  verified: 'bg-verified',
  frontier: 'bg-frontier',
};

type Index = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; entries: Entry[] } | { state: 'failed' };

interface Props {
  /** `overlay` opens over the current page; `page` is the /search route itself. */
  mode: 'overlay' | 'page';
  /** Pre-fill, used by /search to answer `?q=` on arrival. */
  initialQuery?: string;
}

export default function SearchPanel({ mode, initialQuery = '' }: Props) {
  const [open, setOpen] = useState(mode === 'page');
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState<Index>({ state: 'idle' });
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(() => {
    setIndex((current) => {
      if (current.state !== 'idle') return current;
      fetch('/search-index.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((entries: unknown) => {
          // A malformed index would render an empty panel that looks like "no
          // results" — a different and wrong answer to the question asked.
          if (Array.isArray(entries) && entries.every((e) => e && typeof e.id === 'string')) {
            setIndex({ state: 'ready', entries: entries as Entry[] });
          } else {
            setIndex({ state: 'failed' });
          }
        })
        .catch(() => setIndex({ state: 'failed' }));
      return { state: 'loading' };
    });
  }, []);

  // On /search the panel IS the page: load the index at once, and take the
  // question from the URL. Read here rather than templated in by Astro — the
  // page is built once and served to every query, so the URL is the only place
  // the question exists. Poking the input's .value from a script would not
  // work either: React tracks its own value and ignores a direct assignment.
  useEffect(() => {
    if (mode !== 'page') return;
    load();
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setQuery(q);
  }, [mode, load]);

  // `/` from anywhere opens it, the convention every search field on the web
  // has trained people to expect. Ignored while typing somewhere else.
  useEffect(() => {
    if (mode !== 'overlay') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
        load();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, load]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const hits: Hit[] = index.state === 'ready' ? search(index.entries, query) : [];

  useEffect(() => setCursor(0), [query]);

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelectorAll('a')[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && mode === 'overlay') {
      setOpen(false);
      return;
    }
    if (hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[cursor];
      if (hit) window.location.href = `/c/${hit.id}`;
    }
  };

  const panel = (
    <div
      className={
        mode === 'overlay'
          ? 'w-full max-w-[560px] rounded-island border border-line bg-nebula p-6'
          : ''
      }
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-3 rounded-control border border-thread bg-void px-4 py-3">
        <label htmlFor="search-q" className="sr-only">
          Search concepts
        </label>
        <input
          id="search-q"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search concepts"
          autoComplete="off"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="search-results"
          aria-activedescendant={hits[cursor] ? `hit-${hits[cursor].id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-starlight outline-none placeholder:text-dust"
        />
        {mode === 'overlay' && (
          <kbd className="shrink-0 rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-dust">
            ESC
          </kbd>
        )}
      </div>

      {/* Announced to a screen reader as the count changes, not just drawn. */}
      <p className="sr-only" role="status">
        {index.state === 'failed'
          ? 'The search index could not be loaded.'
          : query.trim() === ''
            ? ''
            : `${hits.length} ${hits.length === 1 ? 'result' : 'results'} for ${query}`}
      </p>

      {index.state === 'failed' && (
        <p className="mt-3 text-[13.5px] text-starlight" role="alert">
          The search index could not be loaded.{' '}
          <a href="/concepts" className="text-thread underline">
            Browse every concept instead
          </a>
          .
        </p>
      )}

      {index.state === 'ready' && query.trim() !== '' && hits.length === 0 && (
        // Never a dead end: nothing matched, but the graph is still here.
        <p className="mt-3 text-[13.5px] text-dust">
          Nothing matches “{query}”.{' '}
          <a href="/concepts" className="text-thread underline">
            Browse every concept
          </a>{' '}
          or keep typing.
        </p>
      )}

      {hits.length > 0 && (
        <ul id="search-results" ref={listRef} role="listbox" className="mt-3 max-h-[50vh] list-none overflow-y-auto p-0">
          {hits.map((hit, i) => (
            <li key={hit.id} role="option" aria-selected={i === cursor} id={`hit-${hit.id}`}>
              <a
                href={`/c/${hit.id}`}
                onMouseEnter={() => setCursor(i)}
                className={[
                  'mb-[7px] flex min-h-11 items-center justify-between gap-3 rounded-row border bg-void px-[11px] py-[9px] text-[13.5px] no-underline',
                  i === cursor ? 'border-thread text-starlight' : 'border-line text-starlight',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block truncate">{hit.title}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-[.12em] text-dust">
                    {hit.domain}
                  </span>
                </span>
                {/* Tier is never colour alone, here as everywhere. */}
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-dust">
                  {hit.tier}
                  <span className={`inline-block h-[7px] w-[7px] rounded-full ${TIER_DOT[hit.tier]}`} aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (mode === 'page') return panel;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          load();
        }}
        className="cursor-pointer rounded-row border border-line bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[.12em] text-dust hover:border-thread hover:text-starlight"
      >
        Search <span className="max-md:hidden">/</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          style={{ background: 'color-mix(in srgb, var(--color-void) 60%, transparent)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Search concepts"
        >
          {panel}
        </div>
      )}
    </>
  );
}
