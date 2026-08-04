import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import EdgeRow from './EdgeRow.astro';
import EdgeGroup from './EdgeGroup.astro';
import type { EdgeType, ResolvedEdge } from '../lib/graph';

/**
 * The accessible name, not the markup.
 *
 * #147 happened because the markup was right — a link, a title, a dot with a
 * correct `aria-hidden` — and the *name* that composition produced was a bare
 * title. Any assertion about elements or classes would have passed throughout.
 *
 * This is the accname algorithm reduced to what these components use: drop
 * `aria-hidden` subtrees, take the text, collapse whitespace. Anything that
 * needed more than that would be too clever for an edge row.
 */
function accessibleName(html: string): string {
  const visible = html
    // Elements marked aria-hidden contribute nothing, children included.
    .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+aria-hidden="true"[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '');
  return visible.replace(/\s+/g, ' ').trim();
}

const edge = (over: Partial<ResolvedEdge> = {}): ResolvedEdge =>
  ({ id: 'cross-attention', title: 'Cross-Attention', tier: 'frontier', reviewed: false, ...over }) as ResolvedEdge;

async function renderRow(type: EdgeType, e: ResolvedEdge = edge()) {
  const container = await AstroContainer.create();
  return accessibleName(await container.renderToString(EdgeRow, { props: { edge: e, type } }));
}

describe('an edge link announces what kind of edge it is', () => {
  it('was a bare title before #147, and is not now', async () => {
    const name = await renderRow('unlocks');
    expect(name).not.toBe('Cross-Attention');
    expect(name).toContain('Cross-Attention');
  });

  it('names the relationship, so a links list is not three groups flattened', async () => {
    expect(await renderRow('requires')).toContain('requires');
    expect(await renderRow('unlocks')).toContain('unlocks');
    expect(await renderRow('adjacent')).toContain('adjacent to');
  });

  it('names the tier, which was carried by colour alone', async () => {
    expect(await renderRow('unlocks', edge({ tier: 'frontier' }))).toContain('frontier');
    expect(await renderRow('unlocks', edge({ tier: 'verified', reviewed: true }))).toContain('verified');
  });

  it('leads with the title, which is what a reader scans for', async () => {
    expect(await renderRow('unlocks')).toMatch(/^Cross-Attention/);
  });

  it('does not let the dot speak — it is decoration here, the word carries it', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(EdgeRow, { props: { edge: edge(), type: 'unlocks' } });
    // One tier word in the name, not two: the dot is aria-hidden and the
    // sr-only span is what says it.
    expect((await renderRow('unlocks')).match(/frontier/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('an edge group heading', () => {
  const render = async (type: EdgeType) => {
    const container = await AstroContainer.create();
    return accessibleName(
      await container.renderToString(EdgeGroup, { props: { type, edges: [edge()], from: '/c/attention' } }),
    );
  };

  it('does not read its decorative arrow', async () => {
    // It announced as "◂REQUIRES" — the glyph unhidden and glued to the word.
    for (const [type, word] of [
      ['requires', 'Requires'],
      ['unlocks', 'Unlocks'],
      ['adjacent', 'Adjacent'],
    ] as const) {
      const name = await render(type);
      expect(name).toContain(word);
      expect(name).not.toMatch(/[◂▸↔]/);
    }
  });
});
