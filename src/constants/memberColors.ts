/**
 * Canonical family-member color palette — the single source of truth.
 *
 * Used by `FamilyMemberModal`'s `ColorCircleSelector` (needs the full
 * `{ value, gradient }` shape) and by onboarding's `CreateMembersStep`
 * auto-assign (`getNextColor`, needs only the value strings via
 * `MEMBER_COLOR_VALUES`). Both MUST consume this list — a divergent local copy
 * (the pre-2026-06-26 state) assigned colors the selector couldn't highlight,
 * so editing such a member showed "nothing selected" and one tap overwrote it.
 */
export interface MemberColor {
  value: string;
  gradient: string;
}

export const MEMBER_COLORS: MemberColor[] = [
  { value: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  { value: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #f87171)' },
  { value: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #4ade80)' },
  { value: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
  { value: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { value: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #f472b6)' },
];

/** Just the hex values, for code that assigns a color (not a swatch selector). */
export const MEMBER_COLOR_VALUES: string[] = MEMBER_COLORS.map((c) => c.value);
