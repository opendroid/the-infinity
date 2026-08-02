import { describe, expect, it } from 'vitest';
import { apiUrl, normaliseOrigin } from './api';

describe('normaliseOrigin', () => {
  it('treats absent and empty as same-origin, which is production', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(normaliseOrigin(raw)).toBe('');
    }
  });

  it('keeps a bare origin', () => {
    expect(normaliseOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normaliseOrigin('https://api.example.test')).toBe('https://api.example.test');
  });

  it('drops a trailing slash, which would double up against the prefix', () => {
    expect(normaliseOrigin('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  const rejected: { name: string; value: string }[] = [
    { name: 'not a URL at all', value: 'localhost:8080' },
    { name: 'a protocol we cannot fetch over', value: 'ftp://example.test' },
    // This one is the reason the check is stricter than "is it a URL". A path
    // here is silently concatenated with /api/v1 to give /api/api/v1/stats — a
    // 404 that reads like a routing bug in the API rather than a config typo.
    { name: 'an origin carrying a path', value: 'http://localhost:8080/api' },
    { name: 'an origin carrying a query', value: 'http://localhost:8080/?x=1' },
    { name: 'an origin carrying a fragment', value: 'http://localhost:8080/#x' },
  ];

  for (const c of rejected) {
    it(`rejects ${c.name}`, () => {
      expect(() => normaliseOrigin(c.value)).toThrow(/PUBLIC_API_ORIGIN/);
    });
  }
});

describe('apiUrl', () => {
  it('mounts under /api/v1, not /v1', () => {
    // ADR-0001: Hosting preserves the full path, so /v1 would work against the
    // Cloud Run URL and 404 through the domain.
    expect(apiUrl('/stats', '')).toBe('/api/v1/stats');
  });

  it('is same-origin when no origin is configured', () => {
    expect(apiUrl('/concepts/mixture-of-experts', '')).not.toMatch(/^https?:/);
  });

  it('prefixes a configured origin', () => {
    expect(apiUrl('/stats', 'http://localhost:8080')).toBe('http://localhost:8080/api/v1/stats');
  });

  it('rejects a path that does not start with a slash', () => {
    expect(() => apiUrl('stats', '')).toThrow(/must start with/);
  });

  it('takes the path after the prefix, not the whole path', () => {
    // Guards the mistake the signature invites: passing the full path yields
    // /api/v1/api/v1/stats, which 404s in a way that looks like a server fault.
    expect(apiUrl('/stats', '')).not.toContain('/api/v1/api/v1');
  });
});
