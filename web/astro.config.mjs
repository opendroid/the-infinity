// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Static-first (ADR-0003): every route pre-renders at build time. No adapter,
// no SSR. Islands call the API after hydration; first paint never waits on it.
export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
