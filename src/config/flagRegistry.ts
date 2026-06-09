// The closed set of developer feature flags — the single source of truth for
// which flags exist. Adding a flag is a deliberate code edit (add an entry here,
// then add its committed PROD state in featureFlags.committed.ts).
//
// This module is intentionally dependency-free (no Vue, no stores, no
// `import.meta`) so it can be imported by both the app AND vite.config.ts (via
// the pure write core) without dragging runtime deps into the config graph.
//
// `id`     — stable key used in COMMITTED_FLAGS + the localStorage override key.
// `label`  — short name shown in the dev-only Feature Flags card.
// `description` — one line explaining what the flag gates.

export const FLAG_REGISTRY = [
  {
    id: 'aiPhotoExtract',
    label: 'AI photo extract',
    description: 'Magic beans reader: invitation / photo → calendar activity.',
  },
  {
    id: 'aiTravelExtract',
    label: 'AI travel extract',
    description: 'Magic beans reader: itinerary / booking document → trip.',
  },
] as const;

/** Union of all known flag ids — derived from the registry (single source of truth). */
export type DevFlag = (typeof FLAG_REGISTRY)[number]['id'];

/** All flag ids as a plain array, for validation/iteration. */
export const FLAG_IDS: readonly DevFlag[] = FLAG_REGISTRY.map((f) => f.id);

/** Type guard: is an arbitrary string a known flag id? */
export function isKnownFlag(id: string): id is DevFlag {
  return (FLAG_IDS as readonly string[]).includes(id);
}
