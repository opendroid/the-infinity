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
      },
    },
  },
];
