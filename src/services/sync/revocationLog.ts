import { logEvent } from '@/services/telemetry/logEvent';
import { slotTombstoneEntryKey } from '@/services/sync/envelopeMerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

/**
 * Report that a merge (or a pending file) carried wraps the family has revoked
 * (tracker #77). The rate is the old-client resurrection metric: a client older than
 * the tombstone mechanism re-publishes revoked wraps from memory, and current clients
 * drop them again here. Silent at zero. Its own module, not the pure `envelopeMerge`
 * (the Automerge worker imports that one), and not `syncService` (both merge callers
 * need it, and one of them is `syncService` itself).
 */
export function logRevokedEntriesFiltered(filtered: number, stage: 'merge' | 'pending'): void {
  if (filtered <= 0) return;
  logEvent({
    level: 'warn',
    surface: 'envelope-revocation',
    message: 'revoked_entries_filtered',
    context: { action: 'revoked_entries_filtered', stage, count: filtered },
  });
}

/** Families this device has already reported exhausted, so the warn is a transition, not a heartbeat. */
const exhaustedReported = new Set<string>();

/**
 * A family whose recovery kits have ALL been invalidated (tracker #99). The last-kit guard
 * in `revokeRecoveryKit` closes the sequential race (a peer's tombstone merged before this
 * device counts) but not the concurrent one: two devices each retiring "the other" kit
 * inside the same observe→push window both pass their guard, and the tombstone union
 * leaves no live kit. That state is only ever visible at a MERGE (each device's own
 * commit still holds the peer's kit), so the merge termini call this; nothing else
 * notices, because the kit nag keys on a doc-side confirmation stamp that stays true
 * forever. Fires ONCE per family per session on this device — the state persists, and a
 * per-merge warn would be a heartbeat that re-pages forever. Silent while any kit is live
 * or no kit was ever tombstoned. One filter (`recovery_kits_exhausted`) is the alert for
 * "this family may have no way back in".
 */
export function logRecoveryKitsExhausted(
  envelope: Pick<BeanpodFileV4, 'familyId' | 'recoveryKeys' | 'revokedKeys'>,
  stage: 'merge' | 'pending'
): void {
  if (Object.keys(envelope.recoveryKeys ?? {}).length > 0) {
    // A kit is live again (a new one was minted): re-arm so a later exhaustion reports.
    exhaustedReported.delete(envelope.familyId);
    return;
  }
  const tombstoned = Object.keys(envelope.revokedKeys ?? {}).filter(
    (k) => slotTombstoneEntryKey('recoveryKeys', k) !== null
  ).length;
  if (tombstoned === 0 || exhaustedReported.has(envelope.familyId)) return;
  exhaustedReported.add(envelope.familyId);
  logEvent({
    level: 'warn',
    surface: 'envelope-revocation',
    message: 'recovery_kits_exhausted',
    context: { action: 'recovery_kits_exhausted', stage, count: tombstoned },
  });
}
