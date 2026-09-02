/**
 * Canonical family-member color palette — the single source of truth.
 *
 * Used by `FamilyMemberModal`'s `ColorCircleSelector` (needs the full
 * `{ value, gradient }` shape) and by onboarding's `CreateMembersStep`
 * auto-assign (`nextFreeMemberColor`). Both MUST consume this list — a
 * divergent local copy (the pre-2026-06-26 state) assigned colors the selector
 * couldn't highlight, so editing such a member showed "nothing selected" and
 * one tap overwrote it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE HAS ZERO IMPORTS, DELIBERATELY. Do not add one.
 *
 * It is imported by `BeanieAvatar`, `ActivityOwnerStack` and `wallActivities.ts`
 * — i.e. by every member face in the app and by the beanie wall, which is
 * lint-fenced against finance stores (`eslint.config.js`, FINANCE EXCLUSION).
 * Until 2026-09-02 this file re-exported `HERITAGE_ORANGE` *from*
 * `@/composables/useActivityChipClass`, which imports `useFamilyStore` and
 * `useMemberInfo`, and `useMemberInfo` statically imports `useAccountsStore`.
 * So a "constants" file quietly dragged a finance store into every avatar, and
 * `wallActivities.ts` reached `accountsStore` from inside the wall's own lint
 * zone — which catches direct imports only and could never have seen it.
 *
 * The dependency now runs the other way: `HERITAGE_ORANGE` is declared HERE and
 * `useActivityChipClass` imports it. Keep it that way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface MemberColor {
  value: string;
  gradient: string;
}

export const MEMBER_COLORS: MemberColor[] = [
  { value: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  // Teal replaced red (#ef4444) on 2026-09-02. Red is reserved brand-wide for
  // destructive actions and hard validation errors, so a bean wearing it put an
  // alarm colour on a child's swimming lesson. Teal was chosen over a rose or
  // coral precisely because those neighbour the pink below — and the whole
  // argument for member-owned hue is that adjacent hues at 5px are not a signal.
  { value: '#14b8a6', gradient: 'linear-gradient(135deg, #14b8a6, #2dd4bf)' },
  { value: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #4ade80)' },
  { value: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
  { value: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { value: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #f472b6)' },
];

/** Just the hex values, for code that assigns a color (not a swatch selector). */
export const MEMBER_COLOR_VALUES: string[] = MEMBER_COLORS.map((c) => c.value);

/**
 * Heritage Orange — the brand "primary" tied to family / everyone activities.
 *
 * Hex literal (not a CSS var) because chip backgrounds tint via the `${hex}` +
 * alpha-suffix trick — that only works on hex strings.
 *
 * Declared here rather than in `useActivityChipClass` so this module can stay
 * import-free (see the header). `useActivityChipClass` re-exports it under the
 * same name, so existing importers are unaffected.
 */
export const HERITAGE_ORANGE = '#F15D22';

/**
 * The colour for a thing that belongs to no single member — an event with no
 * owner at all.
 *
 * An earlier draft used Deep Slate here, which gave the SAME event three
 * different colours across the wall, the planner and the chip — and Deep Slate
 * sits at roughly 1.2:1 on a dark surface, so a shared event lost both its
 * colour and its dashed border in dark mode. Orange reads on both grounds and is
 * provably not one of the six member hues above (pinned by tests in
 * `matchesAssigneeFilter.test.ts` and `wallActivities.test.ts`).
 *
 * NOTE: as of 2026-09-02 this is the *no-owner* colour only. An event shared by
 * two or more named beans wears the first owner's edge over a blended wash of
 * both their hues — see `useActivityIdentity`.
 */
export const SHARED_EVENT_COLOR = HERITAGE_ORANGE;

/** Neutral grey — a member with no usable colour, or an activity naming only removed members. */
export const NEUTRAL_MEMBER_COLOR = '#6b7280';

/**
 * The one place a member colour becomes a renderable value.
 *
 * PURE: no imports, no telemetry, no module state. The blank-colour *warning*
 * is emitted once per roster change from `familyStore`, never from here — this
 * runs on the render path (every chip, every paint) and an emitter here would
 * need process-global mutable state in a constants file plus an order-dependent
 * test.
 *
 * Guards a real defect rather than a hypothetical one: four call sites used
 * `?? fallback`, which passes an EMPTY STRING straight through, and a member
 * whose colour is `''` then rendered a transparent circle. Harmless while hue
 * was decorative; a blank card now that hue is the identity signal.
 */
export function resolveMemberColor(color?: string | null): string {
  return color && color.trim() ? color : NEUTRAL_MEMBER_COLOR;
}

/** Whether a member's stored colour is unusable and needs the neutral fallback. */
export function isBlankMemberColor(color?: string | null): boolean {
  return !color || !color.trim();
}

/**
 * Which palette colours are already spoken for, and by whom.
 *
 * `excludeId` is what keeps a member's OWN colour selectable while editing them.
 * Without it, opening a member created before uniqueness was enforced would show
 * their current swatch as taken and the form could never be saved.
 */
export function takenColors<T extends { id: string; color?: string }>(
  members: T[],
  excludeId?: string
): Map<string, T> {
  const taken = new Map<string, T>();
  for (const m of members) {
    if (!m.color || m.id === excludeId) continue;
    if (!taken.has(m.color)) taken.set(m.color, m);
  }
  return taken;
}

/**
 * The next free palette colour for a new bean.
 *
 * Replaces two divergent implementations: `Math.random()` in
 * `FamilyMemberModal` (which could collide on the very first try) and a
 * round-robin on `addedMembers.length` in `CreateMembersStep` (which excluded
 * the pod owner, so the second bean could collide with them).
 *
 * Returns the colliding member rather than a bare string when the palette is
 * exhausted, so the caller CANNOT handle that case silently — it has everything
 * it needs to name the sharer out loud. The palette deliberately stays at six:
 * adding a seventh hue means adding one that neighbours an existing one, which
 * is the exact failure member-owned colour exists to avoid.
 */
export function nextFreeMemberColor<T extends { id: string; color?: string }>(
  members: T[],
  excludeId?: string
): { color: string; reused: T | null } {
  const taken = takenColors(members, excludeId);
  const free = MEMBER_COLOR_VALUES.find((c) => !taken.has(c));
  if (free) return { color: free, reused: null };

  // Every colour is held. Pick the least-used one and say whose it is.
  const counts = new Map<string, number>();
  for (const m of members) {
    if (m.id === excludeId || !m.color) continue;
    counts.set(m.color, (counts.get(m.color) ?? 0) + 1);
  }
  let best = MEMBER_COLOR_VALUES[0]!;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of MEMBER_COLOR_VALUES) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return { color: best, reused: taken.get(best) ?? null };
}
