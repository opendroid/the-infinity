import { getViteConfig } from 'astro/config';

/**
 * Vitest ran on its defaults until #147, which needed to assert on the
 * accessible NAME an `.astro` component produces rather than on its markup —
 * and the markup was right throughout the bug, so nothing weaker would have
 * caught it. Vitest cannot parse `.astro` without Astro's own Vite plugins.
 *
 * `getViteConfig` is Astro's supported way to hand them over. Per-file
 * environments still come from the `@vitest-environment` docblocks the React
 * component tests carry, so nothing about the existing suite changes.
 */
export default getViteConfig({
  test: {
    // The default, stated: node for everything, and the handful of component
    // tests that need a DOM opt in per file.
    environment: 'node',
  },
});
