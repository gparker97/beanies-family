/**
 * Rewrite the family pod without its edit history, so it opens on a low-memory
 * device.
 *
 * A seven-step flow with its own failure ladder, in a composable rather than in
 * `syncStore` (4,800 lines) or inline in `SettingsPage.vue` (2,200): it holds no
 * reactive state anyone else reads, and here it is unit-testable without
 * mounting a page or instantiating a store.
 *
 * ⚠️ TWO THINGS ARE LOAD-BEARING AND EASY TO GET BACKWARDS.
 *
 * 1. **The backup gate is not a courtesy.** The exported `.beanpod` is the ONLY
 *    rollback route, so the flow refuses to continue unless a file actually
 *    landed. That is the same discipline the delete-family flow uses, and it is
 *    now literally the same code.
 * 2. **Cache the document BEFORE stamping the lineage.** `setEnvelope` persists
 *    the envelope cache immediately and fire-and-forget, so stamping first would
 *    leave the cached envelope claiming a lineage the cached document is not on
 *    — and every subsequent open would read `ours-newer`, latch, and reproduce
 *    it. Caching first keeps the pair self-consistent, which is the condition
 *    the open-path guard assumes.
 *
 * `compact()` is a FLAT sequence of early returns with exactly one `try/catch`,
 * around the only steps where state has moved.
 */
import { ref } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { usePodExport } from '@/composables/usePodExport';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import * as syncService from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { generateUUID } from '@/utils/id';

/** Why a compaction refused. Rides in `error_code`, so it stays queryable. */
type RefusalCode = 'not-synced' | 'backup-not-delivered' | 'no-envelope' | 'no-permission';

export function usePodCompaction() {
  const syncStore = useSyncStore();
  const familyContext = useFamilyContextStore();
  const { t } = useTranslation();
  const { exportEncryptedPod, confirmBackupLanded } = usePodExport();
  const busy = ref(false);

  function refuse(code: RefusalCode): void {
    showToast('warning', t('compaction.refused'), t(`compaction.refused.${code}`), {
      surface: 'pod-compaction',
    });
    logEvent({
      level: 'warn',
      surface: 'pod-compaction',
      message: 'compaction refused',
      context: { action: 'refused', error_code: code },
    });
  }

  async function compact(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      // 1. Warn, in the user's own words, before anything moves.
      if (
        !(await confirm({
          title: 'compaction.confirmTitle',
          message: 'compaction.confirmMessage',
          confirmLabel: 'compaction.confirmCta',
          variant: 'info',
        }))
      ) {
        return;
      }

      // 2. Prove we are current and clean. A compaction publishes a document
      //    that no peer can merge with, so publishing one that is missing a
      //    peer's edits would strand them permanently.
      await syncService.flushPendingSave();

      // 2a. ⚠️ PROVE WE CAN WRITE, BEFORE ANYTHING MOVES. Reordering the gates
      //     to skip a pointless upload also removed the only thing that had
      //     ever exercised the provider, so a revoked file permission or an
      //     expired token surfaced at step 6 — AFTER the lineage was stamped.
      //     `doSave` returns false there without arming a blocker or recording
      //     a save failure, leaving a cached, unpublished compaction on a
      //     device whose documented self-repair is the very write it cannot do.
      if (!(await syncService.hasPermission())) return refuse('no-permission');

      // 2b. ⚠️ PULL UNCONDITIONALLY. `isFullySynced` trusts the change probe,
      //     and on a provider with no revision that probe compares MTIMES —
      //     which a filesystem granule (FAT/exFAT rounds to 2s) or a cloud
      //     client that rewrites a file preserving its timestamp can defeat.
      //     A missed peer write is one this compaction then publishes over,
      //     stranding them permanently, which is the exact outcome this gate
      //     exists to prevent. `loadFromFile` downloads and merges without
      //     consulting the probe, so it closes the hole for every provider; one
      //     download on a rare, user-initiated, one-way operation is the
      //     cheapest possible insurance.
      if (!(await syncStore.loadFromFile({ merge: true })).success) return refuse('not-synced');

      // 2c. Now push whatever the merge revealed, and prove we are level.
      //     Still cheapest-proof-first: `syncNow` exports, encrypts, base64s and
      //     uploads the whole pod, so an already-level device skips it.
      if (!(await syncService.isFullySynced())) {
        if (!(await syncStore.syncNow(false))) return refuse('not-synced');
        if (!(await syncService.isFullySynced())) return refuse('not-synced');
      }

      // 3. Backup, gated on DELIVERY. The only rollback route.
      if (!(await exportEncryptedPod({ errorUi: 'caller' }))) {
        return refuse('backup-not-delivered');
      }
      if (!(await confirmBackupLanded())) return refuse('backup-not-delivered');

      const envelope = syncStore.envelope;
      if (!envelope) return refuse('no-envelope');

      // 4. Rebuild + verify, in the worker. Throws (keeping the old document)
      //    on any difference; nothing has moved yet if it does.
      const stats = await docClient.compactDoc();
      logEvent({
        level: 'info',
        surface: 'pod-compaction',
        message: 'compaction verified',
        context: {
          action: 'verified',
          perf_doc_bytes: stats.afterBytes,
          detail: `before=${Math.round(stats.beforeBytes / 1024)},changes=${stats.changesBefore},actors=${stats.actorsBefore}`,
        },
      });

      // 5-6. The only window where state has moved. See the ordering note above.
      try {
        await docClient.flush();
        syncStore.replaceEnvelope({
          ...envelope,
          podLineage: { id: generateUUID(), seq: (envelope.podLineage?.seq ?? 0) + 1 },
        });
        if (!(await syncStore.syncNow(false))) throw new Error('publish failed');
      } catch (e) {
        // The one place a human should look. The recoverable state is a cached,
        // unpublished compaction: the next open reads `ours-newer`, the policy
        // says `publish-local`, and it republishes itself if the remote has not
        // moved. If a peer wrote meanwhile it blocks visibly, and the honest
        // recovery is the `.beanpod` step 3 proved exists.
        reportError({
          surface: 'pod-compaction',
          message: 'compaction publish failed after the lineage was stamped',
          error: e,
          severity: 'critical',
          context: { action: 'failed', error_code: 'write-failed' },
        });
        showToast('error', t('compaction.publishFailed'), t('compaction.publishFailedHelp'), {
          surface: 'pod-compaction',
        });
        return;
      }

      // 7. Done.
      logEvent({
        level: 'info',
        surface: 'pod-compaction',
        message: 'compaction published',
        context: {
          action: 'published',
          perf_doc_bytes: stats.afterBytes,
          family_id: familyContext.activeFamilyId ?? undefined,
        },
      });
      showToast(
        'success',
        t('compaction.done'),
        `${Math.round(stats.beforeBytes / 1024)}KB → ${Math.round(stats.afterBytes / 1024)}KB`,
        { surface: 'pod-compaction' }
      );
    } catch (e) {
      // Steps 1-4 change nothing, so anything landing here left the pod alone.
      reportError({
        surface: 'pod-compaction',
        message: 'compaction failed before anything was published',
        error: e,
        severity: 'error',
        context: { action: 'failed', error_code: 'rebuild-failed' },
      });
      showToast('error', t('compaction.failed'), t('compaction.failedHelp'), {
        surface: 'pod-compaction',
      });
    } finally {
      busy.value = false;
    }
  }

  return { busy, compact };
}
