import { useEffect, useRef, useState } from 'react';
import type { Depth } from '../lib/graph';
import Notation from './Notation';

interface Body {
  depth: Depth;
  before: string;
  emphasis: string;
  after: string;
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
          <Notation text={body.before} />
          {body.emphasis && (
            <em className="font-medium not-italic text-thread">
              <Notation text={body.emphasis} />
            </em>
          )}
          <Notation text={body.after} />
        </p>
      ))}
    </>
  );
}
