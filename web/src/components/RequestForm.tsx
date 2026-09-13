import { useEffect, useState, type FormEvent } from 'react';
import { postQueue } from '../lib/submit';
import LiveRegion from './LiveRegion';

/**
 * The form behind `/request` — the destination the empty edge group has been
 * pointing at.
 *
 * The handoff specifies "one mono violet suggest action" on an empty group, and
 * it was built: `<a href="/request">Suggest an edge</a>`. The route did not
 * exist, so on 40 concept pages with no `adjacent`, 22 with no `unlocks` and 9
 * with no `requires`, the one thing the empty state offered was a 404 (#53).
 * An empty box is better than a door that opens onto a wall.
 *
 * It posts to the same `POST /api/v1/requests` the 404 page uses, because a
 * gap is a gap: a concept nobody wrote and an edge nobody drew both end up in
 * the same queue, and `make queues` is where a human reads them (#116).
 *
 * NOT server-rendered, for the reason every write here is not: it posts JSON,
 * and a control that cannot work without JavaScript must not appear as though
 * it can. The page around it says what to do instead.
 */

type State =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'queued' }
  | { name: 'error'; message: string };

const MAX_NAME = 120;

/** Where the reader came from, if it was one of ours. */
export function contextFrom(search: string, referrer: string): string {
  const from = new URLSearchParams(search).get('from') ?? '';
  // Only a path of ours. A full URL from an untrusted referrer would put
  // someone else's origin into our queue.
  if (/^\/[\w\-/]*$/.test(from)) return from;
  try {
    const url = new URL(referrer);
    return url.origin === window.location.origin ? url.pathname : '';
  } catch {
    return '';
  }
}

/**
 * The half-written edge to start the reader off, for a context that names a
 * concept. "" when it does not.
 *
 * The entry point is "Suggest an edge" on a concept page, so the reader has
 * already said which concept they mean by pressing a link attached to it — and
 * then had to type it again (#471). The page itself teaches this exact shape:
 * its placeholder reads "A concept, or an edge — speculative decoding ↔
 * kv-cache", so a prefilled "attention ↔ " completes a pattern the form already
 * demonstrates rather than inventing one.
 *
 * THE SLUG, NOT A PRETTIED-UP TITLE. Only the path is known here; deriving a
 * title from it would turn "kv-cache" into "Kv Cache", which is wrong, and the
 * placeholder's own example uses "kv-cache" unmodified. A slug is exact and a
 * guessed title is not.
 *
 * Pure and string-taking so the shapes it must ignore — /request itself, a
 * referrer that is not a concept — are testable without a DOM.
 */
export function seededName(context: string): string {
  const slug = /^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(context)?.[1];
  return slug ? `${slug} ↔ ` : '';
}

const QUEUED =
  'Noted. It joins the queue for a human to read — nothing has been added to the graph yet, and it grows by someone deciding it should.';

export default function RequestForm() {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<State>({ name: 'idle' });
  const [context, setContext] = useState('');

  useEffect(() => {
    setMounted(true);
    const ctx = contextFrom(window.location.search, document.referrer);
    setContext(ctx);
    // Only ever a starting point: set once on arrival, never re-applied, so it
    // cannot fight the reader as they edit or clear it.
    const seed = seededName(ctx);
    if (seed !== '') setName(seed);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // In flight already: the guard is what prevents a second send, because the
    // button stays enabled and focusable (#405).
    if (state.name === 'sending') return;
    if (name.trim().length < 2) {
      setState({ name: 'error', message: 'Give it a name first — two characters at least.' });
      return;
    }
    setState({ name: 'sending' });
    const result = await postQueue(
      '/requests',
      { name: name.trim(), referrer: context || window.location.pathname },
      // The fallback only fires when the API did not say why, so it does not
      // guess either — it used to assert "try a shorter one" (#447).
      'That name was not accepted.',
    );
    setState(result.ok ? { name: 'queued' } : { name: 'error', message: result.message });
  }

  if (!mounted) return null;

  const queued = state.name === 'queued' ? QUEUED : '';

  return (
    <>
      {/* Present before it has anything to say, so the change is announced (#137). */}
      <LiveRegion
        message={queued}
        takeFocus
        className="mt-5 rounded-control border border-line bg-nebula px-3.5 py-3 text-[14px] text-starlight"
      />

      {queued === '' && context !== '' && (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[.14em] text-dust">
          From <span className="text-starlight">{context}</span>
        </p>
      )}

      {queued === '' && (
        <form className="mt-4 flex flex-wrap gap-2.5" onSubmit={(e) => void submit(e)}>
          <label className="sr-only" htmlFor="request-name">
            What is missing?
          </label>
          <input
            id="request-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="A concept, or an edge — “speculative decoding ↔ kv-cache”"
            maxLength={MAX_NAME}
            required
            className="min-w-0 flex-1 rounded-control border border-thread bg-void px-3 py-2.5 text-[14px] text-starlight placeholder:text-dust"
          />
          <button
            type="submit"
            aria-disabled={state.name === 'sending'}
            className="rounded-control bg-thread px-4 py-2.5 text-[14px] font-medium text-void aria-disabled:opacity-60"
          >
            {state.name === 'sending' ? 'Sending…' : 'Send it'}
          </button>
        </form>
      )}

      {/* Not carried by colour: the text says what happened and what to do. */}
      <LiveRegion
        assertive
        message={state.name === 'error' ? state.message : ''}
        className="mt-2.5 text-[13.5px] text-starlight"
      />
    </>
  );
}
