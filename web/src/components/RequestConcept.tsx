import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl } from '../lib/api';
import { postQueue } from '../lib/submit';

/**
 * The 404's interactive half: the slug that was asked for, the concepts nearest
 * to it, and the form that queues a request for it.
 *
 * All three need the browser, and for the same reason: this page is one
 * pre-rendered `404.html` that Hosting serves for every unmatched path, so at
 * build time it cannot know which slug a reader typed. What it *can* do is not
 * depend on any of it — the static shell below already says the graph has a gap
 * and offers a way back in, so everything here is an improvement on a page that
 * already works.
 */

interface Nearest {
  id: string;
  title: string;
  tier: 'verified' | 'frontier';
}

/** Reads the concept slug out of /c/<slug>. Null for any other path. */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = decodeURIComponent(match[1] ?? '');
  // Same rule the API enforces. A path that cannot be a concept id is not a
  // missing concept, so asking about it would be asking a broken question.
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 64
    ? slug
    : null;
}

type Submission =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'queued' }
  | { state: 'error'; message: string };

const TIER_DOT: Record<Nearest['tier'], string> = {
  verified: 'bg-verified',
  frontier: 'bg-frontier',
};

export default function RequestConcept() {
  // The form posts JSON, so it cannot work without JavaScript. Rendering it in
  // the static HTML would put a button on the page that silently does nothing
  // when clicked — worse than not offering it, because the reader has already
  // typed by the time they find out. Gated on mount so the server-rendered page
  // shows the gap and the way back, and nothing that lies.
  const [mounted, setMounted] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [nearest, setNearest] = useState<Nearest[]>([]);
  const [name, setName] = useState('');
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' });

  useEffect(() => {
    setMounted(true);
    const found = slugFromPath(window.location.pathname);
    setSlug(found);
    if (found) setName(found.replace(/-/g, ' '));
    if (!found) return;

    // The 404 body already carries suggestions, so this is one request rather
    // than a search. A failure here costs nothing: the page keeps its static
    // way back into the graph.
    const controller = new AbortController();
    fetch(apiUrl(`/concepts/${encodeURIComponent(found)}`), { signal: controller.signal })
      .then((res) => (res.status === 404 ? res.json() : null))
      .then((body: unknown) => {
        if (body && typeof body === 'object' && 'nearest' in body) {
          const list = (body as { nearest: unknown }).nearest;
          if (Array.isArray(list)) setNearest(list as Nearest[]);
        }
      })
      .catch(() => {
        /* offline, or the API is asleep. The page is still a page. */
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setSubmission({ state: 'error', message: 'Give the concept a name first.' });
      return;
    }

    setSubmission({ state: 'sending' });
    // Same mapping as the review actions: the reason-per-status lives in one
    // place so the two public writes cannot drift on what they tell a reader.
    const result = await postQueue(
      '/requests',
      { name: name.trim(), referrer: window.location.pathname },
      'That name was not accepted. Try a shorter one.',
    );
    setSubmission(result.ok ? { state: 'queued' } : { state: 'error', message: result.message });
  }

  return (
    <>
      <p className="mt-2.5 max-w-[62ch] text-[15px] leading-[1.65] text-dust">
        {slug ? (
          <>
            Nothing is published at <code className="font-mono text-[13.5px] text-starlight">/c/{slug}</code> yet.
          </>
        ) : (
          <>That page is not part of the graph.</>
        )}
      </p>

      {!mounted ? null : submission.state === 'queued' ? (
        <p
          className="mt-5 rounded-control border border-line bg-nebula px-3.5 py-3 text-[14px] text-starlight"
          role="status"
        >
          Requested. It joins the queue for review — the graph grows by someone deciding it should.
        </p>
      ) : (
        <form className="mt-5 flex flex-wrap gap-2.5" onSubmit={submit}>
          <label className="sr-only" htmlFor="concept-name">
            Name the concept you were looking for
          </label>
          <input
            id="concept-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Name the concept"
            maxLength={120}
            required
            className="min-w-0 flex-1 rounded-control border border-line bg-void px-3 py-2.5 text-[14px] text-starlight placeholder:text-dust"
          />
          <button
            type="submit"
            disabled={submission.state === 'sending'}
            className="rounded-control bg-thread px-4 py-2.5 text-[14px] font-medium text-void disabled:opacity-60"
          >
            {submission.state === 'sending' ? 'Sending…' : 'Request this concept'}
          </button>
        </form>
      )}

      {submission.state === 'error' && (
        // Not carried by colour alone: the text says what happened.
        <p className="mt-2.5 text-[13.5px] text-starlight" role="alert">
          {submission.message}
        </p>
      )}

      {nearest.length > 0 && (
        <section className="mt-8 border-t border-line pt-6">
          <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[.17em] text-dust">Nearest nodes</h3>
          {nearest.map((n) => (
            <a
              key={n.id}
              href={`/c/${n.id}`}
              className="mb-[7px] flex min-h-11 items-center justify-between gap-2 rounded-row border border-line bg-nebula px-[11px] py-[9px] text-[13.5px] text-starlight no-underline hover:border-thread"
            >
              <span>{n.title}</span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-dust">
                {n.tier}
                <span className={`inline-block h-[7px] w-[7px] rounded-full ${TIER_DOT[n.tier]}`} aria-hidden="true" />
              </span>
            </a>
          ))}
        </section>
      )}
    </>
  );
}
