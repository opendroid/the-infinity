import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

// Plain flat-config array rather than tseslint.config(), whose variadic
// signature is deprecated.
export default [
  {
    ignores: ['dist/**', '.astro/**', 'node_modules/**', 'src/styles/tokens.generated.css'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      // CLAUDE.md §4: no `any`; use `unknown` and narrow.
      '@typescript-eslint/no-explicit-any': 'error',
      // Underscore-prefixed bindings are the documented way to discard a
      // destructured field — graph.ts uses it to drop the authored edges.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Build scripts and the content loader run in Node, not the browser.
    files: ['scripts/**/*.mjs', 'src/lib/**/*.ts'],
    languageOptions: {
      // `fetch` and `AbortSignal` are Node globals from 18 on, used by
      // check-citations.mjs to resolve a citation. Listed rather than pulled in
      // via a globals package: the set a build script is allowed to reach for
      // is short, and keeping it short is the point.
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        // scripts/engine-probe reads its sibling probe file through an
        // import.meta.url URL, and writes screenshots as a Buffer.
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // THE ONE FILE HERE THAT IS NOT NODE. scripts/engine-probe/probe.js is
    // injected into the page under test and runs in the browser, so it reaches
    // for `document` and `getComputedStyle` rather than `process`. It is
    // deliberately not a module — the driver wraps the IIFE in `return …`,
    // because W3C execute/sync takes a function body and not an expression.
    files: ['scripts/engine-probe/probe.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        innerWidth: 'readonly',
        innerHeight: 'readonly',
        devicePixelRatio: 'readonly',
      },
    },
  },
];
