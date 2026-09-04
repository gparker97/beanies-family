/**
 * THE one place a payload failure becomes the fatal overlay.
 *
 * There were two: `App.vue` (boot) and `ResumePodSetup.vue` (resume). They had
 * already drifted — different `surface` names, and one sent `perf_doc_bytes`
 * while the other did not, so the same corrupt pod reached CloudWatch with the
 * byte count on one path and without it on the other, and `errorReporter`'s
 * `(surface, message)` dedup could not collapse the two into one incident.
 * Warm paths (Settings → load a file, Grant permission) had no equivalent at
 * all and just left the app wedged.
 *
 * `surface` is `pod-load-failure`, kebab-case per the observability convention.
 * ⚠️ It is NOT the only pod-open surface: the too-large half is emitted by
 * `docClient.surface()` as `pod-load-memory`, deliberately, so that a single
 * classification chokepoint owns it and it cannot be double-counted. An alarm
 * over pod-open failures therefore has to match `pod-load-*`, not
 * `pod-load-failure` alone — matching only this one would silently miss every
 * out-of-memory load, which is the class this whole change exists for. The
 * `source` rides in `action`, which keeps the message constant per class so the
 * (surface, message) dedup bucket still works.
 */
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';
import { PayloadLoadError, PayloadTooLargeError, payloadErrorDetail } from '@/types/sync';

/** Where the failure was caught. Rides in `action`, so it stays queryable. */
export type PayloadFailureSource =
  | 'boot'
  | 'resume'
  | 'reload'
  | 'background-sync'
  | 'pin-unlock'
  | 'password-unlock'
  | 'biometric-unlock';

/**
 * Report a payload failure, WITHOUT raising the overlay.
 *
 * For the surfaces that stay usable: an inline error under a PIN pad, a
 * background refresh over a session that already opened from cache. Those had
 * either hand-rolled a divergent copy of this report or emitted nothing at all,
 * so a corrupt pod on the default sign-in route reached CloudWatch with zero
 * events.
 */
export function reportPayloadFailure(
  err: PayloadLoadError,
  ctx: { fileId?: string | null; familyId?: string | null; source: PayloadFailureSource }
): void {
  // Only the CORRUPT half. `docClient.surface()` is the single emitter for
  // `PayloadTooLargeError` and has already fired by the time this runs; a
  // second report would land on a different surface, which the
  // (surface, message) dedup cannot collapse, and would double-count the rate.
  if (err instanceof PayloadTooLargeError) return;
  reportError({
    surface: 'pod-load-failure',
    // CONSTANT per step — the size rides in `perf_doc_bytes`. A per-pod byte
    // figure in the message would give every pod its own dedup bucket.
    message: `Pod payload failed Automerge ${err.step}`,
    error: err,
    severity: 'critical',
    context: {
      action: `pod-load-corrupt:${ctx.source}`,
      error_code: err.step,
      file_id_tail: ctx.fileId ? ctx.fileId.slice(-6) : undefined,
      perf_doc_bytes: err.payloadBytes ?? undefined,
    },
  });
}

/**
 * Report AND raise the full-screen recovery overlay.
 *
 * ⚠️ Only for a surface where the app genuinely has no document — boot, resume,
 * an explicit Grant-permission. NEVER from a background refresh: that runs over
 * a session which already painted real data from cache, and a `fixed inset-0
 * z-[300]` panel whose only button re-runs the same failing cycle would cover a
 * working app seconds after it opened. Those paths call `reportPayloadFailure`
 * and surface a banner instead.
 */
export function surfacePayloadFatal(
  err: PayloadLoadError,
  ctx: { fileId: string | null; familyId: string | null; source: PayloadFailureSource }
): void {
  const tooLarge = err instanceof PayloadTooLargeError;
  reportPayloadFailure(err, ctx);

  // `clearDataHelps: false` for BOTH classes. For too-large the file is intact
  // and clearing is the one action that destroys the local copy; for corrupt
  // the message says trying again will not help and points at support, so an
  // adjacent "clear your data and start fresh" button contradicts it.
  useFatalErrorStore().setFatal(
    useTranslationStore().t(tooLarge ? 'resumeSetup.podTooLarge' : 'resumeSetup.podCorrupted'),
    // The envelope's family id reaches the user through this blob. It is
    // deliberately NOT in the report context above: `enrichAndRedact`
    // overwrites `family_id` with the ACTIVE family, so on a cross-family open
    // the argument would be silently discarded and the two would disagree.
    payloadErrorDetail(err, ctx.fileId, ctx.familyId),
    { clearDataHelps: false }
  );
}
