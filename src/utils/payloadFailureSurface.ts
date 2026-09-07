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
import { logEvent } from '@/services/telemetry/logEvent';
// Type-and-predicate only. `capabilities.ts` derives module-level constants
// with no side effects, and every importer of this file is main thread.
import { getPlatform } from '@/services/sync/capabilities';
import { storeUrlFor } from '@/services/appUpdate/storeUrl';
import { PayloadLoadError, payloadErrorDetail, payloadErrorKind } from '@/types/sync';
import type { PayloadErrorKind } from '@/types/sync';
import type { UIStringKey } from '@/services/translation/uiStrings';
// VALUE import, not type-only: `surfaceBlockerFatal` dispatches on it. Safe —
// `podLineage.ts` imports only TYPES from `@/types/sync` and nothing from here,
// so there is no cycle.
import { PodLineageError } from '@/services/sync/podLineage';
import type { PodBlockMessageKey, RemoteBlocker } from '@/types/sync';

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
/**
 * The boot-overlay copy per kind. Keyed on `payloadErrorKind`, like the inline
 * table in `sync.ts`, so a sixth kind fails the build here rather than taking
 * a silent default.
 *
 * ⚠️ `unreadable` maps to `podCorrupted` DELIBERATELY, for now: a torn read is
 * shown full-screen as "your data may be damaged, contact support", which it
 * is not. Fixing that copy is a separate, user-visible change and is filed as
 * a follow-up; making the mismatch VISIBLE in a table rather than buried in a
 * ladder is this table's job.
 */
const PAYLOAD_OVERLAY_KEY = {
  'credential-stale': 'resumeSetup.podCredentialStale',
  'needs-update': 'resumeSetup.podNewerVersion',
  unreadable: 'resumeSetup.podCorrupted',
  'too-large': 'resumeSetup.podTooLarge',
  corrupt: 'resumeSetup.podCorrupted',
} as const satisfies Record<PayloadErrorKind, UIStringKey>;

/**
 * Which kinds page a human. Row reasoning, carried from the two early returns
 * this replaced:
 *  - too-large: `docClient.surface()` is the single emitter for the
 *    device-cannot-open class and has already fired; a second report lands on
 *    a different surface the dedup cannot collapse and double-counts the rate.
 *    Callers that REPLACED an existing emit with this one must keep their own
 *    event for that case, or it goes dark on their path.
 *  - credential-stale: at the decrypt step a stale key and damaged bytes are
 *    indistinguishable, and the stale-key half is routine (a peer rotated the
 *    family key); paging at `critical` on every sign-in would train the alert
 *    to be ignored.
 *  - needs-update: "update beanies" is neither an incident nor a data problem.
 */
const PAYLOAD_IS_INCIDENT = {
  'credential-stale': false,
  'needs-update': false,
  unreadable: true,
  'too-large': false,
  corrupt: true,
} as const satisfies Record<PayloadErrorKind, boolean>;

export { PAYLOAD_OVERLAY_KEY, PAYLOAD_IS_INCIDENT };

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
  // ONE guard over ONE discriminator, in place of two early returns that a
  // third class then had to remember to extend. See `PAYLOAD_IS_INCIDENT`.
  if (!PAYLOAD_IS_INCIDENT[payloadErrorKind(err)]) return;
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
  // A TABLE over the same discriminator `payloadErrorMessageKey` reads, so the
  // inline and full-screen copy cannot drift apart again. A hand-written
  // ternary here had ALREADY drifted from the inline ladder (three arms
  // against four) under a comment claiming they matched; a two-way one before
  // that produced "try your password" inline and "your data may be damaged,
  // contact support" full-screen for the same error.
  // ONE question, asked once, and read twice: the overlay copy and the way out
  // are two answers to the same "what kind of failure is this".
  const kind = payloadErrorKind(err);
  // `kind` is a closed union and the table is `satisfies Record<PayloadErrorKind,
  // ...>`, so every possible index is a key the table declares.
  // eslint-disable-next-line security/detect-object-injection
  const overlayKey = PAYLOAD_OVERLAY_KEY[kind];
  // ⚠️ THE ONLY THING IN THE APP THAT CAN BLOCK A PERSON OVER A VERSION, and it
  // is a fact about the file they just tried to open, never something we
  // deployed. On native there is a way out (the store); on web the service
  // worker has already updated the app, so the overlay stays exactly as it is.
  //
  // No `isNative()` beside this. `storeUrlFor` is typed on `getPlatform()`'s
  // union and answers `null` for `'web'`, so the platform is asked once, by the
  // function whose job that mapping is. A second reader here would be a guard
  // no test could make fail, which is the kind of safety net that reads as
  // covered without being it.
  const storeUrl = kind === 'needs-update' ? storeUrlFor(getPlatform()) : null;
  if (kind === 'needs-update') {
    // ⚠️ COUNTED FOR THE BLOCK, NOT FOR THE BUTTON. Gating this on `storeUrl`
    // made the web's version blocks invisible on this surface, which is the
    // half of the fleet where "how often does this happen" is answerable at
    // all. `detail` says whether the person was given a way out, so the two
    // populations stay separable without a second event.
    logEvent({
      level: 'warn',
      surface: 'app-update',
      message: 'blocked on an app update',
      context: {
        action: 'blocked',
        error_code: 'needs-update',
        os: getPlatform(),
        detail: storeUrl ? 'store-link' : 'no-store-link',
      },
    });
  }
  useFatalErrorStore().setFatal(
    useTranslationStore().t(overlayKey),
    // The envelope's family id reaches the user through this blob. It is
    // deliberately NOT in the report context above: `enrichAndRedact`
    // overwrites `family_id` with the ACTIVE family, so on a cross-family open
    // the argument would be silently discarded and the two would disagree.
    payloadErrorDetail(err, ctx.fileId, ctx.familyId),
    {
      clearDataHelps: false,
      // DATA, not a callback: this file must not learn about the update
      // composable, and through it a native plugin. See `FatalActionLink`.
      action: storeUrl ? { labelKey: 'appUpdate.openStore', url: storeUrl } : null,
    }
  );
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

