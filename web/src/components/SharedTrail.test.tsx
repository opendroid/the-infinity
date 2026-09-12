// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharedTrail, { arrival, pageTitle, slugFromPath } from './SharedTrail';

const TRAIL = {
  slug: 'dense-to-sparse-9k2f',
  title: 'From Attention to Mixture-of-Experts',
  created_at: '2026-08-01',
  duration_s: 640,
  stops: [
    { n: 1, id: 'attention', title: 'Attention', tier: 'frontier', depth_read_at: 'intuition' },
    { n: 2, id: 'causal-masking', title: 'Causal Masking', tier: 'frontier', depth_read_at: 'engineer' },
    { n: 3, id: 'mixture-of-experts', title: 'Mixture-of-Experts', tier: 'verified', depth_read_at: 'math' },
  ],
};

/** Never resolves, so the loading state can be observed rather than raced past. */
function pending() {
  return new Promise<Response>(() => {});
}

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  window.history.pushState({}, '', '/t/dense-to-sparse-9k2f');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * This route is the one whose content arrives after the page does (ADR-0008),
 * and until #140 nothing told a reader it had. Each of its four states was a
 * whole-page swap, so the loading state's region was REMOVED rather than
 * updated — measured on a real build: no live region on /t/ at all.
 *
 * The assertions below are on node identity for the same reason as #137: a
 * region that is present both before and after is the only shape a screen
 * reader hears as a change.
 */
describe('the shared trail route', () => {
  it('has a live region before the fetch resolves, and it is empty', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(pending);
    render(<SharedTrail />);

    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    // The visible skeleton text is not a second region competing with it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('announces the trail when it arrives, in that same region', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(TRAIL));
    render(<SharedTrail />);
    const before = screen.getByRole('status');

    await waitFor(() => expect(screen.getByRole('heading')).toBeDefined());

    const after = screen.getAllByRole('status')[0]!;
    expect(after).toBe(before); // the same node — not a new subtree
    expect(after.textContent).toBe('Trail loaded — 3 concepts.');
  });

  it('announces that there is no such trail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond({}, 404));
    render(<SharedTrail />);
    const before = screen.getByRole('status');

    await waitFor(() => expect(before.textContent).toBe('No such trail.'));
    expect(screen.getByRole('heading').textContent).toBe('No such trail');
  });

  it('announces that the graph is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    render(<SharedTrail />);
    const before = screen.getByRole('status');

    await waitFor(() => expect(before.textContent).toBe('The live graph is offline.'));
  });

  it('still renders the stops as an ordered list', async () => {
    // The trail's content IS its order; this is the one place numbering is not
    // decoration. Extracting the ready branch must not have cost it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(TRAIL));
    render(<SharedTrail />);

    await waitFor(() => expect(screen.getByRole('list')).toBeDefined());
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps both buttons, and the copy region beside them', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(TRAIL));
    render(<SharedTrail />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Walk this trail' })).toBeDefined());
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDefined();
    // Two regions now: the route's arrival and the ready state's "Link copied".
    // They belong to different lifetimes — see the note on Ready.
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});

describe('what each state says', () => {
  it('says nothing while loading', () => {
    expect(arrival({ name: 'loading' })).toBe('');
  });

  it('counts the stops, and does not repeat the title the h1 already carries', () => {
    const message = arrival({ name: 'ready', trail: TRAIL as never });
    expect(message).toBe('Trail loaded — 3 concepts.');
    expect(message).not.toContain(TRAIL.title);
  });

  it('says concept, singular, for a one-stop trail', () => {
    const one = { ...TRAIL, stops: TRAIL.stops.slice(0, 1) };
    expect(arrival({ name: 'ready', trail: one as never })).toBe('Trail loaded — 1 concept.');
  });
});

describe('slugFromPath', () => {
  it('reads the slug from the path', () => {
    expect(slugFromPath('/t/dense-to-sparse-9k2f')).toBe('dense-to-sparse-9k2f');
    expect(slugFromPath('/t/dense-to-sparse-9k2f/')).toBe('dense-to-sparse-9k2f');
  });

  it('rejects what cannot be a slug', () => {
    expect(slugFromPath('/t/Not_A_Slug')).toBeNull();
    expect(slugFromPath('/t/nope!')).toBeNull();
  });

  it('reads the bare /t/ as the segment "t", which resolves to no such trail', () => {
    // Not a defect and not changed here: "t" is shaped like a slug, so it goes
    // to the API, 404s, and lands on the state a bare /t/ should land on. The
    // alternative — a length floor — would decide the same thing one round trip
    // earlier and is not this issue's business.
    expect(slugFromPath('/t/')).toBe('t');
  });
});

/**
 * A stop whose concept was deleted from git (#56, ADR-0012).
 *
 * The trail is a record of a walk. When the graph moves underneath it the walk
 * did not change, so the stop stays, keeps its number and its title, and stops
 * being a link — because the only thing behind it now is a 404 the reader would
 * find by clicking.
 */
describe('a trail whose concept was deleted', () => {
  const WITH_MISSING = {
    slug: 'dense-to-sparse-9k2f',
    title: 'Dense to sparse',
    created_at: '2026-08-01',
    stops: [
      { n: 1, id: 'attention', title: 'Attention', tier: 'verified', depth_read_at: 'intuition' },
      { n: 2, id: 'gone', title: 'A Removed Concept', tier: 'frontier', depth_read_at: 'engineer', missing: true },
      { n: 3, id: 'kv-cache', title: 'KV Cache', tier: 'frontier', depth_read_at: 'math' },
    ],
  };

  function mount() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(WITH_MISSING));
    render(<SharedTrail />);
  }

  it('still renders every stop — the walk is a record and does not shrink', async () => {
    mount();
    await screen.findByText('A Removed Concept');
    expect(screen.getByText('Attention')).toBeTruthy();
    expect(screen.getByText('KV Cache')).toBeTruthy();
  });

  it('does not link the tombstoned stop, so nobody discovers it by clicking', async () => {
    mount();
    await screen.findByText('A Removed Concept');
    expect(screen.queryByRole('link', { name: /A Removed Concept/ })).toBeNull();
    // The living stops are still links.
    expect(screen.getByRole('link', { name: /Attention/ })).toBeTruthy();
  });

  it('says so in words, not by colour alone', async () => {
    mount();
    expect(await screen.findByText(/no longer in the graph/)).toBeTruthy();
  });

  it('keeps the numbering, because renumbering would falsify the walk', async () => {
    mount();
    await screen.findByText('A Removed Concept');
    for (const n of ['01', '02', '03']) {
      expect(screen.getByText(n)).toBeTruthy();
    }
  });
});

