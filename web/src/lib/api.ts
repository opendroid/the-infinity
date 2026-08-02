/**
 * Where the API lives, in one place.
 *
 * No island builds a URL by hand. The `/api/v1` prefix in particular is
 * load-bearing and easy to get subtly wrong: Firebase Hosting rewrites `/api/**`
 * to Cloud Run *preserving the full path*, so a client calling `/v1/...` would
 * work against the Cloud Run URL and 404 through the domain — a failure that
 * appears only in production. See ADR-0001.
 *
 * In production the origin is empty and every call is same-origin, which means
 * no CORS, no preflight, and no second DNS lookup. In development there is no
 * Hosting rewrite, so `PUBLIC_API_ORIGIN` points at a locally running API.
 */

/** The mount point. Not `/v1`. See ADR-0001. */
const PREFIX = '/api/v1';

/**
 * Validates and normalises an origin, throwing on anything malformed.
 *
 * Pure and argument-taking rather than reading the environment itself, so
 * `astro.config.ts` can run it at build time against `process.env` and fail the
 * build. A bad origin discovered in a browser is a bad origin discovered by a
 * reader.
 *
 * An empty or absent value is valid and means same-origin — the production case.
 */
export function normaliseOrigin(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (value === '') return '';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `PUBLIC_API_ORIGIN is not a URL: ${JSON.stringify(value)}. ` +
        'Use an origin like http://localhost:8080, or leave it unset for same-origin.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PUBLIC_API_ORIGIN must be http or https, got ${JSON.stringify(url.protocol)}.`);
  }

  // A path here would be silently concatenated with /api/v1 and produce
  // /some/path/api/v1/... — a 404 that looks like a routing bug in the API.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `PUBLIC_API_ORIGIN must be a bare origin with no path, query, or fragment, got ${JSON.stringify(value)}.`,
    );
  }

  return url.origin;
}

/** The configured origin: empty in production, a local API in development. */
export function apiOrigin(): string {
  return normaliseOrigin(import.meta.env.PUBLIC_API_ORIGIN);
}

/**
 * Builds an absolute-or-same-origin URL for an API path.
 *
 * `path` is the part after `/api/v1` — `apiUrl('/stats')`, not
 * `apiUrl('/api/v1/stats')`. Taking the prefix out of every call site is the
 * point: it can then be wrong in one place instead of nine.
 */
export function apiUrl(path: string, origin: string = apiOrigin()): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/", got ${JSON.stringify(path)}.`);
  }
  return `${origin}${PREFIX}${path}`;
}
