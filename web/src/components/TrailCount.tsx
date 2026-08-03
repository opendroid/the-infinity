import { useEffect, useState } from 'react';
import { read, subscribe } from '../lib/trail';

/**
 * `trail · N nodes` in the topbar.
 *
 * It said `1 node` on every page forever, because the concept page passed
 * `trail.length` of a hardcoded one-element array and nothing ever wrote a
 * trail (#114).
 *
 * Read-only. The ribbon records the visit; this only reports it, and subscribes
 * so the two never disagree — including across tabs, where `subscribe` also
 * picks up the storage event.
 *
 * Astro renders the zero state into the static HTML, which is the truth for a
 * reader with no JavaScript: nothing is remembering their walk.
 */
export default function TrailCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(read().length);
    return subscribe(() => setCount(read().length));
  }, []);

  return (
    <span className="font-mono text-[11px] text-dust">
      trail · <b className={count > 0 ? 'text-thread' : 'text-dust'}>{count} {count === 1 ? 'node' : 'nodes'}</b>
    </span>
  );
}
