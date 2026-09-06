/**
 * Is this family's file big enough that compacting it is worth doing?
 *
 * ⚠️ MEASURING MUST NEVER COST A `saveDoc`. A whole-document serialize on every
 * open is precisely the regression this tier exists to prevent, so both numbers
 * come from values already in hand: the encrypted payload's decoded size, which
 * is arithmetic on a base64 length, and `Automerge.stats`, which is a handle
 * read rather than a serialize.
 *
 * ⚠️ AND A REAL FAILURE OUTRANKS THE HEURISTIC. If any family member's device
 * has reported that it could not open the pod for want of memory, the file is
 * due whatever the byte threshold says — the threshold is a guess about when
 * that will happen, and the report is the thing itself.
 */
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import { anyDeviceReportedTooLarge } from '@/services/pod/podSoak';

/** Below this the file opens comfortably even on an old tablet. */
export const DUE_BYTES = 1_000_000;

/**
 * Decoded byte length of a base64 payload, WITHOUT decoding it.
 *
 * Decoding a multi-megabyte payload to measure it would allocate the very thing
 * this whole tier is about.
 */
export function decodedSizeOf(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function usePodHealth() {
  const syncStore = useSyncStore();
  const familyStore = useFamilyStore();
  const { isOwner } = usePermissions();

  /**
   * ⚠️ ONE COMPUTED DECIDES WHO SEES THE NOTE, THE SECTION AND THE BUTTON.
   * Owner-only, on greg's explicit call (2026-09-06): widening a one-way,
   * family-wide, history-destroying migration to admins is a product decision,
   * not a side effect of adding a notice. Everything reads this, so the note can
   * never appear for someone who cannot act on it.
   */
  const canCompactPod = computed(() => isOwner.value);

  const podBytes = computed(() => decodedSizeOf(syncStore.envelope?.encryptedPayload ?? ''));

  const someoneCannotOpenIt = computed(() => anyDeviceReportedTooLarge(familyStore.members));

  const compactionIsDue = computed(
    () => canCompactPod.value && (someoneCannotOpenIt.value || podBytes.value >= DUE_BYTES)
  );

  return { canCompactPod, compactionIsDue, podBytes, someoneCannotOpenIt };
}
