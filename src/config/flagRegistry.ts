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
    // ⚠️ MUST STAY OFF until the fleet has DRAINED onto a build that reads 5.0.
    // All four Tier 3 stages have shipped to `main`; that is not the gate. A
    // compacted pod is written as beanpod 5.0 (ADR-036 addendum), which a
    // pre-guard build refuses at parse, so a stale device can no longer merge
    // across lineages and silently corrupt the family. It CAN still overwrite
    // the pod on a save, which the fleet republishes over and the safety copy
    // covers; the drain decides how many people the Settings notice names and
    // how many devices go quiet until they update, not whether data is safe.
    // Sequence: deploy with this OFF (every pod on Earth stays 4.0), watch the
    // drain by build, run the on-device acceptance including a deliberately
    // stale device and a restore, then enable. It was flipped true by accident
    // in `0169b49f` and pushed (not deployed, so nobody was exposed).
    // ⚠️ A per-browser localStorage override still beats the prod gate (see
    // `flags.ts`). Deliberate: it is how the soak gets run at all.
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
    // EXIT CONDITION (the thing `podCompaction` below lacks, at a cost of twenty lines): this
    // flag answers ONE question — does Google's system-browser Picker complete a real join on a
    // real iPhone, on the installed app and on Safari? When it does, the selection rule becomes
    // a named `shouldUseSystemBrowserPicker()` predicate and this entry is DELETED. It is not a
    // permanent switch between two pickers.
    id: 'systemBrowserPicker',
    label: 'System-browser file picker',
    description:
      "Join/load: pick the family file via Google's full-page picker instead of the in-page iframe, which never renders on iPhone.",
  },
  {
    id: 'mealPlanner',
    label: 'Meal Planner',
    description:
      "The week-first meal board under The Treehouse (page, nav, nook 'today's meals', and briefing cook assignments). Cookbook is separate.",
  },
  {
    // #95. Gates every pricing SURFACE (the Settings plan card now; the read-only band, the
    // plan page and the write gate's refusal later). It does NOT gate the entitlement store:
    // that is instantiated in App.vue for everyone, so the dry-run soak (`would_block`) runs
    // in prod before this ships. Enforcement additionally needs the server's `enforced`.
    id: 'pricing',
    label: 'Plans & read-only',
    description:
      'Settings plan card (trial, active, read-only) and, when the server enforces it, read-only mode after the trial.',
  },
  {
    // #146. Gates every choreboard SURFACE (nav, route, quick-add, the wall's chore board, the
    // briefing lines, the widget rows and the Beanie Lists redirect), never the data: the chore
    // store loads for everyone, like the meal planner's.
    // ⚠️ ROLLOUT RULE: committed ON on 2026-11-14 by the owner's decision, AHEAD of the update
    // floor (the original rule was floor first, then the flag). The cost is accepted and
    // temporary: an older build that meets the unknown root collections (`chores`,
    // `choreMarks`) in a merge falls back to a full projection rebuild (`touchedBetween`
    // answers null), and ticks arrive many times a day, so a stale device rebuilds on most
    // merges until it updates. Raise the floor (`web/public/min-app-version.json`) as soon as
    // the store builds carrying both collections are approved. The flag stays as the kill
    // switch; flipping it off hides the surfaces and leaves the data alone.
    id: 'choreboard',
    label: 'The Choreboard',
    description:
      "Chores in their own place under The Treehouse, by time of day, on the wall and in the briefing. ON for everyone since 2026-11-14, ahead of the update floor: older builds that meet 'chores' / 'choreMarks' rebuild their projection on merges until the floor is raised to the store builds that know them.",
  },
  {
    // View-only external calendars (plan 2026-11-17). Gates every view-only SURFACE and the
    // `calendar.events.readonly` consent; the two doc collections (`calendarViewAccounts`,
    // `viewedCalendars`) exist for everyone and stay empty while this is off.
    // ⚠️ MUST STAY OFF IN PRODUCTION until Google approves `calendar.events.readonly`
    // ("sensitive"): before approval any consent that includes it shows the unverified-app
    // screen and counts against the 100-user cap. Flip it only after the approval lands.
    // REVIEW BY 2027-02-15 (90 days): if Google has refused or not yet decided, decide then
    // whether to keep waiting or delete the gated code (the empty collections stay, harmless).
    id: 'viewOnlyCalendars',
    label: 'View-only calendars',
    description:
      'Show shared Google calendars read-only on the family calendar and the wall; must stay off in production until Google approves calendar.events.readonly (review by 2027-02-15).',
  },
  {
    // #150 (plan 2026-11-18-location-autofill-and-link-150). Gates address suggestions from
    // Google Maps in every location and address field, the picked-place display and the
    // call/link reading of the activity location. Read in exactly ONE place,
    // `locationLinksEnabled()` in `src/utils/location/locationLinks.ts` (a unit test pins it);
    // every other caller goes through that function.
    // ON for everyone since flag day, 2026-11-19 (release 1.6): the privacy and terms pages
    // went live with the same deploy and the `place-search` Lambda was deployed with its
    // alarms in OK. The App Store and Play data declarations are the owner's to file while
    // the 1.6 native builds are in review. It stays as the display kill switch: flipping it
    // off hides the suggestions, the lookups and the call/link reading.
    // RETIRE on 2026-12-19 (flag day + 30) if there has been no rollback (the plan lists
    // what goes).
    id: 'placeSuggestions',
    label: 'Address suggestions',
    description:
      'Google Maps address suggestions in location fields, the picked-place map link, and Join Call / Open Link for links in an activity location. ON for everyone since 2026-11-19; the kill switch until it is retired on 2026-12-19.',
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
