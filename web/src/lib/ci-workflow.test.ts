import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WHERE THE EXPLAINER CHECKS RUN, asserted (#423, #489).
 *
 * #423: `check:explainers` used to run sixth of thirteen. On 2026-09-11
 * en.wikipedia.org failed to answer, the step exited 2, and the job SKIPPED
 * lint, typecheck, the whole test suite, the build, the perf budget and all ten
 * smoke assertions — on a push to `main`. A blip at a third party did not merely
 * add noise; it silently disabled every check that gates the code.
 *
 * Moving it last made the red HONEST but could not stop it. #489 finished the
 * job: ci.yml now runs the STRUCTURAL half only, and the network half runs
 * weekly from links.yml, which already ran it in full.
 *
 * So there are two invariants here, and the second is the one that matters:
 * ci.yml must not reach a third party, and links.yml must not stop reaching one.
 * Splitting a check in two is how a check quietly becomes zero checks.
 *
 * A text scan rather than a YAML parse on purpose — the repository has no YAML
 * dependency, and adding one to assert this would cost more than it is worth.
 */
const workflow = (name: string) =>
  readFileSync(join(process.cwd(), '..', '.github', 'workflows', name), 'utf8');

const CI = workflow('ci.yml');
const LINKS = workflow('links.yml');

/** Where a step's `- name:` appears, or -1. */
function stepAt(name: string): number {
  return CI.indexOf(`- name: ${name}`);
}

/** `npm run` invocations of a script, with whatever flags follow, from `run:` lines only. */
function invocations(yaml: string, script: string): string[] {
  return [...yaml.matchAll(new RegExp(`run: npm run ${script}([^\\n]*)`, 'g'))].map((m) =>
    m[1]!.trim(),
  );
}

describe('ci.yml keeps the explainer gate behind the code gates (#423)', () => {
  const gate = 'Verify explainers are well formed';
  const codeGates = ['Lint', 'Typecheck', 'Test', 'Build', 'Performance budget', 'Smoke'];

  it('has all the steps this test is about', () => {
    for (const name of [gate, ...codeGates]) {
      expect(stepAt(name), `ci.yml has no step named ${name}`).toBeGreaterThan(-1);
    }
  });

  it.each(codeGates)('runs %s before the explainer gate', (name) => {
    // A step that fails stops the ones after it, so "before" is the whole
    // guarantee: the explainer check cannot prevent these from reporting.
    expect(stepAt(name)).toBeLessThan(stepAt(gate));
  });
});

describe('the network half is off the pull request and still exists (#489)', () => {
  it('ci.yml runs the structural half only', () => {
    const runs = invocations(CI, 'check:explainers');
    expect(runs, 'ci.yml no longer runs check:explainers at all').toHaveLength(1);
    expect(runs[0]).toBe('-- --offline');
  });

  it('ci.yml reaches no third party for explainers', () => {
    // The failure this prevents is a well-meaning revert: --fast is cheap and
    // looks harmless, and it is what went red three times in one session on
    // pull requests that could not have caused it (#479, #487, #488).
    for (const flags of invocations(CI, 'check:explainers')) {
      expect(flags, 'a network variant is back in ci.yml').toContain('--offline');
    }
  });

  it('links.yml still verifies every explainer over the network', () => {
    // MOVING A CHECK MUST NOT BECOME DELETING IT. ADR-0017: a video explainer's
    // recorded title and author are checked against oEmbed, and only CI can —
    // authoring sandboxes deny youtube.com. That now happens here, weekly.
    const runs = invocations(LINKS, 'check:explainers');
    expect(runs, 'links.yml no longer runs check:explainers').toHaveLength(1);
    expect(runs[0], 'links.yml must run it in full — no --offline, no --fast').toBe('');
  });

  it('links.yml still sweeps the citations too', () => {
    expect(invocations(LINKS, 'check:citations')).toHaveLength(1);
  });
});
