// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LiveRegion from './LiveRegion';

afterEach(cleanup);

/**
 * The whole point of #137 in one property: the region is the SAME DOM NODE
 * before and after the message arrives.
 *
 * Asserting that the confirmation text is on screen would pass just as happily
 * against the conditional rendering this replaced — the text is there either
 * way. What a screen reader needs is that the node was already in the
 * accessibility tree, so the new text reads as a change to it rather than as a
 * subtree appearing. Identity is the only assertion that can tell those apart.
 */
describe('a live region', () => {
  it('is in the document before it has anything to say', () => {
    render(<LiveRegion message="" />);
    const region = screen.getByRole('status');
    expect(region).toBeDefined();
    expect(region.textContent).toBe('');
  });

  it('is the same node once the message arrives', () => {
    const { rerender } = render(<LiveRegion message="" />);
    const before = screen.getByRole('status');

    rerender(<LiveRegion message="Reported." />);
    const after = screen.getByRole('status');

    expect(after).toBe(before); // not merely equal — the same element
    expect(after.textContent).toBe('Reported.');
  });

  it('is never display:none, which would take it out of the accessibility tree', () => {
    // sr-only hides with clip, not display — the distinction this depends on.
    render(<LiveRegion message="" />);
    expect(screen.getByRole('status').className).toContain('sr-only');
  });

  it('takes its visible styling only once there is something to show', () => {
    const { rerender } = render(<LiveRegion message="" className="border" />);
    expect(screen.getByRole('status').className).toBe('sr-only');

    rerender(<LiveRegion message="Reported." className="border" />);
    expect(screen.getByRole('status').className).toBe('border');
  });

  it('is assertive when the news is bad', () => {
    render(<LiveRegion assertive message="That could not be accepted." />);
    expect(screen.getByRole('alert').textContent).toBe('That could not be accepted.');
  });

  it('moves focus to the message when asked, so a keyboard reader keeps their place', () => {
    const { rerender } = render(<LiveRegion message="" takeFocus />);
    expect(document.activeElement).toBe(document.body);

    rerender(<LiveRegion message="Reported." takeFocus />);
    expect(document.activeElement).toBe(screen.getByRole('status'));
  });

  it('does not become a tab stop while it is empty', () => {
    // A permanently focusable empty paragraph is a stop in the sequential
    // order that announces nothing.
    render(<LiveRegion message="" takeFocus />);
    expect(screen.getByRole('status').getAttribute('tabindex')).toBeNull();
  });

  it('leaves focus alone when it is not asked to move it', () => {
    const { rerender } = render(<LiveRegion message="" />);
    rerender(<LiveRegion message="12 results for atte" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not re-take focus when the message merely changes', () => {
    // Search updates its region on every keystroke. Focus must not follow.
    const { rerender } = render(<LiveRegion message="" takeFocus />);
    rerender(<LiveRegion message="one" takeFocus />);
    const region = screen.getByRole('status');
    (document.activeElement as HTMLElement).blur();
    rerender(<LiveRegion message="two" takeFocus />);
    expect(document.activeElement).not.toBe(region);
  });
});
