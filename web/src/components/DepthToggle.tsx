import { useEffect, useRef, useState } from 'react';
import type { Depth } from '../lib/graph';

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

  // Publishes depth to the DOM so the viz island can follow it without the two
  // components knowing about each other (ADR-0005). This writes; nothing here
  // reads. The attribute's absence is the no-JavaScript case, and it is exactly
  // the intuition default the server already rendered.
  useEffect(() => {
    const scope = root.current?.closest('[data-depth-scope]');
    if (scope instanceof HTMLElement) scope.dataset.depth = depth;
  }, [depth]);

  return (
    <>
      <div
        ref={root}
        role="tablist"
        aria-label="Explanation depth"
        className="my-5 inline-flex overflow-hidden rounded-control border border-line max-md:w-full"
      >
        {bodies.map((body) => {
          const active = body.depth === depth;
          return (
            <button
              key={body.depth}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`body-${body.depth}`}
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
          hidden={body.depth !== depth}
          className="max-w-[62ch] text-[15.5px] leading-[1.65] text-pretty"
        >
          {body.before}
          {body.emphasis && <em className="font-medium not-italic text-thread">{body.emphasis}</em>}
          {body.after}
        </p>
      ))}
    </>
  );
}
