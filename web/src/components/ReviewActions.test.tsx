// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postQueue = vi.hoisted(() => vi.fn());
vi.mock('../lib/submit', () => ({ postQueue }));

const { default: ReviewActions, confirmation } = await import('./ReviewActions');

afterEach(() => {
  cleanup();
  postQueue.mockReset();
});

/**
 * The defect this proves is gone: a reader pressed "Volunteer to review", the
 * button vanished, a confirmation appeared in a region that did not exist a
 * moment earlier — so nothing was announced — and focus fell to <body>.
 *
 * Measured on a real build before the fix: zero live regions on the page before
 * the click, and `document.activeElement` was BODY after it.
 */
describe('the review actions', () => {
  it('has a live region on the page before anything has happened', async () => {
    render(<ReviewActions conceptId="adam" />);
    // The island renders null until mounted; the region arrives with it, which
    // is still long before the reader can press anything.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Volunteer to review' })).toBeDefined());

    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
  });

  it('announces the confirmation by changing that same region', async () => {
    postQueue.mockResolvedValue({ ok: true });
    render(<ReviewActions conceptId="adam" />);
    await waitFor(() => screen.getByRole('button', { name: 'Volunteer to review' }));

    const before = screen.getByRole('status');
    screen.getByRole('button', { name: 'Volunteer to review' }).click();

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(confirmation('volunteer')));
    // The same node: a screen reader hears a change, not a new subtree.
    expect(screen.getByRole('status')).toBe(before);
  });

  it('moves focus to the confirmation, because the button the reader pressed is gone', async () => {
    postQueue.mockResolvedValue({ ok: true });
    render(<ReviewActions conceptId="adam" />);
    await waitFor(() => screen.getByRole('button', { name: 'Volunteer to review' }));

    screen.getByRole('button', { name: 'Volunteer to review' }).click();

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Volunteer to review' })).toBeNull());
    // Inside waitFor: the focus move happens in a passive effect, which runs
    // after the DOM update that waitFor is watching for. Asserting straight
    // after the render sees <body> and blames the component for the harness.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('reports a failure in a region that was already there, assertively', async () => {
    postQueue.mockResolvedValue({ ok: false, message: 'That could not be accepted.' });
    render(<ReviewActions conceptId="adam" />);
    await waitFor(() => screen.getByRole('button', { name: 'Volunteer to review' }));

    const before = screen.getByRole('alert');
    expect(before.textContent).toBe('');

    screen.getByRole('button', { name: 'Volunteer to review' }).click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That could not be accepted.'));
    expect(screen.getByRole('alert')).toBe(before);

    // A failure leaves the buttons where they were — there is something to retry.
    expect(screen.getByRole('button', { name: 'Volunteer to review' })).toBeDefined();
  });

  /**
   * The flag path loses focus for BOTH reasons at once: `disabled` took it off
   * the button mid-send, and then the form unmounted on error so there was
   * nothing to give it back to. The guard fixes the first; `takeFocus` on the
   * error region fixes the second, which is the case LiveRegion was built for.
   */
  it('puts focus on the message when a flag fails, since the form is gone (#405)', async () => {
    postQueue.mockResolvedValue({ ok: false, message: 'That could not be accepted.' });
    render(<ReviewActions conceptId="adam" />);
    await waitFor(() => screen.getByRole('button', { name: 'Flag an error' }));

    fireEvent.click(screen.getByRole('button', { name: 'Flag an error' }));
    const note = await screen.findByLabelText(/What is wrong with it/);
    fireEvent.change(note, { target: { value: 'The coefficient does not match the paper.' } });

    const send = await screen.findByRole('button', { name: 'Send report' });
    send.focus();
    expect(document.activeElement).toBe(send);

    fireEvent.click(send);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That could not be accepted.'));

    // The form is gone, so the message is what focus can land on. Drop
    // `takeFocus` and this is <body> — the reader hears the failure from the
    // top of the document.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('will not send a flag with an empty note, now that the guard replaces `disabled` (#405)', async () => {
    render(<ReviewActions conceptId="adam" />);
    await waitFor(() => screen.getByRole('button', { name: 'Flag an error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flag an error' }));

    const send = await screen.findByRole('button', { name: 'Send report' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);

    expect(postQueue).not.toHaveBeenCalled();
  });
});
