// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DepthToggle from './DepthToggle';
import type { Depth } from '../lib/graph';

afterEach(cleanup);

const BODIES = [
  { depth: 'intuition' as Depth, before: 'The intuition.', emphasis: '', after: '' },
  { depth: 'engineer' as Depth, before: 'The engineering.', emphasis: '', after: '' },
  { depth: 'math' as Depth, before: 'The math.', emphasis: '', after: '' },
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
