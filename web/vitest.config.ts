import { getViteConfig } from 'astro/config';

/**
 * Vitest ran on its defaults until #147, which needed to assert on the
 * accessible NAME an `.astro` component produces rather than on its markup —
 * and the markup was right throughout that bug, so nothing weaker would have
 * caught it. Vitest cannot parse `.astro` without Astro's own Vite plugins.
 *
 * `getViteConfig` is Astro's supported way to hand them over, and that is all
 * this file does. No `test` block: every option worth setting was already the
 * default, and `getViteConfig` types its argument as Vite's `UserConfig`, which
 * has no `test` key — so writing one that restates a default costs an
 * `astro check` error for nothing.
 *
 * Per-file environments still come from the `@vitest-environment` docblocks the
 * React component tests carry, so nothing about the existing suite changes.
 */
export default getViteConfig({});
