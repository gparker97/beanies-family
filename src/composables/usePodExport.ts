/**
 * "Write the pod out, and only continue if a file actually landed."
 *
 * Extracted rather than copied. Two flows need exactly this gate — deleting a
 * family, and compacting one — and both are irreversible the moment they get
 * past it. A second hand-written copy would be a second place for the native
 * caveat below to drift out of step.
 */
import { ref } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { deliverFile } from '@/utils/deliverFile';
import { isNative } from '@/services/sync/capabilities';

export function usePodExport() {
  const syncStore = useSyncStore();
  const { t } = useTranslation();
  const isExporting = ref(false);

  /**
   * Write the encrypted `.beanpod` out. Returns whether a file was DELIVERED —
   * not whether the call succeeded. A cancelled share is `false`.
   */
  /**
   * Hand ALREADY-BUILT bytes to the OS. Split out of `exportEncryptedPod` so a
   * caller that needs the same envelope twice — the compaction, which gates on a
   * delivered backup AND writes a safety copy beside the pod — can build it
   * ONCE. Two whole-document serialize + AES-GCM passes back to back is exactly
   * the wrong thing on the low-memory device this feature exists for.
   *
   * ⚠️ RETURNS A BOOLEAN, AND MUST KEEP DOING SO. `usePodCompaction` gates a
   * one-way, history-destroying migration on `if (!(await deliverPod(...)))`.
   * An object return is always truthy, TypeScript reports NOTHING for
   * `if (!obj)`, and that gate would silently pass. The same rule binds
   * `exportEncryptedPod` below, which delegates here.
   */
  async function deliverPod(
    built: { json: string; filename: string },
    opts?: { errorUi?: 'toast' | 'caller' }
  ): Promise<boolean> {
    if (isExporting.value) return false;
    isExporting.value = true;
    try {
      const { json, filename } = built;
      const result = await deliverFile({
        blob: new Blob([json], { type: 'application/json' }),
        filename,
        mimeType: 'application/json',
        title: t('settings.exportData'),
        kind: 'beanpod',
        // Means SAVE. Without it a share-capable desktop opens a share menu
        // with no save-to-disk option.
        preferDownload: true,
      });
      if (result.delivered) syncStore.markExported();
      return result.delivered;
    } catch (e) {
      // The delivery itself can reject (a revoked handle, a share sheet error).
      // Never silent.
      if (opts?.errorUi !== 'caller') {
        showToast('error', t('fileDelivery.failed'), t('fileDelivery.failedHelp'), {
          surface: 'file-delivery',
          error: e,
          // `source`, not `encode`: no bytes ever existed.
          context: { action: 'delivery-failed', kind: 'beanpod', stage: 'source' },
        });
      }
      return false;
    } finally {
      isExporting.value = false;
    }
  }

  /**
   * Build the encrypted `.beanpod` and write it out. Returns whether a file was
   * DELIVERED — not whether the call succeeded. A cancelled share is `false`.
   */
  async function exportEncryptedPod(opts?: { errorUi?: 'toast' | 'caller' }): Promise<boolean> {
    let built: { json: string; filename: string };
    try {
      built = await syncStore.buildExportEnvelope();
    } catch (e) {
      // `buildExportEnvelope` throws with no family key, and the worker's
      // payload export can reject. Never silent.
      if (opts?.errorUi !== 'caller') {
        showToast('error', t('fileDelivery.failed'), t('fileDelivery.failedHelp'), {
          surface: 'file-delivery',
          error: e,
          // `source`, not `encode`: no bytes ever existed.
          context: { action: 'delivery-failed', kind: 'beanpod', stage: 'source' },
        });
      }
      return false;
    }
    return deliverPod(built, opts);
  }

  /**
   * On NATIVE, ask a human whether the backup really saved.
   *
   * Android resolves an abandoned share as success — picking Gmail and then
   * discarding the draft looks identical to saving to Files, and the OS does
   * not tell us. When the next step is irreversible, the only honest gate is a
   * human one. On web the download is deterministic, so there is nothing to
   * ask and this returns true unchanged.
   */
  async function confirmBackupLanded(): Promise<boolean> {
    if (!isNative()) return true;
    return confirm({
      title: 'settings.deleteFamilyExportCheckTitle',
      message: 'settings.deleteFamilyExportCheckMsg',
      confirmLabel: 'settings.deleteFamilyExportCheckConfirm',
      variant: 'danger',
    });
  }

  return { isExporting, exportEncryptedPod, deliverPod, confirmBackupLanded };
}
