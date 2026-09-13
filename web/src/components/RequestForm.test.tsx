// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postQueue = vi.hoisted(() => vi.fn());
vi.mock('../lib/submit', () => ({ postQueue }));

const { default: RequestForm, seededName } = await import('./RequestForm');

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

/**
 * #471. The reader presses "Suggest an edge" ON a concept page — so they have
 * already named the concept by pressing a link attached to it — and the form
 * then asked them to type it again. The badge showed the context; the field
 * ignored it.
 */
describe('the field starts from where the reader came from', () => {
  it('seeds an edge from a concept path', () => {
    expect(seededName('/c/attention')).toBe('attention ↔ ');
  });

  it('uses the slug rather than a guessed title', () => {
    // "kv-cache" prettied into "Kv Cache" would be wrong, and the form's own
    // placeholder uses "kv-cache" unmodified.
    expect(seededName('/c/kv-cache')).toBe('kv-cache ↔ ');
    expect(seededName('/c/mixture-of-experts')).toBe('mixture-of-experts ↔ ');
  });

  it('seeds nothing when the context is not a concept', () => {
    for (const ctx of ['', '/', '/concepts', '/search', '/request', '/c/', '/t/some-trail']) {
      expect(seededName(ctx)).toBe('');
    }
  });

  it('refuses anything that is not a plain kebab-case slug', () => {
    // contextFrom already rejects other origins; this is the second gate, so a
    // path that slipped through cannot become prefilled text.
    for (const ctx of ['/c/Attention', '/c/a b', '/c/x/y', '/c/-lead', '/c/trail-']) {
      expect(seededName(ctx)).toBe('');
    }
  });

  it('leaves a seeded value long enough to pass validation', () => {
    // The submit guard needs 2+ characters after trimming; "attention ↔" is fine
    // and an empty seed must not look like a filled field.
    expect(seededName('/c/attention').trim().length).toBeGreaterThan(2);
  });
});

/**
 * THE WIRING. `seededName` passing its own tests says nothing about whether the
 * field ever receives the value — twice in this session a tested pure function
 * turned out to have no caller (#452, #455). This drives the component.
 */
describe('the seeded value reaches the field', () => {
  const atConcept = (path: string) => {
    window.history.pushState({}, '', `/request?from=${encodeURIComponent(path)}`);
  };

  it('arrives prefilled when the reader came from a concept', async () => {
    atConcept('/c/attention');
    render(<RequestForm />);
    const field = await screen.findByLabelText(/what is missing/i);
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('attention ↔ '));
  });

  it('stays empty when there is no concept context', async () => {
    window.history.pushState({}, '', '/request');
    render(<RequestForm />);
    const field = await screen.findByLabelText(/what is missing/i);
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('is a starting point, not a fixture — the reader can replace it', async () => {
    atConcept('/c/attention');
    render(<RequestForm />);
    const field = (await screen.findByLabelText(/what is missing/i)) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('attention ↔ '));
    fireEvent.change(field, { target: { value: 'something else entirely' } });
    expect(field.value).toBe('something else entirely');
    fireEvent.change(field, { target: { value: '' } });
    expect(field.value).toBe('');
  });
});
