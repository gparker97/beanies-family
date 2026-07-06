// Acknowledged external-calendar overlaps (#34) — family-shared memory.
//
// A thin, stateless projection of the family document's overlap-acknowledgments
// map: when a member taps "This is OK" on a clash, we remember it for the whole family
// (CRDT → syncs across devices, survives reload). Reads stay live by touching
// `docVersion` (the canonical doc-projection idiom, mirroring notificationsStore);
// writes go through ONE guarded writer so a missing doc / member is reported, never
// a silent no-op and never an uncaught throw inside a click handler.
//
// Holds NO local mutable state — the doc is cleared centrally by resetDoc() on
// sign-out, which zeroes this projection — so it is not registered in resetStores.

import { defineStore } from 'pinia';
import { useFamilyStore } from '@/stores/familyStore';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { getById as projectionGetById } from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';
import type { MutationOp } from '@/services/automerge/worker/protocol';
import { overlapAckKey } from '@/utils/calendar/clashDetection';
import { reportError } from '@/utils/errorReporter';
import type { OverlapAck } from '@/types/models';

export const useOverlapAckStore = defineStore('overlapAck', () => {
  const familyStore = useFamilyStore();

  /**
   * True iff the family has acknowledged THIS exact overlap — an entry exists at
   * the key AND its stored fingerprint still matches (so a rescheduled activity,
   * whose fingerprint changed, reads as NOT acknowledged → re-raises). Pure read;
   * tolerant of an un-migrated doc or empty-string args → `false`, never throws.
   */
  function isAcknowledged(
    activityId: string,
    occurrenceDate: string,
    connectionId: string,
    fingerprint: string
  ): boolean {
    void docVersion.value; // re-read after any write (raw doc projection)
    if (!isDocLoaded()) return false;
    const entry = projectionGetById(
      'overlapAcknowledgments',
      overlapAckKey(activityId, occurrenceDate, connectionId)
    ) as OverlapAck | undefined;
    return entry?.fingerprint === fingerprint;
  }

  /**
   * Single guarded writer for both acknowledge/unacknowledge — pre-checks a loaded
   * doc + current member (reports a warning + returns if missing), then awaits the
   * declarative op inside try/catch (reports an error on any throw). `{quiet}`: a
   * click-handler failure classifies here, not via a critical doc-worker toast.
   */
  async function applyChange(
    label: string,
    buildOp: (memberId: string) => MutationOp
  ): Promise<void> {
    const member = familyStore.currentMember;
    if (!isDocLoaded() || !member) {
      reportError({
        surface: `overlap-ack-${label}`,
        message: `${label}: no loaded doc or current member — ack unchanged`,
        severity: 'warning',
      });
      return;
    }
    try {
      await mutate(buildOp(member.id), { quiet: true });
    } catch (err) {
      reportError({
        surface: `overlap-ack-${label}`,
        message: `${label} failed to write overlap acknowledgment`,
        error: err,
        severity: 'error',
      });
    }
  }

  /** Quiet this overlap for the whole family (upsert at the unique key). */
  function acknowledge(
    activityId: string,
    occurrenceDate: string,
    connectionId: string,
    fingerprint: string
  ): void {
    const key = overlapAckKey(activityId, occurrenceDate, connectionId);
    void applyChange('acknowledge', (memberId) => ({
      op: 'set',
      collection: 'overlapAcknowledgments',
      id: key,
      entity: {
        activityId,
        occurrenceDate,
        connectionId,
        fingerprint,
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: memberId,
      } satisfies OverlapAck,
    }));
  }

  /** Undo — re-raise this overlap (remove the key). */
  function unacknowledge(activityId: string, occurrenceDate: string, connectionId: string): void {
    const key = overlapAckKey(activityId, occurrenceDate, connectionId);
    void applyChange('unacknowledge', () => ({
      op: 'delete',
      collection: 'overlapAcknowledgments',
      id: key,
    }));
  }

  return { isAcknowledged, acknowledge, unacknowledge };
});
