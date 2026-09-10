// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postQueue = vi.hoisted(() => vi.fn());
vi.mock('../lib/submit', () => ({ postQueue }));

const { default: RequestForm } = await import('./RequestForm');

afterEach(() => {
  cleanup();
  postQueue.mockReset();
});

const send = () => screen.getByRole('button', { name: /Send it|Sending/ });

const filled = async () => {
  render(<RequestForm />);
  const input = await screen.findByLabelText(/What is missing/);
  fireEvent.change(input, { target: { value: 'speculative decoding' } });
  return input;
};

/**
 * Measured on a real build before the fix: focus after a failed send was
 * `BODY`, and getting back to the button the reader had just pressed was five
 * of seven tab stops from the top of the document (#405).
 *
 * Unlike the flag path in ReviewActions, this form STAYS on error — so there is
 * something to return to, and the fix is to stop `disabled` taking focus away
 * in the first place rather than to move focus to the message.
 */
describe('the request form, when a send fails', () => {
  it('leaves focus on the button the reader pressed (#405)', async () => {
    postQueue.mockResolvedValue({ ok: false, message: 'That name was not accepted.' });
    await filled();

    const button = send();
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That name was not accepted.'));

    // Restore `disabled={state.name === 'sending'}` and this is <body>.
    expect(document.activeElement).toBe(send());
  });

  it('marks the button busy without removing it from the focus order (#405)', async () => {
    let settle: (v: unknown) => void = () => {};
    postQueue.mockReturnValue(new Promise((r) => { settle = r; }));
    await filled();

    fireEvent.click(send());
    await waitFor(() => expect(send().getAttribute('aria-disabled')).toBe('true'));
    expect((send() as HTMLButtonElement).disabled).toBe(false);

    settle({ ok: false, message: 'That name was not accepted.' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That name was not accepted.'));
  });

  it('does not send twice while one send is in flight (#405)', async () => {
    let settle: (v: unknown) => void = () => {};
    postQueue.mockReturnValue(new Promise((r) => { settle = r; }));
    await filled();

    fireEvent.click(send());
    await waitFor(() => expect(send().getAttribute('aria-disabled')).toBe('true'));
    // Still clickable, so the handler guard is the only thing stopping this.
    fireEvent.click(send());
    fireEvent.click(send());

    expect(postQueue).toHaveBeenCalledTimes(1);
    settle({ ok: false, message: 'That name was not accepted.' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That name was not accepted.'));
  });
});
