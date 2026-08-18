// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import DepthToggle from './DepthToggle';
import type { Depth } from '../lib/graph';

afterEach(cleanup);

/**
 * The component now has state that outlives a render (#42), so tests leak into
 * each other without this. The keyboard tests below predate the persistence and
 * assume every mount starts at Intuition — which stopped being true the moment
 * arrowing to Engineer started writing it down. Nothing about them was wrong;
 * they were written against a component that could not remember.
 */
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/c/attention');
});

/** Bodies arrive as segments since #298, so a reference can be a link. */
const text = (s: string) => [s];
const BODIES = [
  { depth: 'intuition' as Depth, before: text('The intuition.'), emphasis: [], after: [] },
  { depth: 'engineer' as Depth, before: text('The engineering.'), emphasis: [], after: [] },
  { depth: 'math' as Depth, before: text('The math.'), emphasis: [], after: [] },
];

/**
 * Rendered inside a `[data-depth-scope]` because that is where the concept page
 * puts it: the toggle publishes the depth onto that ancestor and the viz CSS
 * reads it (ADR-0005). Without the wrapper the effect has nothing to write to
 * and the coupling these tests check would go unverified.
 */
function mount() {
  const scope = document.createElement('div');
  scope.setAttribute('data-depth-scope', '');
  document.body.append(scope);
  const result = render(<DepthToggle bodies={BODIES} initial="intuition" />, { container: scope });
  return { scope, ...result };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const selected = () => screen.getByRole('tab', { selected: true }).textContent;

/**
 * Driving real key events, not asserting on markup — the defect was that the
 * markup was right and nothing responded to it. Measured in Chromium before
 * the fix: ArrowRight with a tab focused moved neither focus nor selection.
 */
describe('the depth toggle keyboard', () => {
  it('moves to the next tab on ArrowRight, focus and selection together', () => {
    mount();
    tab('Intuition').focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });

    expect(selected()).toBe('Engineer');
    expect(document.activeElement).toBe(tab('Engineer'));
  });

  it('moves back on ArrowLeft', () => {
    mount();
    tab('Intuition').focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(selected()).toBe('Engineer');

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(selected()).toBe('Intuition');
    expect(document.activeElement).toBe(tab('Intuition'));
  });

  it('wraps at both ends, because three tabs in a strip read as a loop', () => {
    mount();
    tab('Intuition').focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(selected()).toBe('Math');

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(selected()).toBe('Intuition');
  });

  it('goes to the ends on Home and End', () => {
    mount();
    tab('Intuition').focus();

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(selected()).toBe('Math');
    expect(document.activeElement).toBe(tab('Math'));

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(selected()).toBe('Intuition');
    expect(document.activeElement).toBe(tab('Intuition'));
  });

  it('leaves every other key to the browser', () => {
    mount();
    tab('Intuition').focus();

    for (const key of ['ArrowUp', 'ArrowDown', 'a', 'Enter', 'Tab', 'PageDown']) {
      const event = fireEvent.keyDown(document.activeElement!, { key, cancelable: true });
      expect(event, `${key} was consumed`).toBe(true); // not preventDefault'ed
    }
    expect(selected()).toBe('Intuition');
  });

  it('publishes the depth to the scope as the arrow moves, so the viz follows', () => {
    // ADR-0005: the toggle writes data-depth and CSS switches the variants.
    // Clicking already did this; arrowing has to do it too or the body and the
    // picture disagree.
    const { scope } = mount();
    tab('Intuition').focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(scope.dataset.depth).toBe('engineer');

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(scope.dataset.depth).toBe('math');
  });
});

describe('the depth toggle tab order', () => {
  it('is one stop, not three', () => {
    mount();
    const stops = screen.getAllByRole('tab').filter((t) => t.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.textContent).toBe('Intuition');
  });

  it('moves that stop with the selection, so Tab re-enters where the reader left', () => {
    mount();
    tab('Intuition').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });

    expect(tab('Engineer').tabIndex).toBe(0);
    expect(tab('Intuition').tabIndex).toBe(-1);
    expect(tab('Math').tabIndex).toBe(-1);
  });
});

