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
import { PayloadLoadError, payloadErrorDetail } from '@/types/sync';
import type { PodLineageError } from '@/services/sync/podLineage';

/** Where the failure was caught. Rides in `action`, so it stays queryable. */
export type PayloadFailureSource =
  | 'boot'
  | 'resume'
  | 'reload'
  | 'background-sync'
  | 'trusted-auto-open'
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
  // Only the CORRUPT half. `docClient.surface()` is the single emitter for the
  // device-cannot-open class and has already fired by the time this runs; a
  // second report would land on a different surface, which the
  // (surface, message) dedup cannot collapse, and would double-count the rate.
  //
  // ⚠️ Callers that REPLACED an existing emit with this one must keep their own
  // event for the too-large case, or that class goes dark on their path.
  if (err.deviceCannotOpen) return;
  // Nor for a case a credential fixes. At the decrypt step a stale key and
  // damaged bytes are indistinguishable, and the stale-key half is routine (a
  // peer rotated the family key) — paging a human at `critical` for it, on
  // every sign-in attempt, is noise that would train the alert to be ignored.
  if (err.keyMayBeWrong) return;
  reportError({
    surface: 'pod-load-failure',
    // Constant per (step, source) — the byte count rides in `perf_doc_bytes`,
    // because a per-pod figure in the message would give every pod its own
    // dedup bucket and defeat the throttle entirely.
    //
    // ⚠️ The SOURCE is in the message on purpose. `errorReporter` buckets on
    // (surface, normalizeMessage) for 60s, so with a message constant across
    // all six call sites the automatic trusted-auto-open probe — which fires
    // first in every login sequence — won the bucket and swallowed the
    // user-facing PIN report seconds later. That is the exact defect that
    // justified deleting the hand-rolled copy, at larger scale.
    message: `Pod payload failed Automerge ${err.step} (${ctx.source})`,
    error: err,
    severity: 'critical',
    context: {
      action: `pod-load-corrupt:${ctx.source}`,
      error_code: err.step,
      file_id_tail: ctx.fileId ? ctx.fileId.slice(-6) : undefined,
      // `enrichAndRedact` backfills `family_id` only `if (ctx.activeFamilyId)`,
      // so on the resume path — a fresh install restoring from a .beanpod, the
      // population most likely to hit an unopenable pod — there is no active
      // family and the correlation key would simply be missing. Passing the
      // envelope's value fills that gap; where a family IS active the redactor
      // still wins, which is the behaviour every other report has.
      family_id: ctx.familyId ?? undefined,
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
  reportPayloadFailure(err, ctx);

  // `clearDataHelps: false` for BOTH classes. For too-large the file is intact
  // and clearing is the one action that destroys the local copy; for corrupt
  // the message says trying again will not help and points at support, so an
  // adjacent "clear your data and start fresh" button contradicts it.
  // THREE-way, matching `payloadErrorMessageKey`. A two-way ternary here meant
  // the same error object produced "try your password" inline and "your data may
  // be damaged, contact support" full-screen — and the full-screen one is what a
  // fresh install restoring from a .beanpod sees, which is precisely the
  // population whose saved key is most likely to be stale.
  // ⚠️ RECORD IT IN THE DOCUMENT, NOT IN TELEMETRY. The device that hit this is
  // the ONE device that cannot fix it — compaction needs three copies of the
  // document resident, strictly more than an open — so the fix has to reach
  // whoever CAN act. A CloudWatch query is not something a family's Settings
  // page can ask; a field on the member's own row is. Best-effort and detached:
  // a family already looking at a failure must not also be made to wait on a
  // write, and a failure here must never replace the message on screen.
  if (err.deviceCannotOpen) void noteDeviceCannotOpen();

  const overlayKey = err.keyMayBeWrong
    ? 'resumeSetup.podCredentialStale'
    : err.deviceCannotOpen
      ? 'resumeSetup.podTooLarge'
      : 'resumeSetup.podCorrupted';
  useFatalErrorStore().setFatal(
    useTranslationStore().t(overlayKey),
    // The envelope's family id reaches the user through this blob. It is
    // deliberately NOT in the report context above: `enrichAndRedact`
    // overwrites `family_id` with the ACTIVE family, so on a cross-family open
    // the argument would be silently discarded and the two would disagree.
    payloadErrorDetail(err, ctx.fileId, ctx.familyId),
    { clearDataHelps: false }
  );
}

/**
 * Leave a mark on this member's own row saying this device could not open the
 * pod, so the person who CAN compact it sees their family file read as due.
 *
 * ⚠️ EVERY FAILURE IS SWALLOWED, DELIBERATELY. This runs while a fatal overlay
 * is being raised: the document may be unopenable, the store may be empty, and
 * a throw here would replace an honest message about memory with an unrelated
 * one. A missed mark costs a heuristic; a throw costs the explanation.
 */
async function noteDeviceCannotOpen(): Promise<void> {
  try {
    const { useFamilyStore } = await import('@/stores/familyStore');
    const family = useFamilyStore();
    const me = family.currentMember;
    if (!me) return;
    const today = new Date().toISOString().slice(0, 10);
    if (me.podTooLargeSeenAt === today) return; // already said so today
    await family.updateMember(me.id, { podTooLargeSeenAt: today });
  } catch {
    // See above. The overlay is what matters here.
  }
}

/**
 * The lineage sibling of `surfacePayloadFatal`.
 *
 * A SEPARATE function, not a generalisation of the pair above: making those
 * generic over two unrelated error shapes would push
 * `deviceCannotOpen`/`keyMayBeWrong`/`payloadBytes` narrowing into code whose
 * entire value is that it has none. This file stays "THE one place a payload
 * failure becomes the fatal overlay" and gains a second, equally small entry.
 */
export function surfaceLineageFatal(err: PodLineageError, ctx: { familyId: string | null }): void {
  reportError({
    surface: 'pod-lineage',
    // Constant per verdict — no per-pod detail, so the dedup bucket works.
    message: `Pod lineage blocked at open: ${err.verdict}`,
    error: err,
    // Only a genuine `conflict` needs a human. An `adopt-remote` block is the
    // expected, recoverable outcome of a compaction meeting unsaved work.
    severity: err.verdict === 'conflict' ? 'critical' : 'warning',
    context: {
      action: 'blocked-at-open',
      error_code: err.verdict,
      family_id: ctx.familyId ?? undefined,
    },
  });
  useFatalErrorStore().setFatal(
    useTranslationStore().t('resumeSetup.podLineageBlocked'),
    JSON.stringify({ familyId: ctx.familyId, verdict: err.verdict, message: err.message }, null, 2),
    // Clearing local data is exactly the wrong move here: the local document may
    // hold the only copy of work that has not been saved, which is the whole
    // reason the guard refused rather than merging.
    { clearDataHelps: false }
  );
}