/**
 * The full-screen copy for a blocker that is NOT one of the two specific
 * classes below. Keyed on `inlineMessageKey` because that IS a closed union;
 * `blockCode` is typed `string`, so a table over it could never be exhaustive.
 *
 * ⚠️ IT MAPS TO *OVERLAY* KEYS, NEVER TO THE INLINE KEY ITSELF. The inline
 * ladder and the full-screen copy are deliberately different strings resolved
 * through a table — reusing the inline string as full-screen copy is the
 * shipped drift bug recorded above `PAYLOAD_OVERLAY_KEY`. It is also why a
 * blocker cannot simply render `t(err.inlineMessageKey)` on a surface whose
 * buttons it does not know about.
 *
 * Because it is `satisfies Record<PodBlockMessageKey, …>`, a NEW blocker key
 * fails the build here until someone writes its overlay copy. That is what
 * makes "a refusal always has a render site" a compiler guarantee rather than a
 * review habit — this repo has now shipped that same defect three times.
 */
const BLOCKER_OVERLAY_KEY = {
  'podTooLarge.inline': 'resumeSetup.podTooLarge',
  'podCorrupted.inline': 'resumeSetup.podCorrupted',
  'podCredentialStale.inline': 'resumeSetup.podCredentialStale',
  'podLineage.unsyncedInline': 'resumeSetup.podLineageBlocked',
  'podLineage.conflictInline': 'resumeSetup.podLineageBlocked',
  'podMerge.failedInline': 'resumeSetup.podLineageBlocked',
  'podUnreadable.inline': 'resumeSetup.podCorrupted',
  'podNewerVersion.inline': 'resumeSetup.podNewerVersion',
  // ⚠️ ITS OWN COPY, and it names only actions that EXIST on a pre-shell
  // screen — close other tabs, reload. The inline copy points at "use the
  // family file" and Settings, neither of which is on the resume surface.
  'podLocalUnreadable.inline': 'resumeSetup.podLocalUnreadable',
} as const satisfies Record<PodBlockMessageKey, UIStringKey>;

export { BLOCKER_OVERLAY_KEY };

/**
 * ONE dispatch from any `RemoteBlocker` to the fatal overlay.
 *
 * ⚠️ WHY THIS EXISTS. The routing was `instanceof`, class by class, at THREE
 * separate call sites (`App.vue` twice, `ResumePodSetup.vue` once). A new
 * blocker class had to be added to all three by hand, and a forgotten one is a
 * refusal with no render site — the defect `564b0662` fixed, and the defect
 * three review passes of this plan each re-introduced by a different door.
 *
 * This is a DISPATCHER, not a generalisation: the two specific functions keep
 * their bodies and their narrowing, exactly as the comment above
 * `surfaceLineageFatal` requires. All that moves is the `instanceof` chain,
 * from three files into one.
 */
export function surfaceBlockerFatal(
  err: RemoteBlocker,
  ctx: { fileId: string | null; familyId: string | null; source: PayloadFailureSource }
): void {
  if (err instanceof PayloadLoadError) {
    surfacePayloadFatal(err, ctx);
    return;
  }
  if (err instanceof PodLineageError) {
    surfaceLineageFatal(err, { familyId: ctx.familyId });
    return;
  }
  // Every other blocker: report on the surface its own code names, then raise
  // the overlay with the copy the table guarantees exists.
  reportError({
    surface: 'pod-load-failure',
    // Constant per class so the (surface, message) dedup bucket works.
    message: `Pod blocked at open: ${err.blockCode}`,
    error: err,
    // Not `critical`: a refusal that PROTECTED the user's data is the system
    // working. The firehose still carries every occurrence.
    severity: 'error',
    context: {
      action: 'blocked-at-open',
      error_code: err.blockCode,
      ...(err.blockDetail ? { detail: err.blockDetail } : {}),
      ...(ctx.familyId ? { family_id: ctx.familyId } : {}),
    },
  });
  // `inlineMessageKey` is a closed union and the table is exhaustive over it.

  const overlayKey = BLOCKER_OVERLAY_KEY[err.inlineMessageKey];
  useFatalErrorStore().setFatal(
    useTranslationStore().t(overlayKey),
    JSON.stringify(
      { familyId: ctx.familyId, blockCode: err.blockCode, message: err.message },
      null,
      2
    ),
    // Clearing local data is exactly the wrong move for this whole class: the
    // local document may hold the only copy of work that was never saved, which
    // is precisely why the blocker refused instead of merging.
    { clearDataHelps: false }
  );
}
