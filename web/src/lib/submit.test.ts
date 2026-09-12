import { afterEach, describe, expect, it, vi } from 'vitest';
import { outcomeFor, postCreate, readApiError } from './submit';
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

describe('readApiError takes only what the body actually says', () => {
  it('reads the message and the stops to drop', () => {
    expect(
      readApiError({
        error: 'invalid_request',
        message: 'These stops name concepts that no longer exist: ghost, phantom.',
        details: { field: 'stops', missing_stops: ['ghost', 'phantom'] },
      }),
    ).toEqual({
      message: 'These stops name concepts that no longer exist: ghost, phantom.',
      missingStops: ['ghost', 'phantom'],
    });
  });

  it('has no message when the body has none worth showing', () => {
    expect(readApiError({}).message).toBeNull();
    expect(readApiError({ message: '   ' }).message).toBeNull();
    expect(readApiError({ message: 42 }).message).toBeNull();
  });

  /**
   * The body is parsed JSON from the network. A `details` that is a string, a
   * `missing_stops` that is a number, an HTML error page that parsed as null —
   * none of them may become a stop id we then delete from the reader's trail.
   */
  it('survives a body that is not the shape we expect', () => {
    for (const junk of [null, undefined, 'nope', 7, [], { details: 'stops' }, { details: { missing_stops: 3 } }]) {
      expect(readApiError(junk)).toEqual({ message: null, missingStops: [] });
    }
    expect(readApiError({ details: { missing_stops: ['ok', 9, null] } }).missingStops).toEqual(['ok']);
  });
});

describe('postCreate reports the rejection the API described', () => {
  const narrow = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { slug: string }) : null);
  const GUESS = 'That trail could not be shared. The graph is still here.';

  function respond(status: number, body: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The defect in #445. `POST /trails` rejects a walk six different ways and
   * the caller's one string called every one of them "It may be too long" —
   * for a 36-stop trail against a cap of 200. The API's own message is true.
   */
  it('prefers the API message to the caller fallback on a 400', async () => {
    respond(400, { error: 'invalid_request', message: '"duration_s" is out of range.' });
    const out = await postCreate('/trails', {}, GUESS, narrow);
    expect(out).toEqual({ ok: false, message: '"duration_s" is out of range.' });
  });

  it('falls back when the API said nothing readable', async () => {
    respond(400, undefined);
    expect(await postCreate('/trails', {}, GUESS, narrow)).toEqual({ ok: false, message: GUESS });
  });

  it('hands the stops to drop back to the caller', async () => {
    respond(400, {
      message: 'These stops name concepts that no longer exist: ghost.',
      details: { field: 'stops', missing_stops: ['ghost'] },
    });
    expect(await postCreate('/trails', {}, GUESS, narrow)).toEqual({
      ok: false,
      message: 'These stops name concepts that no longer exist: ghost.',
      missingStops: ['ghost'],
    });
  });

  /**
   * A 500's message is ours and says nothing useful; a 429's is about waiting.
   * Neither is improved by whatever prose the server attached.
   */
  it('does not let the API rewrite a non-400', async () => {
    respond(500, { message: 'firestore: deadline exceeded on projects/the-infinity-ai' });
    const out = await postCreate('/trails', {}, GUESS, narrow);
    expect(out).toEqual({ ok: false, message: 'It could not be sent. The graph is still here.' });
  });

  it('reads the created resource on a 201', async () => {
    respond(201, { slug: 'a-trail-0000', url: '/t/a-trail-0000' });
    expect(await postCreate('/trails', {}, GUESS, narrow)).toMatchObject({ ok: true });
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
