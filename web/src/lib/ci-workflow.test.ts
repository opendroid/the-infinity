import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The ORDER of the web job's steps, asserted (#423).
 *
 * `check:explainers --fast` is the only gate in ci.yml that talks to a third
 * party, and it used to run sixth of thirteen. On 2026-09-11 en.wikipedia.org
 * failed to answer, the step exited 2, and the job SKIPPED lint, typecheck, the
 * whole test suite, the build, the perf budget and all ten smoke assertions — on
 * a push to `main`. A blip at a third party did not merely add noise; it
 * silently disabled every check that gates the code, and blamed something else.
 *
 * Moving it last cannot stop `main` going red for a reason nobody caused. It
 * makes the red HONEST: everything else has run and reported first.
 *
 * This is a text scan rather than a YAML parse on purpose — the repository has
 * no YAML dependency, and adding one to assert an ordering would cost more than
 * it is worth.
 */
const CI = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8');

/** Where a step's `- name:` appears, or -1. */
function stepAt(name: string): number {
  return CI.indexOf(`- name: ${name}`);
}

describe('ci.yml keeps the third-party gate behind the code gates (#423)', () => {
  const network = 'Verify explainers';
  const codeGates = ['Lint', 'Typecheck', 'Test', 'Build', 'Performance budget', 'Smoke'];

  it('has all the steps this test is about', () => {
    for (const name of [network, ...codeGates]) {
      expect(stepAt(name), `ci.yml has no step named ${name}`).toBeGreaterThan(-1);
    }
  });

  it.each(codeGates)('runs %s before the network gate', (name) => {
    // A step that fails stops the ones after it, so "before" is the whole
    // guarantee: an unreachable host cannot prevent this from reporting.
    expect(stepAt(name)).toBeLessThan(stepAt(network));
  });

  it('still runs the network gate at all', () => {
    // Moving it last must not become deleting it. ADR-0017: a video explainer's
    // recorded title and author are checked against oEmbed, and CI is the only
    // place that can — authoring sandboxes deny youtube.com.
    expect(CI).toContain('npm run check:explainers -- --fast');
  });
});
