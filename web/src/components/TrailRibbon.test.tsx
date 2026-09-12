// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postCreate = vi.hoisted(() => vi.fn());
vi.mock('../lib/submit', () => ({ postCreate }));

const { default: TrailRibbon } = await import('./TrailRibbon');
import type { Stop } from '../lib/trail';

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

/**
 * #445. A trail is localStorage and outlives a concept being renamed or removed
 * in /content/nodes, so one dead bead refused the whole walk — reported to the
 * reader as "It may be too long", which it was not. The API now names the stale
 * stops; the ribbon drops exactly those and shares what is left.
 */
describe('the trail ribbon, when the trail has gone stale', () => {
  const walk = (...ids: string[]): Stop[] =>
    ids.map((id) => ({ id, title: id, tier: 'verified', depth_read_at: 'intuition', ts: 0 }));

  const stale = (...ids: string[]) => ({
    ok: false,
    message: `These stops name concepts that no longer exist: ${ids.join(', ')}.`,
    missingStops: ids,
  });

  const sentStops = (call: number): string[] =>
    (postCreate.mock.calls[call]?.[1] as { stops: { id: string }[] }).stops.map((s) => s.id);

  const stored = (): string[] =>
    (JSON.parse(localStorage.getItem('trail') ?? '[]') as Stop[]).map((s) => s.id);

  it('drops the stops the API named and shares the rest', async () => {
    localStorage.setItem('trail', JSON.stringify(walk('ghost', 'softmax', 'attention')));
    postCreate
      .mockResolvedValueOnce(stale('ghost'))
      .mockResolvedValueOnce({ ok: true, value: { slug: 'a-trail-0000', url: '/t/a-trail-0000' } });

    render(ribbon());
    await waitFor(() => shareButton());
    shareButton().click();

    await waitFor(() => expect(postCreate).toHaveBeenCalledTimes(2));
    expect(sentStops(0)).toEqual(['ghost', 'softmax', 'attention']);
    expect(sentStops(1)).toEqual(['softmax', 'attention']);

    // Written, not just retried: a bead that 404s should leave the ribbon at
    // the same moment, and what was shared has to be what the trail now says.
    expect(stored()).toEqual(['softmax', 'attention']);
    // The repair succeeded, so nothing is announced — the reader is navigating.
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('repairs once, then takes whatever the answer is', async () => {
    localStorage.setItem('trail', JSON.stringify(walk('ghost', 'attention')));
    // A server that keeps naming stops we have already dropped is a bug, not a
    // loop to run.
    postCreate.mockResolvedValue(stale('attention'));

    render(ribbon());
    await waitFor(() => shareButton());
    shareButton().click();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'These stops name concepts that no longer exist: attention.',
      ),
    );
    expect(postCreate).toHaveBeenCalledTimes(2);
  });

  it('does not retry a rejection it cannot repair', async () => {
    postCreate.mockResolvedValue({ ok: false, message: '"duration_s" is out of range.' });

    render(ribbon());
    await waitFor(() => shareButton());
    shareButton().click();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('"duration_s" is out of range.'),
    );
    expect(postCreate).toHaveBeenCalledTimes(1);
    // And the reader's trail is untouched: nothing about it was stale.
    expect(stored()).toEqual(['attention']);
  });
});
