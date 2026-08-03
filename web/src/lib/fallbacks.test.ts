import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { contextFrom } from '../components/RequestForm';
import { buildIndex, search } from './search';
import { allNodes } from './content';

/**
 * The states that are ordinary rather than exceptional (#53).
 *
 * A leaf concept has no `unlocks`, and Cloud Run scales to zero, so "the API is
 * unreachable" is a Tuesday. The rule both serve is that the graph never
 * dead-ends — and an empty state that says nothing is a dead end with better
 * typography.
 */

const WEB = resolve(process.cwd());
const PAGES = join(WEB, 'src/pages');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

describe('the empty edge group offers somewhere to go', () => {
  it('is reachable — most concepts have at least one empty group', () => {
    // If nothing rendered it, the state would be designed and never seen, and
    // its dead link would have stayed invisible.
    const empty = allNodes.filter(
      (n) => n.edges.requires.length === 0 || n.edges.unlocks.length === 0 || n.edges.adjacent.length === 0,
    );
    expect(empty.length).toBeGreaterThan(allNodes.length / 2);
  });

  it('says something different for each group, because they mean different things', () => {
    // "Nothing builds on this yet" is true of an empty Unlocks and false of
    // the other two; one shared sentence read as a rendering bug.
    const source = read('src/components/EdgeGroup.astro');
    // Scoped to the EMPTY map: the file also has ARROW and LABEL keyed by the
    // same three names, and an unscoped search happily returned '◂'.
    const block = /const EMPTY[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
    expect(block, 'no EMPTY map in EdgeGroup.astro').not.toBeNull();

    const sentences = (['requires', 'unlocks', 'adjacent'] as const).map((type) => {
      const match = new RegExp(`${type}:\\s*(?:\\n\\s*)?(['"\`])([\\s\\S]*?)\\1`).exec(block![1]!);
      expect(match, `no empty-state sentence for ${type}`).not.toBeNull();
      return match![2]!;
    });
    expect(new Set(sentences).size).toBe(3);
    for (const s of sentences) expect(s.length).toBeGreaterThan(24);
  });
});

describe('no link anywhere in /web points at a route that does not exist', () => {
  /**
   * `/request` was linked from every concept page with an empty edge group —
   * 40 of 57 have no `adjacent` — and the route did not exist. Nothing caught
   * it because nothing looked. This looks.
   *
   * Scoped to `href` so that API paths like `postQueue('/requests', …)` are not
   * mistaken for routes, and forgiving of the shapes an href actually takes:
   * a bare string, a template literal, a ternary between two of them.
   */
  const DYNAMIC = ['/c/', '/t/'];

  /**
   * Every `href=` value in a file, with `{…}` matched by counting depth.
   *
   * The first version used a lazy `\{[^>]*?\}` and stopped at the first `}` it
   * saw — which, in `href={from ? \`/x?from=${enc(from)}\` : '/y'}`, is the one
   * closing the interpolation. It never looked at the else branch. Proved by
   * pointing that branch at a route that does not exist and watching the check
   * stay green.
   */
  function hrefExpressions(source: string): string[] {
    const out: string[] = [];
    for (const m of source.matchAll(/href\s*=\s*/g)) {
      let i = m.index! + m[0].length;
      const open = source[i];
      if (open === '"' || open === "'") {
        const close = source.indexOf(open, i + 1);
        if (close !== -1) out.push(source.slice(i, close + 1));
        continue;
      }
      if (open !== '{') continue;
      let depth = 0;
      for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
      }
      out.push(source.slice(m.index! + m[0].length, i + 1));
    }
    return out;
  }

  function internalHrefs(): Array<{ file: string; href: string }> {
    const found: Array<{ file: string; href: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(astro|tsx)$/.test(entry.name)) continue;
        const source = readFileSync(full, 'utf8');
        for (const expr of hrefExpressions(source)) {
          for (const lit of expr.matchAll(/['"`](\/[^'"`\s${]*)/g)) {
            found.push({ file: full.slice(WEB.length + 1), href: lit[1]! });
          }
        }
      }
    };
    walk(join(WEB, 'src'));
    return found;
  }

  it('finds the links it is meant to be checking', () => {
    // A checker that matched nothing would pass forever.
    const hrefs = internalHrefs();
    expect(hrefs.length).toBeGreaterThan(5);
    expect(hrefs.some((h) => h.href === '/request')).toBe(true);
    expect(hrefs.some((h) => h.href === '/concepts')).toBe(true);
  });

  it('resolves every one of them', () => {
    const routes = new Set(pageRoutes());
    const dead = internalHrefs()
      .filter(({ href }) => !DYNAMIC.some((p) => href.startsWith(p)))
      .filter(({ href }) => !routes.has(href.replace(/[?#].*$/, '')))
      .map(({ file, href }) => `${file} → ${href}`);
    expect(dead).toEqual([]);
  });
});

/**
 * Every path the site actually serves: built pages, plus whatever is copied
 * verbatim out of `public/` — `/favicon.svg` is a real target and not a route.
 */
function pageRoutes(): string[] {
  const out: string[] = [];
  for (const asset of readdirSync(join(WEB, 'public'))) out.push(`/${asset}`);
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith('.astro')) continue;
      const base = entry.name.replace(/\.astro$/, '');
      if (base.startsWith('[')) continue; // dynamic; not a fixed target
      out.push(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
    }
  };
  walk(PAGES, '');
  return out;
}

describe('search survives the API being unreachable', () => {
  it('matches without touching the API — this is the state that proves it', () => {
    // ADR-0003 defers GET /v1/search precisely so this holds. The index is a
    // build-time artifact served from the CDN.
    const hits = search(buildIndex(allNodes), 'lora');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('is fetched from the site, not from the API', () => {
    const source = read('src/components/SearchPanel.tsx');
    expect(source).toContain("fetch('/search-index.json')");
    // apiUrl() would route it through /api/v1 and take search down with the API.
    expect(source).not.toMatch(/apiUrl\(/);
  });

  it('ships as a static endpoint, so it is on the CDN', () => {
    expect(() => read('src/pages/search-index.json.ts')).not.toThrow();
  });
});

describe('islands keep their server-rendered content when a fetch fails', () => {
  const cases: Array<[file: string, why: string]> = [
    ['src/components/MiniMap.tsx', 'the build-time map is already correct; an apology would be worse'],
    ['src/components/RequestConcept.tsx', 'the 404 shell already says the graph has a gap'],
  ];

  for (const [file, why] of cases) {
    it(`${file} swallows a failed fetch — ${why}`, () => {
      const source = read(file);
      expect(source).toMatch(/\.catch\(|catch\s*\{/);
      // Nothing may replace working content with a spinner that never ends.
      expect(source).not.toMatch(/setInterval|while \(true\)/);
    });
  }

  it('every API caller handles rejection', () => {
    // A bare `await fetch(...)` with no catch is how a page ends up blank when
    // Cloud Run is cold.
    for (const file of ['src/components/MiniMap.tsx', 'src/components/SharedTrail.tsx', 'src/lib/submit.ts']) {
      const source = read(file);
      const fetches = (source.match(/fetch\(/g) ?? []).length;
      const guards = (source.match(/\.catch\(|catch\s*(\{|\()/g) ?? []).length;
      expect(guards).toBeGreaterThanOrEqual(fetches > 0 ? 1 : 0);
    }
  });
});

describe('failure text is honest, specific, and not carried by colour', () => {
  const surfaces = [
    'src/components/SharedTrail.tsx',
    'src/components/RequestForm.tsx',
    'src/components/RequestConcept.tsx',
    'src/components/ReviewActions.tsx',
    'src/components/TrailRibbon.tsx',
    'src/components/SearchPanel.tsx',
  ];

  it('announces failures to assistive technology, not only visually', () => {
    for (const file of surfaces) {
      const source = read(file);
      if (!/message|could not|offline|No such/i.test(source)) continue;
      expect(source, `${file} shows a failure with no role`).toMatch(/role="(alert|status)"/);
    }
  });

  it('never says only "something went wrong"', () => {
    for (const file of surfaces) {
      expect(read(file).toLowerCase()).not.toContain('something went wrong');
    }
  });

  it('offers a way onward from every dead end', () => {
    // The graph never dead-ends: each terminal state names somewhere to go.
    for (const file of ['src/components/SharedTrail.tsx', 'src/components/SearchPanel.tsx']) {
      expect(read(file)).toContain('/concepts');
    }
  });
});

describe('the request page', () => {
  it('only accepts a path of ours as context', () => {
    // A full URL from an untrusted referrer would put someone else's origin
    // into our queue, and `make queues` prints it verbatim.
    expect(contextFrom('?from=%2Fc%2Fadam', '')).toBe('/c/adam');
    expect(contextFrom('?from=https://evil.example/x', '')).toBe('');
    expect(contextFrom('?from=//evil.example', '')).toBe('');
    expect(contextFrom('', '')).toBe('');
  });

  it('renders without JavaScript as a page that still says what it is', () => {
    const source = read('src/pages/request.astro');
    expect(source).toContain('Gap in the graph');
    // The way in that needs no API at all.
    expect(source).toContain('the repository');
  });
});
