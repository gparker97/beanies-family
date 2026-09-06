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
  // The copy never reached the folder — nothing to clean up, nothing to warn
  // about, and the storage connection is the thing to check.
  | 'safety-copy-failed'
  // ⚠️ ITS OWN CODE, deliberately. The copy DID reach the folder and came back
  // wrong, so "beanies could not save a copy" would be false and would leave a
  // damaged file in the picker described as the family's rollback point. It is
  // removed and this says so.
  | 'safety-copy-damaged'
  // The whole-document serialize ran out of room on THIS device. "Your data is
  // too big for this phone" is a different sentence from "the backup failed to
  // save", and only the first tells the user something they can act on.
  | 'backup-too-large';

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
      //
      // ⚠️ `built` IS RELEASED BEFORE `compactDoc`, at the end of this block.
      // It is a ~4MB string and `compactDoc` needs three copies of the document
      // resident; holding it across that call raises the peak for no reason.
      let built: { json: string; filename: string } | null = null;
      try {
        built = await syncStore.buildExportEnvelope();
      } catch (e) {
        // ⚠️ NOT a bare `catch {}`. `buildExportEnvelope` serializes and
        // encrypts the whole document, so on the device this tier is about it
        // rejects with `PayloadTooLargeError` — and the generic
        // "backup was not saved, try again and save the file when asked" is
        // then a lie, because the user was never asked to save anything.
        reportError({
          surface: 'pod-compaction',
          severity: 'warning',
          message: 'could not build the backup envelope',
          error: e,
          context: { action: 'refused', error_code: 'backup-build-failed' },
        });
        return refuse(
          e instanceof PayloadLoadError && e.deviceCannotOpen
            ? 'backup-too-large'
            : 'backup-not-delivered'
        );
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
      //     later. A provider with no aux store keeps the manual gate alone —
      //     which is why the UI only promises this copy when one exists.
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
            context: { action: 'refused', error_code: 'safety-copy-write' },
          });
          return refuse('safety-copy-failed');
        }

        // ⚠️ "WRITTEN" IS NOT "LANDED". Read it back and compare it to the
        // bytes we just sent: that catches a truncated upload, a silent
        // write failure and a wrong-file resolution, which are the realistic
        // ways this goes wrong.
        //
        // ⚠️ DELIBERATELY NOT A FULL DECRYPT + `Automerge.load`. That would be a
        // COMPLETE SECOND POD OPEN immediately before `compactDoc`, which itself
        // needs three copies resident — on the device that already cannot open
        // its pod, and on the inline fallback path (disproportionately those
        // same devices) it grows the very WASM heap the live document sits in,
        // which never shrinks. The feature would make compaction fail on exactly
        // the hardware it exists to rescue, and refuse with "try again on a
        // device with more memory". AES-GCM authenticates the payload, so a
        // corrupted copy cannot decrypt silently later, and the manual export is
        // the second belt. Proving "landed and intact" is what this device can
        // afford, and it is what actually protects the family.
        let landed: string | null;
        try {
          landed = await aux.read(copyName);
        } catch (e) {
          reportError({
            surface: 'pod-compaction',
            severity: 'warning',
            message: 'safety copy could not be read back',
            error: e,
            context: { action: 'refused', error_code: 'safety-copy-read' },
          });
          return refuse('safety-copy-failed');
        }
        if (landed !== built.json) {
          // ⚠️ A DIFFERENT SENTENCE, AND A DIFFERENT ACTION. The copy IS in the
          // folder and it is wrong, so telling the user nothing was saved would
          // leave a bad file sitting in their picker labelled as their rollback
          // point. Remove it, then say what happened.
          try {
            await aux.delete(copyName);
          } catch (delErr) {
            // Best effort, but never blind: a 403, a 404 and a dropped
            // connection need telling apart, and the user is about to be told
            // beanies stopped — not that the bad copy is gone, because this is
            // exactly the path where it may not be.
            reportError({
              surface: 'pod-compaction',
              severity: 'warning',
              message: 'could not remove the damaged safety copy',
              error: delErr,
              context: { action: 'refused', error_code: 'safety-copy-orphan' },
            });
          }
          reportError({
            surface: 'pod-compaction',
            severity: 'warning',
            message: 'safety copy did not read back byte-for-byte',
            context: {
              action: 'refused',
              error_code: 'safety-copy-mismatch',
              detail: `wrote=${built.json.length},read=${landed?.length ?? 0}`,
            },
          });
          return refuse('safety-copy-damaged');
        }
        logEvent({
          level: 'info',
          surface: 'pod-compaction',
          message: 'safety copy written and verified',
          context: { action: 'safety-copy-ok' },
        });
      }

      // ⚠️ RELEASE THE ENVELOPE. Everything that needed it is done, and the
      // next step needs the room. See the note where it is built.
      built = null;

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
