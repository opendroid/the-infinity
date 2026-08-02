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
  output: 'static',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
