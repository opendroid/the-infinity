// Generates src/styles/tokens.generated.css from the design handoff's tokens.json.
//
// CLAUDE.md §5: the Tailwind theme is *generated* from tokens.json — never
// re-typed by hand, never drifted. This script is the mechanism. The output is
// gitignored so the committed source can never disagree with the handoff; if
// they ever do, the build regenerates and the difference disappears.
//
// Run by `prebuild`, `dev`, and `typecheck`. Do not edit the output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(here, '../../docs/design/handoff-v1/tokens.json');
const OUT = resolve(here, '../src/styles/tokens.generated.css');

const tokens = JSON.parse(readFileSync(TOKENS, 'utf8'));

/** Tailwind v4 reads its theme from CSS custom properties inside `@theme`. */
const colors = Object.entries(tokens.color)
  .map(([name, value]) => `  --color-${name}: ${value};`)
  .join('\n');

const fonts = [
  `  --font-display: '${tokens.font.display}', sans-serif;`,
  `  --font-body: '${tokens.font.body}', system-ui, sans-serif;`,
  `  --font-mono: '${tokens.font.mono}', ui-monospace, monospace;`,
].join('\n');

const radii = Object.entries(tokens.radius)
  .map(([name, value]) => `  --radius-${name}: ${value}px;`)
  .join('\n');

// The handoff's spacing scale is a list of exact px values, not a ratio scale.
// Exposed as `--spacing-<n>` so `p-[--spacing-22]` stays honest about which
// values are sanctioned; anything off-scale has to be written deliberately.
const spacing = tokens.space.map((px) => `  --spacing-${px}: ${px}px;`).join('\n');

const { thread } = tokens.shadow;
const pulse = tokens.motion.frontierPulse;

const css = `/* GENERATED FROM docs/design/handoff-v1/tokens.json — DO NOT EDIT.
 * Regenerate with: node scripts/generate-tokens.mjs
 */
@theme {
${colors}

${fonts}

${radii}

${spacing}

  --shadow-thread: ${thread};
  --ease-pulse: ${pulse.easing};
}

:root {
  /* Derived values the handoff names but Tailwind has no slot for. */
  --focus-ring: 2px solid var(--color-thread);
}

/* The only animation that ships. Handoff: "Nothing else animates." */
@media (prefers-reduced-motion: no-preference) {
  @keyframes frontier-pulse {
    0%,
    100% {
      opacity: ${pulse.from};
    }
    50% {
      opacity: ${pulse.to};
    }
  }

  .pulse {
    animation: frontier-pulse ${pulse.duration} ${pulse.easing} infinite;
  }

${pulse.staggerMs.map((ms, i) => `  .pulse-${i} {\n    animation-delay: ${ms}ms;\n  }`).join('\n')}
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css);
console.log(`tokens → ${OUT.replace(process.cwd() + '/', '')}`);
