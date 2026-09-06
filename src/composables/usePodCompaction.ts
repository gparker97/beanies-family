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
import { getAuxStore } from '@/services/sync/storageProvider';
import { safetyCopyName } from '@/constants/compaction';
import { PayloadLoadError } from '@/types/sync';

/** Why a compaction refused. Rides in `error_code`, so it stays queryable. */
type RefusalCode =
  | 'not-synced'
  | 'backup-not-delivered'
  | 'no-envelope'
  | 'no-permission'
  | 'safety-copy-failed'
  // ⚠️ ITS OWN CODE, deliberately. "This device ran out of memory making the
  // safety copy" is a different sentence from "the safety copy is unreadable",
  // and only the second means the bytes are bad. Collapsing them would tell a
  // family their backup is corrupt when their tablet simply could not open it.
  | 'safety-copy-too-large';

export function usePodCompaction() {
  const syncStore = useSyncStore();
  const familyContext = useFamilyContextStore();
  const { t } = useTranslation();
  const { deliverPod, confirmBackupLanded } = usePodExport();
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

      // 3. Backup, gated on DELIVERY. The rollback route the family keeps.
      //
      // ⚠️ BUILT ONCE, USED TWICE. The same envelope is handed to the OS AND
      // written beside the pod as the automatic safety copy. Two whole-document
      // serialize + AES-GCM passes back to back is exactly the wrong thing on
      // the low-memory device this feature exists for — which is why
      // `usePodExport` splits build from deliver rather than being called twice.
      let built: { json: string; filename: string };
      try {
        built = await syncStore.buildExportEnvelope();
      } catch {
        return refuse('backup-not-delivered');
      }
      if (!(await deliverPod(built, { errorUi: 'caller' }))) {
        return refuse('backup-not-delivered');
      }
      if (!(await confirmBackupLanded())) return refuse('backup-not-delivered');

      const envelope = syncStore.envelope;
      if (!envelope) return refuse('no-envelope');

      // 3b. The AUTOMATIC safety copy, beside the pod (R2). The manual export
      //     above is a file the family has to keep track of; this one sits in
      //     the same folder as the pod and is findable in the picker months
      //     later. A provider with no aux store simply keeps the manual gate.
      const provider = syncService.getProvider();
      const aux = provider ? getAuxStore(provider) : null;
      if (aux && provider) {
        const copyName = safetyCopyName(provider.getDisplayName());
        try {
          await aux.write(copyName, built.json);
        } catch (e) {
          reportError({
            surface: 'pod-compaction',
            severity: 'warning',
            message: 'safety copy could not be written beside the pod',
            error: e,
            context: { action: 'safety-copy-failed', error_code: 'write' },
          });
          return refuse('safety-copy-failed');
        }

        // ⚠️ "WRITTEN" IS NOT "LANDED", AND "LANDED" IS NOT "OPENS". Only the
        // third is the gate that matters for a one-way migration, so read it
        // back through the worker's own decrypt + materialize check rather than
        // a bare read.
        try {
          const roundTripped = await aux.read(copyName);
          if (!roundTripped) return refuse('safety-copy-failed');
          await docClient.verifyEnvelope(JSON.parse(roundTripped), { quiet: true });
        } catch (e) {
          // A device that cannot inflate its own pod has not proved the copy is
          // bad — it has proved this device is out of room. Different sentence.
          if (e instanceof PayloadLoadError && e.deviceCannotOpen) {
            return refuse('safety-copy-too-large');
          }
          reportError({
            surface: 'pod-compaction',
            severity: 'warning',
            message: 'safety copy did not read back cleanly',
            error: e,
            context: { action: 'safety-copy-failed', error_code: 'verify' },
          });
          return refuse('safety-copy-failed');
        }
        logEvent({
          level: 'info',
          surface: 'pod-compaction',
          message: 'safety copy written and verified',
          context: { action: 'safety-copy-ok' },
        });
      }

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
        // ⚠️ NO ENVELOPE STAMP. `compactDoc` already wrote the new lineage
        // INTO the document, so a flushed but unpublished compaction is
        // self-describing in the cache and the `ours-newer → publish-local`
        // recovery works by construction rather than by the ordering of two
        // writes. That ordering — flush BEFORE the stamp — was the hazard, and
        // it disappears with the step it was protecting.
        await docClient.flush();
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
