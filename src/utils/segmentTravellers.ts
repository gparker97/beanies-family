// Pure helpers for per-segment travellers (#30 follow-up).
//
// A vacation segment's `travellerIds` is OPTIONAL: `undefined` means "the whole trip"
// (resolves to the trip's `assigneeIds`). A concrete array — including one the user or AI
// has explicitly set — is returned verbatim and is NOT rewritten when trip travellers later
// change. These helpers are pure, total, and independent (no helper calls another), so each
// can be reasoned about and tested in isolation.

import type { FamilyMember, UUID } from '@/types/models';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';

/**
 * The members on a segment. `undefined` → the whole trip (`tripAssigneeIds`); a defined
 * array (incl. empty) → returned as-is. Single source of truth for the "undefined = everyone"
 * rule, used by the edit-modal prefill, the expanded-details list, and the subset check.
 */
export function resolveSegmentTravellers(
  travellerIds: UUID[] | undefined,
  tripAssigneeIds: UUID[]
): UUID[] {
  return travellerIds !== undefined ? travellerIds : tripAssigneeIds;
}

/**
 * True when this segment carries an explicit traveller list that omits at least one trip
 * member (a strict subset). `undefined` → false (everyone, no avatar row). Empty array → true
 * (but unreachable from the UI, which falls back to the trip default on save).
 */
export function isTravellerSubset(
  travellerIds: UUID[] | undefined,
  tripAssigneeIds: UUID[]
): boolean {
  if (travellerIds === undefined) return false;
  const set = new Set(travellerIds);
  return tripAssigneeIds.some((id) => !set.has(id));
}

// Honorifics/titles stripped during normalization. A FIXED set — deliberately not open-ended,
// so the normalizer stays a small total function (unhandled formats fall through to the
// confirm-and-learn step, never a growing pile of per-format branches).
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'mstr',
  'master',
  'miss',
  'dr',
  'prof',
  'sir',
  'madam',
]);

/**
 * Canonical form for a person's name, shared by the matcher AND the alias writer so a learned
 * alias always matches next time. Closed scope: a "Surname/Given" pair (a SINGLE slash) is
 * reordered to "Given Surname"; honorifics are dropped; punctuation/slashes are stripped; each
 * token is Title-Cased. Names with 0 or 2+ slashes are whitespace-normalized only (not parsed).
 * Examples: "SMITH/JONATHAN MR" → "Jonathan Smith"; "  mary   " → "Mary"; "" → "".
 */
export function normalizePersonName(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  // "SURNAME/GIVEN" → "GIVEN SURNAME" (single slash only; otherwise leave for whitespace pass).
  const slashParts = s.split('/');
  if (slashParts.length === 2) s = `${slashParts[1].trim()} ${slashParts[0].trim()}`;
  return s
    .split(/\s+/)
    .map((t) => t.replace(/[.,/]/g, '').trim())
    .filter((t) => t.length > 0 && !HONORIFICS.has(t.toLowerCase()))
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}

/** The normalized, lowercased strings a member can be matched by (name + aliases). */
function memberMatchKeys(member: FamilyMember): Set<string> {
  const keys = new Set<string>();
  const add = (v: string) => {
    const n = normalizePersonName(v).toLowerCase();
    if (n) keys.add(n);
  };
  add(member.name);
  for (const a of member.aliases ?? []) add(a);
  return keys;
}

/**
 * Match document traveller names (as written on a ticket/itinerary, ideally already normalized
 * by the model) to family members, comparing against each member's name AND aliases in the
 * shared canonical form. Resolves PER NAME: a name matches a member when the member's key set
 * contains the full normalized name, or — for a single-token name — that exact token.
 *
 * Ambiguity guard: if one name resolves to MORE than one member it is dropped (left for the
 * user to confirm) — never a silent wrong assignment. The asymmetry is deliberate: we match the
 * document name's first token against a member's keys, but never a member's first token against
 * the document name (which would let "Jonathan Smith" and "Jonathan Doe" both match "Jonathan").
 * Returns the de-duplicated union of confident (single-member) matches across all names.
 */
export function matchTravellerIds(names: string[], roster: FamilyMember[]): UUID[] {
  const matched = new Set<UUID>();
  for (const raw of names) {
    const n = normalizePersonName(raw).toLowerCase();
    if (!n) continue;
    const firstToken = n.split(/\s+/)[0];
    const hits = new Set<UUID>();
    for (const member of roster) {
      const keys = memberMatchKeys(member);
      if (keys.has(n) || keys.has(firstToken)) hits.add(member.id);
    }
    if (hits.size === 1) matched.add([...hits][0]!);
  }
  return [...matched];
}

/**
 * The aliases worth persisting after a confirm-and-learn: names the user mapped to a member
 * that the matcher did NOT already auto-resolve (so re-learning auto-matches is skipped), and
 * that aren't redundant with the member's own name or an existing alias. Keys are already
 * normalized (Title Case); the stored alias is that canonical form. Pure.
 */
export function learnableAliases(
  confirmedMap: Record<string, string>,
  autoMatches: Record<string, string>,
  roster: FamilyMember[]
): Array<{ memberId: UUID; alias: string }> {
  const byId = new Map(roster.map((m) => [m.id, m]));
  const out: Array<{ memberId: UUID; alias: string }> = [];
  for (const [name, memberId] of Object.entries(confirmedMap)) {
    if (!memberId) continue; // left unmapped
    if (autoMatches[name] === memberId) continue; // matcher already gets it — nothing to learn
    const member = byId.get(memberId);
    if (!member) continue;
    const aliasKey = name.toLowerCase();
    if (aliasKey === normalizePersonName(member.name).toLowerCase()) continue; // redundant
    const existing = (member.aliases ?? []).map((a) => normalizePersonName(a).toLowerCase());
    if (existing.includes(aliasKey)) continue; // already known
    out.push({ memberId, alias: name });
  }
  return out;
}

/**
 * Append `additions` to `existing`, case-insensitively de-duplicated against existing entries
 * and each other, order-stable. Used to grow a member's alias list in a single write.
 */
export function dedupedAppend(existing: string[] | undefined, additions: string[]): string[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((v) => v.trim().toLowerCase()));
  for (const a of additions) {
    const key = a.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * De-duplicated union of every segment's explicit `travellerIds` across the three buckets
 * (segments with no list are skipped). Used to seed a NEW AI-created trip's `assigneeIds`.
 */
export function unionTravellerIds(buckets: SegmentBuckets): UUID[] {
  const ids = new Set<UUID>();
  const all = [...buckets.travelSegments, ...buckets.accommodations, ...buckets.transportation];
  for (const seg of all) {
    if (seg.travellerIds) for (const id of seg.travellerIds) ids.add(id);
  }
  return [...ids];
}
