import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { normaliseOrigin } from './src/lib/api';

// TypeScript rather than .mjs so the API origin is validated by the SAME
// function the browser uses, at the moment the build starts. A second copy of
// the rule in JS would be free to disagree with the first, which is how the
// serving path and the pre-rendered path have drifted before.
//
// Throwing here fails `astro build` and `astro dev` with the reason. A malformed
// origin discovered in a browser is one discovered by a reader.
normaliseOrigin(process.env.PUBLIC_API_ORIGIN);

// Static-first (ADR-0003): every route pre-renders at build time. No adapter,
// no SSR. Islands call the API after hydration; first paint never waits on it.
export default defineConfig({
  // The canonical origin, used for canonical links, unfurl cards (#127), the
  // sitemap and llms.txt (#62, #85) — none of which can use a relative URL.
  //
  // Moved here from the Firebase host at the DNS cutover (#65), in the same
  // commit that lifted robots.txt and the blanket X-Robots-Tag. That grouping
  // is deliberate: the site is still reachable at the-infinity-ai.web.app, and
  // every page it serves now names this domain as canonical, which is what
  // stops one graph being indexed at two addresses.
  site: 'https://theinfinity.ai',
  output: 'static',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
