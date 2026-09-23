import { logEvent } from '@/services/telemetry/logEvent';

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
