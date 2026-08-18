import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Depth } from '../lib/graph';
import { fromSearch, read, resolve, searchFor, write } from '../lib/depth';
import Notation from './Notation';
import type { Segment } from '../lib/refs';

/**
 * Before paint on the client, after-paint never on the server.
 *
 * The resolved depth has to be applied BEFORE the browser paints, or a reader
 * whose stored depth is Engineer sees a frame of Intuition and a layout jump on
 * every concept page — which is the "no layout shift" criterion in #42 failing
 * on the one path that matters. `useLayoutEffect` runs after the DOM is written
 * and before paint, so the swap is never seen.
 *
 * It is also the hook React warns about during server rendering, and Astro does
 * render this component to HTML at build time. Hence the switch: there is no
 * layout to read on the server, and nothing to shift.
 */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Body {
  depth: Depth;
  before: Segment[];
  emphasis: Segment[];
  after: Segment[];
}

interface Props {
  bodies: Body[];
  initial?: Depth;
}

const LABEL: Record<Depth, string> = {
  intuition: 'Intuition',
  engineer: 'Engineer',
  math: 'Math',
};

/**
 * The one island on the concept page.
 *
 * All three bodies ship in the pre-rendered HTML and this swaps which is shown.
 * It never navigates and never fetches — the depth toggle is a reading control,
 * not a route. With JS disabled the server-rendered default body stays visible.
 */
