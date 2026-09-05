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
    // ⚠️ MUST STAY OFF until #90 Tier 3 Stages 1-3 have shipped and soaked.
    // The guard that makes compaction safe (ADR-036) is only landing now, and an
    // old build honours no guard at all — so a compaction published before the
    // fleet has updated is CRDT-merged across lineages by every device still on
    // the previous version, which silently undoes it. It was flipped true by
    // accident in `0169b49f` and pushed (not deployed, so nobody was exposed).
    id: 'podCompaction',
    label: 'Pod compaction',
    description:
      'Owner-only: rewrite the family file without its edit history, so it opens on a low-memory tablet. Publishes a new pod lineage.',
  },
  {
    id: 'beanieWall',
    label: 'Beanie wall',
    description: 'Tablet wall/table display mode: the family plan and the jobs board, chrome-free.',
  },
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
  {
    id: 'googleCalendarSync',
    label: 'Google Calendar sync',
    description: 'One-way push of family activities into connected Google calendars.',
  },
  {
    id: 'calendarClashNudge',
    label: 'Calendar clash nudge',
    description: 'Free/busy heads-up when an activity clashes with a connected calendar.',
  },
  {
    id: 'familyLists',
    label: 'Beanie Lists',
    description: 'Categorized family checklists (one-off & recurring) under The Treehouse.',
  },
  {
    id: 'docWorker',
    label: 'Off-main-thread Automerge',
    description: 'Run the Automerge doc in a Web Worker (ADR-032). Off → inline fallback.',
  },
  {
    id: 'helpfulHints',
    label: 'Helpful Hints',
    description: 'Auto-generated to-do reminders before upcoming birthdays, parties, and trips.',
  },
  {
    id: 'mealPlanner',
    label: 'Meal Planner',
    description:
      "The week-first meal board under The Treehouse (page, nav, nook 'today's meals', and briefing cook assignments). Cookbook is separate.",
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
