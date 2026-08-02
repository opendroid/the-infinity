import { describe, expect, it } from 'vitest';
import { slugFromPath } from './RequestConcept';

/**
 * One 404.html serves every unmatched path, so this decides whether the page is
 * "a concept is missing" or just "that URL is not a page". Getting it wrong in
 * the permissive direction means asking the API about `/favicon.ico` and
 * offering to add it to the graph.
 */
describe('slugFromPath', () => {
  const concepts: { path: string; want: string }[] = [
    { path: '/c/mixture-of-experts', want: 'mixture-of-experts' },
    { path: '/c/attention', want: 'attention' },
    { path: '/c/gpt-4', want: 'gpt-4' },
    // Hosting is configured with trailingSlash: false, but a reader can type one.
    { path: '/c/attention/', want: 'attention' },
    { path: '/c/mixture%2Dof%2Dexperts', want: 'mixture-of-experts' },
  ];

  for (const c of concepts) {
    it(`reads ${c.path}`, () => {
      expect(slugFromPath(c.path)).toBe(c.want);
    });
  }

  const notConcepts: { name: string; path: string }[] = [
    { name: 'the landing page', path: '/' },
    { name: 'a trail', path: '/t/attention-to-moe-1a2b' },
    { name: 'an asset', path: '/favicon.ico' },
    { name: 'a nested path under /c', path: '/c/a/b' },
    { name: 'the bare prefix', path: '/c/' },
    // These reach a 404 but cannot be concept ids, so treating them as a
    // missing concept would mean asking the API a question it cannot answer
    // and offering to add nonsense to the graph.
    { name: 'uppercase', path: '/c/Attention' },
    { name: 'a single character', path: '/c/a' },
    { name: 'a path traversal', path: '/c/..' },
    { name: 'a name with spaces', path: '/c/mixture of experts' },
    { name: 'an over-long slug', path: `/c/${'a'.repeat(65)}` },
  ];

  for (const c of notConcepts) {
    it(`rejects ${c.name}`, () => {
      expect(slugFromPath(c.path)).toBeNull();
    });
  }
});