export default function DepthToggle({ bodies, initial = 'intuition' }: Props) {
  const [depth, setDepth] = useState<Depth>(initial);
  const root = useRef<HTMLDivElement>(null);
  // Arrowing has to move focus, not only selection, so the buttons are reachable.
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // ON ARRIVAL: the URL, then storage, then what the server rendered (#42).
  // Runs once, before paint. `initial` is the fallback rather than the start,
  // so a page built with a different default still resolves the same way.
  useBeforePaint(() => {
    setDepth(resolve(fromSearch(window.location.search), read()));
  }, []);

  // ON CHANGE: remember it, and put it in the address bar.
  //
  // THE FIRST RUN IS SKIPPED, and the reason is an ordering trap. This effect
  // is passive, so on mount it fires with the depth of the render it belongs
  // to — the pre-resolution one — no matter that the layout effect above has
  // already scheduled the resolved value. Writing on that pass would store
  // `intuition` over the reader's saved Engineer and strip `?depth=math` out
  // of the very URL that had just supplied it. Resolution is not a choice; only
  // what happens after it is.
  //
  // `replaceState`, NOT `pushState`. Changing depth is a reading control, not a
  // navigation — with pushState the Back button would walk a reader back
  // through their own depth changes instead of leaving the page, and on a
  // concept where they toggled four times it would take five presses to get
  // out. `replaceState` keeps the URL shareable and the history honest.
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    write(depth);
    const search = searchFor(window.location.search, depth);
    window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  }, [depth]);

  // Publishes depth to the DOM so the viz island can follow it without the two
  // components knowing about each other (ADR-0005). This writes; nothing here
  // reads. The attribute's absence is the no-JavaScript case, and it is exactly
  // the intuition default the server already rendered.
  useEffect(() => {
    const scope = root.current?.closest('[data-depth-scope]');
    if (scope instanceof HTMLElement) scope.dataset.depth = depth;
  }, [depth]);

  /**
   * The keyboard half of `role="tablist"` (#138).
   *
   * The roles were here from the start and the behaviour they promise was not:
   * a reader was told "tab, 1 of 3, selected", pressed the arrow key that
   * announcement invites, and nothing happened. Measured in Chromium before
   * this — ArrowRight, ArrowLeft, Home and End each moved neither focus nor
   * selection.
   *
   * SELECTION FOLLOWS FOCUS. The APG allows either, and picks this one when
   * switching is cheap: all three bodies are already in the DOM, so arrowing
   * costs a class change and no fetch. The alternative — arrow to move, Space
   * to choose — asks for a second keystroke to buy nothing.
   *
   * Wrapping, because three tabs in a rounded strip read as a loop rather than
   * a line with ends.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const here = bodies.findIndex((b) => b.depth === depth);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (here + 1) % bodies.length;
        break;
      case 'ArrowLeft':
        next = (here - 1 + bodies.length) % bodies.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = bodies.length - 1;
        break;
      default:
        return;
    }
    // Only for the keys handled above: Home and End would otherwise scroll the
    // page out from under the reader, and every other key must still reach the
    // browser.
    event.preventDefault();
    const target = bodies[next];
    if (!target) return;
    setDepth(target.depth);
    tabs.current[next]?.focus();
  }

  return (
    <>
      <div
        ref={root}
        role="tablist"
        aria-label="Explanation depth"
        onKeyDown={onKeyDown}
        className="my-5 inline-flex overflow-hidden rounded-control border border-line max-md:w-full"
      >
        {bodies.map((body, i) => {
          const active = body.depth === depth;
          return (
            <button
              key={body.depth}
              id={`tab-${body.depth}`}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`body-${body.depth}`}
              // Roving tabindex: the tablist is ONE stop in the sequential
              // order, entered at the selected tab and left with the next Tab.
              // Three separate stops made a reader walk past a control most
              // never touch, three times, on every concept page.
              tabIndex={active ? 0 : -1}
              onClick={() => setDepth(body.depth)}
              className={[
                'cursor-pointer px-[18px] py-[9px] text-[13px] max-md:flex-1',
                active
                  ? 'bg-thread font-bold text-void'
                  : 'bg-transparent font-medium text-dust',
              ].join(' ')}
            >
              {LABEL[body.depth]}
            </button>
          );
        })}
      </div>

      {bodies.map((body) => (
        <p
          key={body.depth}
          id={`body-${body.depth}`}
          role="tabpanel"
          // Back to the tab that controls it. `aria-controls` pointed one way
          // and the tabs had no id, so nothing could point back — a reader
          // landing in the body was not told which depth they were reading,
          // which is the entire semantic of the control.
          aria-labelledby={`tab-${body.depth}`}
          // The panel holds prose and nothing focusable, so without this it is
          // unreachable by keyboard and its name is never announced. The APG
          // asks for it in exactly this case. A hidden panel is inert anyway,
          // so this adds one stop, not three.
          tabIndex={0}
          hidden={body.depth !== depth}
          className="max-w-[62ch] text-[15.5px] leading-[1.65] text-pretty"
        >
          {/*
            Each segment is parsed separately because emphasis is a substring
            of the raw body and is split off before this point. A phrase that
            cut a notation group in half would leave both halves literal —
            `validate:content` rejects that rather than letting it render.
          */}
          <Prose segments={body.before} />
          {body.emphasis.length > 0 && (
            <em className="font-medium not-italic text-thread">
              <Prose segments={body.emphasis} />
            </em>
          )}
          <Prose segments={body.after} />
        </p>
      ))}
    </>
  );
}

/**
 * Body copy with inline concept references resolved to links (#298).
 *
 * A reference shows the target's TITLE rather than the id the author typed:
 * "Constrained Decoding is the second applied to output shape" reads as prose
 * where the kebab-case id does not. The id is still what was written, so the
 * link cannot point somewhere the author did not name.
 *
 * `thread` violet and an underline, per CLAUDE.md §5 — links are the only
 * interactive colour, and inside a paragraph an underline is what marks one
 * without the weight of a button. Text segments still go through `Notation`,
 * so a subscript beside a reference renders as it always did.
 */
function Prose({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        typeof s === 'string' ? (
          <Notation key={i} text={s} />
        ) : (
          <a key={i} href={`/c/${s.id}`} className="text-thread underline underline-offset-2">
            {s.label}
          </a>
        ),
      )}
    </>
  );
}