describe('the depth toggle names', () => {
  it('labels each panel with the tab that controls it', () => {
    mount();
    for (const [depth, label] of [
      ['intuition', 'Intuition'],
      ['engineer', 'Engineer'],
      ['math', 'Math'],
    ] as const) {
      const panel = document.getElementById(`body-${depth}`)!;
      expect(panel.getAttribute('role')).toBe('tabpanel');
      // Both directions: the tab points at the panel, the panel names the tab.
      expect(panel.getAttribute('aria-labelledby')).toBe(`tab-${depth}`);
      expect(tab(label).getAttribute('aria-controls')).toBe(`body-${depth}`);
      expect(tab(label).id).toBe(`tab-${depth}`);
    }
  });

  it('leaves the visible panel reachable, since it holds no focusable content', () => {
    mount();
    const panel = document.getElementById('body-intuition')!;
    expect(panel.tabIndex).toBe(0);
    expect(panel.hidden).toBe(false);
    // The other two are inert regardless of tabindex.
    expect(document.getElementById('body-math')!.hidden).toBe(true);
  });
});

/**
 * The state half of #42, driven through the real component.
 *
 * `depth.test.ts` covers the precedence as arithmetic. These cover the wiring:
 * that the rule is consulted on arrival, that the address bar follows a choice,
 * and — the one that would have shipped broken — that resolving on mount is not
 * mistaken for the reader choosing.
 */
function at(search: string) {
  window.history.replaceState(null, '', `/c/attention${search}`);
}

describe('the depth toggle on arrival', () => {
  it('honours ?depth= in the URL it was loaded with', () => {
    at('?depth=math');
    mount();
    expect(selected()).toBe('Math');
  });

  it('remembers the depth from the last concept when the URL says nothing', () => {
    window.localStorage.setItem('depth', 'engineer');
    mount();
    expect(selected()).toBe('Engineer');
  });

  it('lets the URL beat storage, so a shared link means what it says', () => {
    window.localStorage.setItem('depth', 'engineer');
    at('?depth=math');
    mount();
    expect(selected()).toBe('Math');
  });

  it('falls back to what the server rendered when neither says anything', () => {
    mount();
    expect(selected()).toBe('Intuition');
  });

  it('does not strip the parameter that just supplied it', () => {
    // The trap this guards: the persist effect is passive, so on mount it fires
    // with the PRE-resolution depth. Unguarded it wrote `intuition` — deleting
    // ?depth=math from the very URL that had been read a moment earlier, and
    // clobbering the reader's stored Engineer on the way past.
    window.localStorage.setItem('depth', 'engineer');
    at('?depth=math');
    mount();
    expect(window.location.search).toBe('?depth=math');
  });

  it('adopts a linked depth as the ongoing preference, so the next concept follows', () => {
    // Deliberate, not incidental. Someone opening a ?depth=math link is reading
    // math now; snapping back to their stored Engineer on the next click would
    // change depth under them mid-session. What you are reading carries forward.
    window.localStorage.setItem('depth', 'engineer');
    at('?depth=math');
    mount();
    expect(window.localStorage.getItem('depth')).toBe('math');
  });

  it('does not record a preference for a reader who never expressed one', () => {
    // Visiting is not choosing. Without the mount guard, merely loading a page
    // wrote `intuition` into storage for someone who had never touched the
    // control.
    mount();
    expect(window.localStorage.getItem('depth')).toBeNull();
  });
});

describe('the depth toggle after a choice', () => {
  it('puts the chosen depth in the address bar', () => {
    mount();
    fireEvent.click(tab('Math'));
    expect(window.location.search).toBe('?depth=math');
  });

  it('remembers it for the next concept', () => {
    mount();
    fireEvent.click(tab('Engineer'));
    expect(window.localStorage.getItem('depth')).toBe('engineer');
  });

  it('clears the parameter when the reader returns to the default', () => {
    at('?depth=math');
    mount();
    fireEvent.click(tab('Intuition'));
    expect(window.location.search).toBe('');
  });

  it('keeps other parameters, so arriving from search survives a depth change', () => {
    at('?from=search');
    mount();
    fireEvent.click(tab('Math'));
    expect(window.location.search).toBe('?from=search&depth=math');
  });

  it('replaces history rather than pushing, so Back leaves the page', () => {
    at('?depth=intuition');
    const before = window.history.length;
    mount();
    fireEvent.click(tab('Math'));
    fireEvent.click(tab('Engineer'));
    fireEvent.click(tab('Math'));
    // Three depth changes must not become three things to press Back through.
    expect(window.history.length).toBe(before);
  });

  it('still publishes the depth to the scope, so the viz follows (ADR-0005)', () => {
    const { scope } = mount();
    fireEvent.click(tab('Math'));
    expect(scope.dataset.depth).toBe('math');
  });
});
