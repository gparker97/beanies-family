// Deterministic Google Calendar event id derived from a beanies activity id.
//
// Why deterministic: two devices pushing the same activity must produce the SAME
// Google event id so the second `insert` 409s (already exists) instead of
// creating a duplicate — this is the cross-device dedup primitive (#32 plan,
// Requirement 5). Uniqueness is per-calendar, so a function of activityId alone
// is sufficient (the calendar is implied by which calendar we insert into).
//
// Google's id rules (events.insert): characters must be base32hex — lowercase
// letters `a-v` and digits `0-9` — length 5..1024, and unique per calendar.
// A v4 UUID is hex (`0-9a-f`) + hyphens; hex is a strict subset of base32hex,
// so lowercasing and stripping hyphens yields a valid 32-char id. We prefix `b`
// (beanies) as a small namespace marker and to keep ids visibly ours.

const BEANIES_PREFIX = 'b';

/** Characters Google permits in an event id (base32hex). */
const BASE32HEX = /[^0-9a-v]/g;

/**
 * Map a beanies activity id to a stable, valid, per-calendar-unique Google event id.
 * Pure and deterministic: same input → same output, every time, on every device.
 *
 * @throws if `activityId` is empty/blank (a programming error — links must have an id).
 */
export function deterministicEventId(activityId: string): string {
  if (!activityId || !activityId.trim()) {
    throw new Error('deterministicEventId: activityId must be a non-empty string');
  }
  // Lowercase, then drop anything outside base32hex (hyphens, stray chars).
  const sanitized = activityId.toLowerCase().replace(BASE32HEX, '');
  const id = `${BEANIES_PREFIX}${sanitized}`;
  // Google requires 5..1024 chars. A UUID yields 33; guard the degenerate case
  // where an exotic id sanitizes down to <5 chars by right-padding with '0'.
  return id.length >= 5 ? id : id.padEnd(5, '0');
}
