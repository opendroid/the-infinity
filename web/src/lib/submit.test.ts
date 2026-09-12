import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageFor, postCreate, postQueue, readApiError } from './submit';
import { confirmation } from '../components/ReviewActions';

const BAD = 'That could not be accepted. Try a shorter note.';

describe('messageFor says what a reader can act on', () => {
  it('429 says how long to wait when the server said', () => {
    expect(messageFor(429, 45, BAD)).toBe('Too many requests just now. Try again in 45 seconds.');
  });

  it('429 without Retry-After does not invent a number', () => {
    expect(messageFor(429, null, BAD)).toBe('Too many requests just now. Try again shortly.');
    // A zero header is the same as none: "try again in 0 seconds" is nonsense.
    expect(messageFor(429, 0, BAD)).toBe('Too many requests just now. Try again shortly.');
  });

  it('400 says what is wrong with THIS request, not a generic failure', () => {
    expect(messageFor(400, null, BAD)).toBe(BAD);
    expect(messageFor(400, null, '"name" must be at least 2 characters.')).toBe(
      '"name" must be at least 2 characters.',
    );
  });

  it('404 and 413 each say their own thing', () => {
    // The endpoint returns both; collapsing them would hide the actionable one.
    expect(messageFor(404, null, BAD)).not.toBe(messageFor(413, null, BAD));
    expect(messageFor(413, null, BAD)).toContain('too long');
  });

  it('an unexpected status does not leak what broke', () => {
    expect(messageFor(500, null, BAD)).not.toMatch(/500|error|server/i);
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

describe('postQueue reports the rejection the API described', () => {
  const GUESS = 'That name was not accepted. Try a shorter one.';

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

  it('202 is success', async () => {
    respond(202, { status: 'queued' });
    expect(await postQueue('/requests', {}, GUESS)).toEqual({ ok: true });
  });

  /**
   * #447, and the reason it is reachable at all. Both forms guard on
   * `name.trim().length < 2` before sending, but `String.length` counts UTF-16
   * code units and the server counts runes: a single emoji is 2 to the client
   * and 1 to Go. So the reader typed one character, got past the guard, and was
   * told by the form to try a SHORTER one.
   */
  it('does not tell a too-short name to get shorter', async () => {
    respond(400, {
      error: 'invalid_request',
      message: '"name" must be at least 2 characters.',
      details: { field: 'name' },
    });
    const out = await postQueue('/requests', { name: '👍' }, GUESS);
    expect(out).toEqual({ ok: false, message: '"name" must be at least 2 characters.' });
    expect((out as { message: string }).message).not.toMatch(/shorter/i);
  });

  it('keeps the caller string for a 400 the API did not explain', async () => {
    respond(400, undefined);
    expect(await postQueue('/requests', {}, GUESS)).toEqual({ ok: false, message: GUESS });
  });

  /**
   * A 500's message is ours and deliberately says nothing; a 429's is about
   * waiting. Neither is improved by whatever prose the server attached.
   */
  it('does not let the API rewrite a non-400', async () => {
    respond(500, { message: 'firestore: deadline exceeded on projects/the-infinity-ai' });
    expect(await postQueue('/reviews', {}, GUESS)).toEqual({
      ok: false,
      message: 'It could not be sent. The graph is still here.',
    });
  });

  it('a 429 still carries its own Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Too many requests. Try again shortly.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
        }),
      ),
    );
    expect(await postQueue('/requests', {}, GUESS)).toEqual({
      ok: false,
      message: 'Too many requests just now. Try again in 30 seconds.',
    });
  });

  it('says nothing was sent when the request never left', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await postQueue('/requests', {}, GUESS)).toEqual({
      ok: false,
      message: 'No connection. Nothing was sent.',
    });
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
