/**
 * Posting to one of the queue endpoints, and turning the answer into something
 * a reader can act on.
 *
 * Both public writes — `POST /requests` and `POST /reviews` — are the same
 * shape: send JSON, get `202` or a reason. This lives in one place because the
 * reason-mapping is where the care is, and two copies of it would drift the
 * first time a status was added.
 *
 * The mapping is deliberately not "something went wrong". Each rejection means
 * a different thing to the person who just clicked: one is worth retrying in a
 * minute, one means fix your input, one means the network is gone. Collapsing
 * them hides the only one they can act on.
 */
import { apiUrl } from './api';

export type Outcome = { ok: true } | { ok: false; message: string };

/**
 * The message for a status, given what a 400 means for this particular form.
 *
 * `okStatus` because the two write shapes disagree about success: the queue
 * endpoints answer 202 (accepted, nothing created), and `POST /trails` answers
 * 201 with a slug. Defaulting to 202 keeps every existing call site reading the
 * same.
 */
export function outcomeFor(
  status: number,
  retryAfter: number | null,
  badRequest: string,
  okStatus = 202,
): Outcome {
  if (status === okStatus) return { ok: true };
  if (status === 429) {
    return {
      ok: false,
      message:
        retryAfter && retryAfter > 0
          ? `Too many requests just now. Try again in ${retryAfter} seconds.`
          : 'Too many requests just now. Try again shortly.',
    };
  }
  if (status === 400) return { ok: false, message: badRequest };
  if (status === 404) return { ok: false, message: 'That concept is not in the graph.' };
  if (status === 413) return { ok: false, message: 'That was too long to send. Shorten it and try again.' };
  // Anything else is ours, not theirs — say so without leaking what broke.
  return { ok: false, message: 'It could not be sent. The graph is still here.' };
}

/** POSTs JSON to an API path and maps the answer. Never throws. */
export async function postQueue(
  path: string,
  body: unknown,
  badRequest: string,
): Promise<Outcome> {
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const retry = Number(res.headers.get('Retry-After') ?? '');
    return outcomeFor(res.status, Number.isFinite(retry) ? retry : null, badRequest);
  } catch {
    // Offline, aborted, or the service is cold. Distinct from a rejection,
    // because "we did not send it" and "they refused it" are different facts.
    return { ok: false, message: 'No connection. Nothing was sent.' };
  }
}

/** A create that hands something back — currently only `POST /trails`. */
export type Created<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * POSTs and reads the created resource out of the response.
 *
 * `narrow` rather than a cast: the one caller navigates the reader to whatever
 * comes back, so a response that is not the shape we expect must fail as a
 * failure and not as a trip to `/t/undefined`.
 */
export async function postCreate<T>(
  path: string,
  body: unknown,
  badRequest: string,
  narrow: (value: unknown) => T | null,
): Promise<Created<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'No connection. Nothing was sent.' };
  }

  const retry = Number(res.headers.get('Retry-After') ?? '');
  const outcome = outcomeFor(res.status, Number.isFinite(retry) ? retry : null, badRequest, 201);
  if (!outcome.ok) return outcome;

  try {
    const value = narrow(await res.json());
    if (value === null) throw new Error('unexpected shape');
    return { ok: true, value };
  } catch {
    // A 201 we cannot read is our problem, not the reader's, and it is not a
    // success: acting on it would send them somewhere that does not exist.
    return { ok: false, message: 'It was saved, but the link came back unreadable.' };
  }
}
