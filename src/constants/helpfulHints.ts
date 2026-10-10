/**
 * Helpful-hint classifications shared across the app. A leaf module (types only), so
 * pure utilities can import it without pulling in stores or composables.
 */
import type { HelpfulHintType } from '@/types/models';

/**
 * Hints that are a SURPRISE for someone in the family: their audience deliberately
 * leaves out the person they concern. A birthday present is assigned to the OTHER
 * adults, and an anniversary plan can be a surprise for a partner. Shared screens
 * (the beanie wall) keep these off, because the person it concerns can read them
 * there. Add a type here when a new hint is meant to stay a surprise.
 */
export const SURPRISE_HINT_TYPES: readonly HelpfulHintType[] = [
  'birthday-present',
  'anniversary-plan',
];

const SURPRISE_SET: ReadonlySet<HelpfulHintType> = new Set(SURPRISE_HINT_TYPES);

/** True when a to-do is a surprise hint (see `SURPRISE_HINT_TYPES`). */
export function isSurpriseHint(hintType: HelpfulHintType | undefined): boolean {
  return hintType !== undefined && SURPRISE_SET.has(hintType);
}
