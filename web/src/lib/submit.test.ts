import { describe, expect, it } from 'vitest';
import { outcomeFor } from './submit';
import { confirmation } from '../components/ReviewActions';

const BAD = 'That could not be accepted. Try a shorter note.';

describe('outcomeFor maps a status to something a reader can act on', () => {
  it('202 is success', () => {
    expect(outcomeFor(202, null, BAD)).toEqual({ ok: true });
  });

  it('429 says how long to wait when the server said', () => {
    const out = outcomeFor(429, 45, BAD);
    expect(out).toEqual({ ok: false, message: 'Too many requests just now. Try again in 45 seconds.' });
  });

  it('429 without Retry-After does not invent a number', () => {
    expect(outcomeFor(429, null, BAD)).toEqual({
      ok: false,
      message: 'Too many requests just now. Try again shortly.',
    });
    // A zero header is the same as none: "try again in 0 seconds" is nonsense.
    expect(outcomeFor(429, 0, BAD)).toEqual({
      ok: false,
      message: 'Too many requests just now. Try again shortly.',
    });
  });

  it('400 says what is wrong with THIS form, not a generic failure', () => {
    expect(outcomeFor(400, null, BAD)).toEqual({ ok: false, message: BAD });
    expect(outcomeFor(400, null, 'Give it a shorter name.')).toEqual({
      ok: false,
      message: 'Give it a shorter name.',
    });
  });

  it('404 and 413 each say their own thing', () => {
    // The endpoint returns both; collapsing them would hide the actionable one.
    expect(outcomeFor(404, null, BAD)).not.toEqual(outcomeFor(413, null, BAD));
    expect(outcomeFor(413, null, BAD)).toMatchObject({ message: expect.stringContaining('too long') });
  });

  it('an unexpected status does not leak what broke', () => {
    const out = outcomeFor(500, null, BAD);
    expect(out).toMatchObject({ ok: false });
    expect((out as { message: string }).message).not.toMatch(/500|error|server/i);
  });

  it('never returns ok for a non-202', () => {
    for (const s of [200, 201, 204, 301, 400, 401, 403, 404, 413, 429, 500, 502, 503]) {
      expect(outcomeFor(s, null, BAD).ok).toBe(false);
    }
  });
});

describe('the confirmation text', () => {
  /**
   * ADR-0002: this endpoint records intent and never changes a tier. Promotion
   * happens when a human merges a PR. Copy implying the node just became
   * verified would be the interface lying about what the click did.
   */
  it('does not imply the node was promoted', () => {
    for (const kind of ['flag', 'volunteer'] as const) {
      expect(confirmation(kind)).not.toMatch(/verified|approved|promoted|accepted/i);
    }
  });

  it('says a human is involved, because one is', () => {
    expect(confirmation('flag')).toMatch(/human|queue/i);
    expect(confirmation('volunteer')).toMatch(/pull request|repository/i);
  });

  it('tells a flagger explicitly that nothing has changed yet', () => {
    expect(confirmation('flag')).toContain('nothing about this node has changed yet');
  });

  it('says something different for each action', () => {
    expect(confirmation('flag')).not.toBe(confirmation('volunteer'));
  });
});