/**
 * #455. /t/ is one prerendered shell behind a firebase.json rewrite, so every
 * trail — real, deleted, or never-existing — arrived titled "A shared thread".
 * On a page whose heading says "No such trail" that is the tab, the bookmark,
 * the history entry and the first thing a screen reader reads, all disagreeing
 * with the page.
 */
describe('the document title follows the state', () => {
  it('names the failure when the trail is not there', () => {
    expect(pageTitle({ name: 'missing' })).toBe('No such trail — theinfinity.ai');
  });

  it('names the failure when the graph cannot be reached', () => {
    expect(pageTitle({ name: 'unreachable' })).toBe('The live graph is offline — theinfinity.ai');
  });

  it('keeps the shipped title where it is already right', () => {
    // "A shared thread" is correct while loading and once loaded; null means
    // leave it alone rather than rewrite it to the same thing.
    expect(pageTitle({ name: 'loading' })).toBeNull();
  });

  it('matches the heading the reader is looking at', () => {
    // The two must not drift: whatever the title claims, the h1 says the same.
    expect(pageTitle({ name: 'missing' })).toContain('No such trail');
    expect(pageTitle({ name: 'unreachable' })).toContain('The live graph is offline');
  });

  /**
   * THE WIRING, not the rule. Deleting the effect that calls pageTitle leaves
   * every assertion above green — a pure function nobody calls passes its own
   * tests forever (#452 and #429 both went this way), so the component has to
   * be driven and the real document.title read back.
   */
  it('actually sets the title when a trail 404s', async () => {
    document.title = 'A shared thread — theinfinity.ai';
    vi.spyOn(globalThis, 'fetch').mockReturnValue(respond({}, 404));

    render(<SharedTrail />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /no such trail/i })).toBeTruthy());
    await waitFor(() => expect(document.title).toBe('No such trail — theinfinity.ai'));
  });

  it('leaves the title alone for a trail that loads', async () => {
    document.title = 'A shared thread — theinfinity.ai';
    vi.spyOn(globalThis, 'fetch').mockReturnValue(respond(TRAIL));

    render(<SharedTrail />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(document.title).toBe('A shared thread — theinfinity.ai');
  });
});
