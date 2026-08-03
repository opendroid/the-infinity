import { useEffect, useState, type FormEvent } from 'react';
import { postQueue } from '../lib/submit';

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

export default function RequestForm() {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<State>({ name: 'idle' });
  const [context, setContext] = useState('');

  useEffect(() => {
    setMounted(true);
    setContext(contextFrom(window.location.search, document.referrer));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setState({ name: 'error', message: 'Give it a name first — two characters at least.' });
      return;
    }
    setState({ name: 'sending' });
    const result = await postQueue(
      '/requests',
      { name: name.trim(), referrer: context || window.location.pathname },
      'That name was not accepted. Try a shorter one.',
    );
    setState(result.ok ? { name: 'queued' } : { name: 'error', message: result.message });
  }

  if (!mounted) return null;

  if (state.name === 'queued') {
    return (
      <p
        className="mt-5 rounded-control border border-line bg-nebula px-3.5 py-3 text-[14px] text-starlight"
        role="status"
      >
        Noted. It joins the queue for a human to read — nothing has been added to the graph yet, and it
        grows by someone deciding it should.
      </p>
    );
  }

  return (
    <>
      {context !== '' && (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[.14em] text-dust">
          From <span className="text-starlight">{context}</span>
        </p>
      )}

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
          className="min-w-0 flex-1 rounded-control border border-line bg-void px-3 py-2.5 text-[14px] text-starlight placeholder:text-dust"
        />
        <button
          type="submit"
          disabled={state.name === 'sending'}
          className="rounded-control bg-thread px-4 py-2.5 text-[14px] font-medium text-void disabled:opacity-60"
        >
          {state.name === 'sending' ? 'Sending…' : 'Send it'}
        </button>
      </form>

      {state.name === 'error' && (
        // Not carried by colour: the text says what happened and what to do.
        <p className="mt-2.5 text-[13.5px] text-starlight" role="alert">
          {state.message}
        </p>
      )}
    </>
  );
}
