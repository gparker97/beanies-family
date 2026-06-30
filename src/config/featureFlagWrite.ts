// Pure core for the dev-only feature-flag writer. NO I/O and NO runtime deps
// (no Vue, no `import.meta`) so it is safe to import from BOTH the app/tests and
// vite.config.ts (the dev-server plugin). The Vite plugin is the only thing that
// performs the actual file write; this module just validates input and produces
// the exact file source to write.

import { FLAG_IDS, isKnownFlag, type DevFlag } from './flagRegistry';

// Header reproduced byte-for-byte so regeneration is idempotent and the output
// stays prettier-clean (must match featureFlags.committed.ts exactly).
const HEADER = `// AUTO-GENERATED committed feature-flag PRODUCTION state — the single source of
// truth for which flags ship enabled to prod. Edit via the dev-only Feature
// Flags card in Settings (which rewrites this file through the dev Vite
// endpoint), or by hand. \`true\` ships the feature to ALL prod users on the next
// deploy; \`false\` keeps it dev-only. Keys are DevFlag ids, sorted.`;

/**
 * Render the full `featureFlags.committed.ts` source for a complete flag-state
 * map. Keys are emitted sorted so the output is deterministic regardless of
 * input order; missing keys default to `false`.
 */
export function generateCommittedSource(state: Record<DevFlag, boolean>): string {
  const lines = [...FLAG_IDS]
    .sort()
    .map((id) => `  ${id}: ${state[id] === true},`)
    .join('\n');
  return (
    `${HEADER}\n` +
    `import type { DevFlag } from './flagRegistry';\n\n` +
    `export const COMMITTED_FLAGS: Record<DevFlag, boolean> = {\n${lines}\n};\n`
  );
}

export type FlagWriteResult =
  { ok: true; source: string; nextState: Record<DevFlag, boolean> } | { ok: false; error: string };

/**
 * Validate a single flag change and produce the new committed-file source. Pure:
 * the next state is rebuilt entirely from the registry, so a stale/unknown key
 * in `current` can never leak into the output. Returns a typed result — callers
 * branch on `ok`, nothing throws.
 */
export function applyFlagWrite(
  current: Record<string, boolean>,
  flag: unknown,
  enabled: unknown
): FlagWriteResult {
  if (typeof flag !== 'string' || !isKnownFlag(flag)) {
    return {
      ok: false,
      error: `Unknown feature flag "${String(flag)}". Known flags: ${FLAG_IDS.join(', ')}.`,
    };
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: `"enabled" must be a boolean, received ${typeof enabled}.` };
  }
  const nextState = {} as Record<DevFlag, boolean>;
  for (const id of FLAG_IDS) {
    nextState[id] = id === flag ? enabled : current[id] === true;
  }
  return { ok: true, source: generateCommittedSource(nextState), nextState };
}
