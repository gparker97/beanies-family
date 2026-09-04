/**
 * The ONE place a file delivery's outcome is turned into telemetry, a toast and
 * developer guidance.
 *
 * Six call sites hand the user a file (recovery-kit PDF, meal-plan PDF/PNG,
 * `.beanpod` export, readable-JSON export, photo). Before this module each one
 * decided for itself whether to check the result, whether to toast, and what to
 * report — so most of them did none of it, and a delivery that silently
 * produced nothing rendered as success. One policy here means a caller cannot
 * forget.
 *
 * Layering: this is the only module allowed to sit between a caller and
 * `shareOrDownloadFile`. The seam below stays pure (no toast, no telemetry);
 * Pinia stores stay above it (a store that can talk to the user is a boundary
 * that is very hard to re-close), so a store hands back bytes and its page
 * calls this.
 */
import {
  shareOrDownloadFile,
  type DeliveryStage,
  type ShareOrDownloadResult,
} from '@/utils/shareOrDownloadFile';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { record as recordPerf } from '@/utils/perfTiming';
import { getPlatform } from '@/services/sync/capabilities';
import { useTranslationStore } from '@/stores/translationStore';

/** Which deliverable this is. A PII-free enum — carried as the `kind` context key. */
export type FileKind =
  'recovery-kit-pdf' | 'meal-plan-pdf' | 'meal-plan-png' | 'beanpod' | 'readable-json' | 'photo';

const SURFACE = 'file-delivery';

/**
 * Developer-facing triage, one line per stage. An exhaustive `Record` rather
 * than a `switch` with a `default`: TypeScript then makes it impossible to add
 * a `DeliveryStage` without adding its guidance, so this cannot drift behind
 * the code the way a defaulted switch silently would.
 */
const STAGE_GUIDANCE: Record<DeliveryStage, string> = {
  source:
    'the caller never got any bytes to deliver — a Drive fetch refused (403/404) or ' +
    'there was no family key. Nothing reached this module; look at the caller.',
  plugin: 'the @capacitor/share import failed — run `npx cap sync` and rebuild',
  encode:
    'the blob was empty, or FileReader could not base64 it — check perf_doc_bytes ' +
    '(0 means the producer handed over an empty file)',
  write: 'Filesystem.writeFile to Directory.Cache/shared refused — disk full or cache evicted',
  share:
    'the share sheet failed to open, had no target, or the FileProvider refused the file — ' +
    'check <cache-path> in android/app/src/main/res/xml/file_paths.xml',
  sweep:
    'the cache directory could not be read AND the write then failed — the shared/ ' +
    'directory is likely gone or unwritable',
  anchor: '<a download> was reached on native — a caller bypassed shareOrDownloadFile',
};

export interface DeliverFileOptions {
  blob: Blob;
  filename: string;
  mimeType: string;
  /** Share-sheet title. Already translated by the caller. */
  title: string;
  kind: FileKind;
  /** See `shareOrDownloadFile` — web-only "save, don't share". */
  preferDownload?: boolean;
  /**
   * Who shows the user the error. Note this selects the UI ONLY — the report
   * fires either way, identically, so telemetry never depends on which surface
   * happened to render the message.
   *   'toast'  (default) — this module toasts.
   *   'caller' — the caller renders its OWN visible error (the recovery-kit
   *              banner, the delete-family toast).
   * There is no third option: silence is not selectable.
   */
  errorUi?: 'toast' | 'caller';
  /**
   * Page a human for a failure here — raises the severity of the ONE report
   * this module already fires, never adding a second. Set only by the
   * delete-family gate, where a missing backup immediately precedes a
   * destructive, unrecoverable action.
   */
  critical?: boolean;
}

/**
 * Deliver a file and handle every outcome exactly once.
 *
 * Returns the seam's result so a caller can branch on `delivered` — but a
 * caller that ignores the return value still gets correct user-facing and
 * telemetry behaviour, which is the point.
 */
export async function deliverFile(opts: DeliverFileOptions): Promise<ShareOrDownloadResult> {
  const { blob, filename, mimeType, title, kind, preferDownload, errorUi, critical } = opts;
  const os = getPlatform();

  const result = await shareOrDownloadFile(blob, filename, mimeType, title, { preferDownload });
  const detail = result.mechanism;

  switch (result.outcome) {
    case 'shared':
    case 'downloaded': {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'file delivered',
        context: { action: 'delivery-succeeded', kind, detail, os },
      });
      // ONLY the prepare time. `Share.share` does not resolve until a human
      // dismisses the sheet, so the wall clock of this function would measure
      // dwell time and push every share past the warn floor.
      if (result.prepareMs != null) {
        recordPerf(SURFACE, result.prepareMs, { perf_doc_bytes: blob.size });
      }
      break;
    }

    case 'cancelled':
      // A dismissal is a choice, not a failure. No toast, no report.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'file delivery cancelled',
        context: { action: 'delivery-cancelled', kind, detail, os },
      });
      break;

    case 'failed': {
      const stage = result.stage;
      console.error(
        `[${SURFACE}] ${kind} failed at stage "${stage}": ${stage ? STAGE_GUIDANCE[stage] : 'unknown stage'}`,
        result.error
      );
      const context = {
        action: 'delivery-failed',
        kind,
        stage,
        detail,
        os,
        // Emitted on failure too, not just success: `STAGE_GUIDANCE` sends an
        // `encode` triager straight to the size, and a `write` failure is
        // usually about how big the file was. Already on ALLOWED_CONTEXT_KEYS.
        perf_doc_bytes: blob.size,
      };

      // The report fires FIRST and unconditionally, in exactly one place.
      //
      // It used to ride on `showToast`, which auto-reports — but `useToast`
      // dedupes on (type, title, message) and returns ABOVE its report block,
      // and all six kinds share one generic sticky error message. So a
      // meal-plan failure left on screen silently swallowed the NEXT delivery
      // failure: no toast, no report, nothing in the firehose. Reporting here
      // also keeps the message developer-authored rather than built from
      // translated copy, which `errorReporter` buckets on — the two error UIs
      // now aggregate identically instead of differing per language.
      reportError({
        surface: SURFACE,
        message: `file delivery failed (${kind})`,
        error: result.error,
        context,
        severity: critical ? 'critical' : 'error',
      });

      if (errorUi !== 'caller') {
        const t = useTranslationStore().t;
        // `silent` because the report above already fired — without it a
        // non-deduped toast would report the same failure a second time.
        showToast('error', t('fileDelivery.failed'), t('fileDelivery.failedHelp'), {
          silent: true,
        });
      }
      break;
    }
  }

  return result;
}
