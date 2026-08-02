/// <reference types="astro/client" />

/**
 * The origin islands call the API on.
 *
 * Unset in production, where Hosting rewrites `/api/**` to Cloud Run and every
 * call is same-origin. Set in development, where there is no rewrite and the API
 * runs somewhere else — typically `http://localhost:8080`.
 *
 * Declared here so `import.meta.env.PUBLIC_API_ORIGIN` is typed rather than
 * `any`, which under `noUncheckedIndexedAccess` is the difference between a
 * compile error and a silent `undefined` in a URL.
 */
interface ImportMetaEnv {
  readonly PUBLIC_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
