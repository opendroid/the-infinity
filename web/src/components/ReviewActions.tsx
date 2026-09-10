import { useEffect, useState } from 'react';
import { postQueue } from '../lib/submit';
import LiveRegion from './LiveRegion';

/**
 * The two actions on a frontier node's provenance block.
 *
 * They were `<button type="button">` with no handler: styled as the primary and
 * secondary actions, doing nothing at all, on 54 of 57 concepts (#111). A
 * button that silently does nothing is worse than no button — the reader
 * believes they reported an error, and nothing was reported.
 *
 * `POST /api/v1/reviews` already existed, rate-limited and documented; only the
 * call was missing.
 *
 * NEITHER RENDERS WITHOUT JAVASCRIPT. Same rule as RequestConcept: these post
 * JSON, so a server-rendered version would put a control on the page that does
 * nothing when clicked — which is the defect being fixed here, reintroduced by
 * a different route.
 *
 * This does NOT change the concept's tier and the copy must not imply it does.
 * Promotion happens when a human edits the JSON and merges the PR; the merge is
 * the act of verification (ADR-0002).
 */

const MAX_NOTE = 2000;

type State =
  | { name: 'idle' }
  | { name: 'flagging' }
  | { name: 'sending' }
  | { name: 'queued'; kind: 'flag' | 'volunteer' }
  | { name: 'error'; message: string };

/** Exported for the tests: what the reader is told after each outcome. */
export function confirmation(kind: 'flag' | 'volunteer'): string {
  return kind === 'flag'
    ? 'Reported. It joins the queue for a human to look at — nothing about this node has changed yet.'
    : 'Noted, and thank you. Reviewing happens in a pull request; someone will be in touch through the repository.';
}

interface Props {
  conceptId: string;
}

export default function ReviewActions({ conceptId }: Props) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State>({ name: 'idle' });
  const [note, setNote] = useState('');

  useEffect(() => setMounted(true), []);

  async function send(kind: 'flag' | 'volunteer') {
    if (state.name === 'sending') return;
    // An empty note was a `disabled` too. Both are guarded here instead, so
    // neither can take focus away from the button mid-interaction (#405).
    if (kind === 'flag' && note.trim().length === 0) return;
    setState({ name: 'sending' });
    const result = await postQueue(
      '/reviews',
      { concept_id: conceptId, kind, ...(kind === 'flag' ? { note: note.trim() } : {}) },
      'That could not be accepted. Try a shorter note.',
    );
    setState(result.ok ? { name: 'queued', kind } : { name: 'error', message: result.message });
  }

  if (!mounted) return null;

  // The confirmation is a change of text inside a region that was already
  // there, never a region that arrives with its text (#137) — and it takes
  // focus, because the button the reader pressed is about to be unmounted.
  const confirmed = state.name === 'queued' ? confirmation(state.kind) : '';

  return (
    <div className="mt-4">
      <LiveRegion
        message={confirmed}
        takeFocus
        className="rounded-control border border-line bg-nebula px-3.5 py-3 text-[14px] text-starlight"
      />

      {confirmed !== '' ? null : state.name === 'flagging' || state.name === 'sending' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send('flag');
          }}
        >
          <label htmlFor="flag-note" className="block text-[13px] text-dust">
            What is wrong with it? A flag without a description cannot be acted on.
          </label>
          <textarea
            id="flag-note"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            rows={3}
            maxLength={MAX_NOTE}
            required
            autoFocus
            className="mt-2 w-full rounded-control border border-thread bg-void px-3 py-2.5 text-[14px] text-starlight placeholder:text-dust"
            placeholder="The Newton–Schulz coefficient does not match the cited paper…"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              aria-disabled={state.name === 'sending' || note.trim().length === 0}
              className="cursor-pointer rounded-row border border-thread bg-transparent px-[18px] py-[9px] text-[13px] text-thread aria-disabled:opacity-50"
            >
              {state.name === 'sending' ? 'Sending…' : 'Send report'}
            </button>
            <button
              type="button"
              onClick={() => setState({ name: 'idle' })}
              className="cursor-pointer rounded-row border-0 bg-transparent px-2 py-[9px] text-[13px] text-dust underline"
            >
              Cancel
            </button>
            <span className="font-mono text-[10px] text-dust">
              {note.length}/{MAX_NOTE}
            </span>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setState({ name: 'flagging' })}
            className="cursor-pointer rounded-row border border-thread bg-transparent px-[18px] py-[9px] text-[13px] text-thread"
          >
            Flag an error
          </button>
          <button
            type="button"
            onClick={() => void send('volunteer')}
            className="cursor-pointer rounded-row border border-line bg-transparent px-[18px] py-[9px] text-[13px] text-starlight"
          >
            Volunteer to review
          </button>
        </div>
      )}

      {/*
        Not carried by colour: the text says what happened and what to do.

        `takeFocus` HERE AND NOT ON THE OTHER THREE (#405). Everywhere else a
        failure leaves the pressed button in the DOM, so the fix is to stop
        `disabled` from taking focus off it. Here the flag form unmounts on
        error — `state.name === 'error'` is neither `flagging` nor `sending` —
        so there is nothing to leave focus on, and this is the unmounted case
        LiveRegion's own note describes.
      */}
      <LiveRegion
        assertive
        takeFocus
        message={state.name === 'error' ? state.message : ''}
        className="mt-2.5 text-[13.5px] text-starlight"
      />
    </div>
  );
}
