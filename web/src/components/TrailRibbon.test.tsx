// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postCreate = vi.hoisted(() => vi.fn());
vi.mock('../lib/submit', () => ({ postCreate }));

const { default: TrailRibbon } = await import('./TrailRibbon');

afterEach(() => {
  cleanup();
  postCreate.mockReset();
  localStorage.clear();
});

const ribbon = () => <TrailRibbon id="attention" title="Attention" tier="verified" />;
const shareButton = () => screen.getByRole('button', { name: /Share trail|Sharing/ });

/**
 * Two defects, measured on a real build before this existed.
 *
 * #406 — the failure was announced from a `<span role="alert">` rendered only
 * once there was an error. Region and text in one render is a new subtree, not
 * the change a reader listens for. `/c/attention` at rest had NO live region at
 * all: `role=status/alert: []`, with the Share button right there.
 *
 * #405 — `disabled={sending}` disabled the focused button, the browser dropped
 * focus to `<body>`, the send failed, the button came back enabled, and nothing
 * returned focus. On `/request` that was five of seven tab stops back to where
 * the reader had been standing.
 */
describe('the trail ribbon, when a share fails', () => {
  it('has its live region on the page before anything has happened (#406)', async () => {
    render(ribbon());
    await waitFor(() => shareButton());

    // Present and empty. The old hand-rolled span did not exist until it spoke.
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('announces by changing that same node, not by adding one (#406)', async () => {
    postCreate.mockResolvedValue({ ok: false, message: 'It could not be sent.' });
    render(ribbon());
    await waitFor(() => shareButton());

    const before = screen.getByRole('alert');
    shareButton().click();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('It could not be sent.'));
    // The same element, not merely an equal one — that identity IS the fix.
    expect(screen.getByRole('alert')).toBe(before);
  });

  it('leaves focus on the button the reader pressed (#405)', async () => {
    postCreate.mockResolvedValue({ ok: false, message: 'It could not be sent.' });
    render(ribbon());
    await waitFor(() => shareButton());

    const button = shareButton();
    button.focus();
    expect(document.activeElement).toBe(button);

    button.click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('It could not be sent.'));

    // Restore `disabled={share.name === 'sending'}` and this is <body>.
    expect(document.activeElement).toBe(button);
  });

  it('marks the button busy without removing it from the focus order (#405)', async () => {
    let settle: (v: unknown) => void = () => {};
    postCreate.mockReturnValue(new Promise((r) => { settle = r; }));
    render(ribbon());
    await waitFor(() => shareButton());

    shareButton().click();
    await waitFor(() => expect(shareButton().getAttribute('aria-disabled')).toBe('true'));
    // aria-disabled announces unavailable; `disabled` would also un-focus it.
    expect((shareButton() as HTMLButtonElement).disabled).toBe(false);

    settle({ ok: false, message: 'It could not be sent.' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('It could not be sent.'));
  });

  it('does not send twice while one send is in flight (#405)', async () => {
    let settle: (v: unknown) => void = () => {};
    postCreate.mockReturnValue(new Promise((r) => { settle = r; }));
    render(ribbon());
    await waitFor(() => shareButton());

    shareButton().click();
    await waitFor(() => expect(shareButton().getAttribute('aria-disabled')).toBe('true'));
    // The button is still clickable now, so the guard is the only thing
    // stopping this — which is exactly what the fix moved off `disabled`.
    shareButton().click();
    shareButton().click();

    expect(postCreate).toHaveBeenCalledTimes(1);
    settle({ ok: false, message: 'It could not be sent.' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('It could not be sent.'));
  });
});
