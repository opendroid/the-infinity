import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const robots = read('public/robots.txt');
const hosting = JSON.parse(read('firebase.json')) as {
  hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
};

const headersFor = (source: string) =>
  hosting.hosting.headers.find((h) => h.source === source)?.headers ?? [];
const keys = (source: string) => headersFor(source).map((h) => h.key);

/**
 * The cutover (#65) is one commit that changes three things at once, and each
 * of them is silently wrong on its own: a sitemap on a `noindex` site, a
 * `Sitemap:` line pointing at a parked domain, canonical URLs naming a host
 * that does not resolve.
 *
 * Nothing breaks when these regress. The site simply becomes invisible again,
 * which looks exactly like SEO that has not paid off yet — the failure mode
 * #65 was filed warning about.
 */
describe('the site asks to be indexed', () => {
  it('does not disallow anything', () => {
    expect(robots).not.toMatch(/^\s*Disallow:\s*\/\s*$/m);
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
  });

  it('points crawlers at the sitemap, on the real domain', () => {
    expect(robots).toMatch(/^Sitemap: https:\/\/theinfinity\.ai\/sitemap\.xml$/m);
  });

  it('carries no blanket noindex header', () => {
    // The `**` block still exists — it holds nosniff and Referrer-Policy — so
    // this checks the one key rather than the block's absence.
    expect(keys('**')).not.toContain('X-Robots-Tag');
    expect(keys('**')).toEqual(expect.arrayContaining(['X-Content-Type-Options', 'Referrer-Policy']));
  });
});

/**
 * ADR-0008: a shared trail is reader-authored, unreviewed and unbounded in
 * number, and is the one route that keeps the header after the blanket one
 * lifts. That decision is a single line in firebase.json and nothing else
 * would notice its removal.
 */
describe('shared trails stay out of the index', () => {
  it('keeps its own noindex header', () => {
    const trail = headersFor('/t/**');
    expect(trail.find((h) => h.key === 'X-Robots-Tag')?.value).toBe('noindex, nofollow');
  });

  it('is not disallowed in robots.txt, which would hide the header from crawlers', () => {
    // The distinction the file's comment exists for: robots.txt stops the
    // CRAWL, the header stops the INDEX, and a page linked from elsewhere can
    // be indexed without ever being crawled. Disallowing /t/ would mean the
    // noindex is never seen.
    expect(robots).not.toMatch(/^\s*Disallow:\s*\/t\//m);
  });

  it('keeps the cache header it already had', () => {
    // Adding a key to an existing block is where the other keys get lost.
    expect(keys('/t/**')).toContain('Cache-Control');
  });
});
