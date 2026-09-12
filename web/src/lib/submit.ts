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
  return { ok: false, message: messageFor(status, retryAfter, badRequest) };
}

/**
 * The rejection mapping alone, for a caller that has already established the
 * response is one. Split out of `outcomeFor` so that caller does not have to
 * re-narrow a union that cannot be `ok`, which would leave an unreachable
 * branch for a reader to puzzle over.
 */
export function messageFor(status: number, retryAfter: number | null, badRequest: string): string {
  if (status === 429) {
    return retryAfter && retryAfter > 0
      ? `Too many requests just now. Try again in ${retryAfter} seconds.`
      : 'Too many requests just now. Try again shortly.';
  }
  if (status === 400) return badRequest;
  if (status === 404) return 'That concept is not in the graph.';
  if (status === 413) return 'That was too long to send. Shorten it and try again.';
  // Anything else is ours, not theirs — say so without leaking what broke.
  return 'It could not be sent. The graph is still here.';
}

/**
 * A rejection as the API itself described it.
 *
 * `message` is written for a human and it is true. A caller's own `badRequest`
 * string is a guess made once and outlived by the reasons it was written for:
 * `POST /trails` can reject a walk six different ways and the ribbon called
 * every one of them "It may be too long", including for a trail of 36 stops
 * against a cap of 200 (#445).
 *
 * `missingStops` is the half a client can act on rather than display — the
 * stops whose concepts are gone, which it drops before retrying.
 */
export interface ApiError {
  message: string | null;
  missingStops: string[];
}

/** Reads an error body. Trusts nothing: every field is checked, not cast. */
export function readApiError(value: unknown): ApiError {
  const none: ApiError = { message: null, missingStops: [] };
  if (typeof value !== 'object' || value === null) return none;
  const v = value as Record<string, unknown>;

  const message = typeof v.message === 'string' && v.message.trim() !== '' ? v.message : null;

  const details = typeof v.details === 'object' && v.details !== null ? v.details : {};
  const raw = (details as Record<string, unknown>).missing_stops;
  const missingStops = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];

  return { message, missingStops };
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

/**
 * A create that hands something back — currently only `POST /trails`.
 *
 * `missingStops` rides on the failure because one rejection is repairable: a
 * trail carrying a concept that has since been renamed or removed is otherwise
 * fine, and the caller can drop exactly those stops and try again (#445).
 */
export type Created<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; missingStops?: string[] };

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
  const retryAfter = Number.isFinite(retry) ? retry : null;

  if (res.status !== 201) {
    // The API's own message beats the caller's, and its details are the only
    // way to know which stops to drop. Reading the body here rather than in the
    // success path below is safe: a response body is consumed once, and these
    // two branches are exclusive.
    const api = readApiError(await json(res));
    const message = messageFor(res.status, retryAfter, api.message ?? badRequest);
    return api.missingStops.length > 0 ? { ok: false, message, missingStops: api.missingStops } : { ok: false, message };
  }

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

/** `res.json()`, or null for a body that is not JSON. An error page is not. */
async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
