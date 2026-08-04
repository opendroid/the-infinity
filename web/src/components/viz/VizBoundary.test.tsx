// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VizBoundary from './VizBoundary';
import UpdateSpectrum from './UpdateSpectrum';

afterEach(cleanup);

/**
 * #47 asks that a primitive that throws "degrades to the caption and a static
 * frame; the page survives". Nothing caught anything before this, so these are
 * the first assertions that it does.
 *
 * React logs caught errors to console.error regardless of the boundary, and the
 * boundary logs its own line deliberately. Both are silenced here so a passing
 * run is quiet — and asserted on, so the silencing cannot hide a boundary that
 * stopped reporting.
 */
let errors: unknown[][];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error('params made no sense');
}

const CAPTION = 'Singular values before and after orthogonalization.';

describe('a primitive that throws', () => {
  it('does not take the page down with it', () => {
    render(
      <div>
        <p>the prose around it</p>
        <VizBoundary primitive="update-spectrum" caption={CAPTION}>
          <Boom />
        </VizBoundary>
      </div>,
    );
    expect(screen.getByText('the prose around it')).toBeTruthy();
  });

  it('degrades to the caption, which is the part still worth reading', () => {
    render(
      <VizBoundary primitive="update-spectrum" caption={CAPTION}>
        <Boom />
      </VizBoundary>,
    );
    expect(screen.getByText(CAPTION)).toBeTruthy();
  });

  it('keeps the frame, so nothing below it moves', () => {
    const { container } = render(
      <VizBoundary primitive="update-spectrum" caption={CAPTION}>
        <Boom />
      </VizBoundary>,
    );
    const figure = container.querySelector('figure');
    expect(figure).toBeTruthy();
    // Same chrome the working primitive renders — a missing box would shift
    // the whole rest of the page.
    expect(figure!.className).toContain('rounded-island');
    expect(figure!.className).toContain('border-line');
  });

  it('names which primitive failed, in the slot the caption normally uses', () => {
    render(
      <VizBoundary primitive="router-dispatch" caption={CAPTION}>
        <Boom />
      </VizBoundary>,
    );
    expect(screen.getByText(/router-dispatch/)).toBeTruthy();
  });

  it('reports it, because a fallback this calm is invisible from the page alone', () => {
    render(
      <VizBoundary primitive="update-spectrum" caption={CAPTION}>
        <Boom />
      </VizBoundary>,
    );
    expect(errors.some((a) => String(a[0]).includes('viz primitive threw'))).toBe(true);
  });
});

describe('a primitive that works', () => {
  it('renders itself, not the fallback — the boundary is invisible when nothing is wrong', () => {
    render(
      <UpdateSpectrum
        seed="muon-optimizer"
        params={{ bars: 8 }}
        control={{ name: 'ns_steps', min: 0, max: 8, step: 1 }}
        caption={CAPTION}
      />,
    );
    // The real primitive names itself in the figcaption; the fallback says
    // "unavailable" beside it.
    expect(screen.getByText(/update-spectrum/)).toBeTruthy();
    expect(screen.queryByText('unavailable')).toBeNull();
    expect(errors).toHaveLength(0);
  });
});
