/**
 * Pod-access failure taxonomy — pure. No Vue, no Pinia, no network.
 *
 * ## Why this exists
 *
 * Until 2026-08-10 the app answered "is this file my home?" with "do I own this
 * Drive file?". For every non-owner family member the answer is *no* — the shared
 * `.beanpod` is owned by the inviter — so the app silently minted them a private
 * copy and their data diverged from their family's with no visible symptom. See
 * `docs/plans/2026-08-10-never-fork-a-family-pod.md`.
 *
 * The binding rule that replaced it:
 *
 * > A family's pod binding is established once, by an explicit user action, and is
 * > never changed by the app. Verification may REPORT a problem; it may never
 * > RESOLVE one by creating or switching files.
 *
 * So every arm here is a *diagnosis* plus a recovery the user chooses. Nothing in
 * this module, and nothing that consumes it, may create a `.beanpod`. The only two
 * creation paths in the app are `createNewFile` (new family) and `migrateStorage`
 * (move storage) — both explicit, named user actions.
 *
 * ## Writability, not ownership
 *
 * `capabilities/canEdit` is the signal. A file shared with edit access is a
 * legitimate home regardless of who owns it. `ownedByMe` must never be consulted
 * on a load path again.
 */

// ⚠️ NO `DriveApiError` / `TokenExpiredError` IMPORT, DELIBERATELY. Importing
// either would drag this module's classification back onto class identities that
// 29 test mock factories do not provide — see `driveStatusOf` below.
import { PayloadLoadError, payloadErrorKind, type PayloadErrorKind } from '@/types/sync';
import type { StructuredErrorEntry } from '@/utils/structuredError';

export type PodAccessErrorCode =
  | 'OFFLINE'
  | 'PERMISSION_DENIED'
  | 'CONSENT_EXPIRED'
  | 'FILE_NOT_FOUND'
  | 'VERIFY_UNAVAILABLE'
  | 'CANONICAL_MISMATCH'
  | 'NO_HOME'
  // The file was saved by a NEWER beanies. `recoveries: []` is deliberate and
  // has precedent (`JOIN_ERRORS.NO_UNCLAIMED_MEMBERS`): no button in the app
  // can update the app.
  | 'FILE_NEWER_VERSION'
  // The file was saved by a beanies OLDER than the oldest format this build
  // reads. Same shape as the newer case — no button in the app can fix it — but
  // the opposite sentence: telling someone to update would send them looking for
  // a fix that does not exist. It reached `VERIFY_UNAVAILABLE` before, which is
  // a RETRYABLE warning, i.e. endless retry on a file no retry can open.
  | 'FILE_OLDER_VERSION';

/** The four recovery actions. Every one restores access to the ORIGINAL file. */
export type PodRecoveryAction =
  'retry' | 'reconnectAccount' | 'pickFamilyFile' | 'switchToCanonical';

export interface PodAccessEntry extends StructuredErrorEntry {
  recoveries: readonly PodRecoveryAction[];
}

/**
 * Single source of truth. `as const satisfies` makes a missing entry a build
 * error, so adding a code forces a message, a recovery, and a severity.
 *
 * NOTE there is deliberately no "create a new file" recovery, and there must
 * never be one. If a future code has no usable recovery, give it `recoveries: []`
 * and let the prose carry the action — the precedent is
 * `JOIN_ERRORS.NO_UNCLAIMED_MEMBERS`. A button that can't do the thing is worse
 * than a sentence that tells the truth.
 */
export const POD_ACCESS_ERRORS = {
  OFFLINE: {
    messageKey: 'podAccess.error.offline',
    recoveries: ['retry'],
    severity: 'warning',
  },
  PERMISSION_DENIED: {
    messageKey: 'podAccess.error.permissionDenied',
    recoveries: ['retry', 'pickFamilyFile'],
    severity: 'critical',
  },
  CONSENT_EXPIRED: {
    messageKey: 'podAccess.error.consentExpired',
    recoveries: ['reconnectAccount'],
    severity: 'critical',
  },
  FILE_NOT_FOUND: {
    messageKey: 'podAccess.error.fileNotFound',
    recoveries: ['retry', 'pickFamilyFile'],
    severity: 'critical',
  },
  VERIFY_UNAVAILABLE: {
    messageKey: 'podAccess.error.verifyUnavailable',
    recoveries: ['retry'],
    severity: 'warning',
  },
  CANONICAL_MISMATCH: {
    messageKey: 'podAccess.error.canonicalMismatch',
    recoveries: ['switchToCanonical', 'pickFamilyFile'],
    severity: 'critical',
  },
  NO_HOME: {
    messageKey: 'podAccess.error.noHome',
    recoveries: ['pickFamilyFile'],
    severity: 'critical',
  },
  FILE_NEWER_VERSION: {
    messageKey: 'podAccess.error.newerVersion',
    recoveries: [],
    severity: 'warning',
  },
  FILE_OLDER_VERSION: {
    messageKey: 'podOlderVersion.inline',
    recoveries: [],
    severity: 'warning',
  },
} as const satisfies Record<PodAccessErrorCode, PodAccessEntry>;

/**
 * Which codes page Slack. Data, not fifteen scattered `reportError` calls — so
 * "is this critical?" is answerable by reading one table.
 *
 * `critical` is reserved for "a user action failed or data is at risk". A member
 * writing to a non-canonical pod is live data divergence, so `CANONICAL_MISMATCH`
 * qualifies; a flaky Drive response does not.
 */
export const POD_ACCESS_SEVERITY: Record<PodAccessErrorCode, 'warning' | 'critical'> = {
  OFFLINE: 'warning',
  PERMISSION_DENIED: 'critical',
  CONSENT_EXPIRED: 'critical',
  FILE_NOT_FOUND: 'critical',
  VERIFY_UNAVAILABLE: 'warning',
  CANONICAL_MISMATCH: 'critical',
  NO_HOME: 'critical',
  // "Please update beanies" is not an incident and must not page.
  FILE_NEWER_VERSION: 'warning',
  FILE_OLDER_VERSION: 'warning',
};

/**
 * Which payload kinds this classifier answers for itself, and which fall through
 * to the network/auth arms below.
 *
 * `null` is a deliberate answer, not an omission: a corrupt or too-large file is
 * NOT a version problem, and a stale credential is a `CONSENT_EXPIRED` question
 * the arms below are better placed to answer. Exhaustive over `PayloadErrorKind`,
 * so a seventh kind fails the build rather than silently taking `null`.
 */
const VERSION_CODE_FOR_KIND = {
  'needs-update': 'FILE_NEWER_VERSION',
  'too-old': 'FILE_OLDER_VERSION',
  'credential-stale': null,
  unreadable: null,
  'too-large': null,
  corrupt: null,
} as const satisfies Record<PayloadErrorKind, PodAccessErrorCode | null>;

/**
 * Classify a thrown Drive/auth failure.
 *
 * `driveService.ts` throws `DriveFileNotFoundError` for BOTH 403 and 404, so
 * `.status` — not the class — is the discriminator. Do not switch on `instanceof`
 * for the not-found case.
 *
 * Anything unrecognised lands on `VERIFY_UNAVAILABLE` (a retryable warning)
 * rather than a critical: no arm of the verification mutates anything, so failing
 * closed buys no safety and would only manufacture false pages.
 */
/**
 * ⚠️ DUCK-TYPED, NOT `instanceof`, AND THAT IS THE POINT OF THIS PAIR.
 *
 * `classifyDriveFailure` is called from load and refresh paths all over the app,
 * including components whose tests replace `@/services/google/googleAuth`
 * wholesale. TWENTY-NINE of those factories export no `TokenExpiredError`, so
 * `e instanceof TokenExpiredError` evaluates `instanceof undefined` and dies with
 * "Right-hand side of instanceof is not callable" — thrown from a module the test
 * author never touched, in a test that has nothing to do with auth.
 *
 * That hazard was the stated reason for moving this classification OUT of
 * `syncStore` and into a shared helper. Moving it relocated the hazard rather
 * than removing it. Reading a `name` and a `status` removes it: neither depends
 * on a class identity surviving a mock factory. Same reasoning as
 * `isRemoteBlocker`, which CLAUDE.md records as duck-typed by design.
 */
function driveStatusOf(e: unknown): number | null {
  const status = (e as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : null;
}

function isTokenExpiredError(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null | undefined;
  if (err?.name === 'TokenExpiredError') return true;
  // The MESSAGE contract, not a second rule: `TokenExpiredError`'s own
  // doc-comment declares "the message must contain 'silent refresh failed'" and
  // `syncStore.isAuthTransientSyncError` already classifies on exactly that
  // regex. Accepting it here means a test double that forgets `name` — or the
  // explicit-message variant `googleDriveProvider.read()` throws — still
  // classifies, instead of silently degrading to VERIFY_UNAVAILABLE and sending
  // a token lapse to an endless retry.
  return typeof err?.message === 'string' && /silent refresh failed/i.test(err.message);
}

export function classifyDriveFailure(e: unknown): PodAccessErrorCode {
  // ⚠️ FIRST, above the `navigator.onLine` check. A typed, definite
  // classification must outrank ambient network state, or a connection blip
  // mid-read turns "update beanies" into "you are offline". Read through the
  // base-class member, never an `instanceof` of the subclass.
  // ⚠️ THROUGH `payloadErrorKind`, NOT A SECOND `instanceof` LADDER. Reading
  // `needsAppUpdate` directly was correct until a file from the PAST became its
  // own case: `needsAppUpdate` is false for it, so it fell past this line, past
  // the arms below, and landed on `VERIFY_UNAVAILABLE` — a retryable warning,
  // i.e. endless retry on a file no retry can open. `payloadErrorKind` already
  // answers this question exhaustively, and routing through it means a seventh
  // kind fails the BUILD here instead of taking a silent default.
  if (e instanceof PayloadLoadError) {
    const versionCode = VERSION_CODE_FOR_KIND[payloadErrorKind(e)];
    if (versionCode) return versionCode;
  }
  // ⚠️ AN HTTP STATUS OUTRANKS `navigator.onLine`, AND THAT IS A PROOF, NOT A
  // PREFERENCE. Receiving a status means the request REACHED Google and Google
  // answered, so `onLine === false` is provably wrong in this branch. It used to
  // sit below, which mattered most for 401: the browser reporting offline
  // (routinely and wrongly, in Capacitor and Android WebViews) sent a real
  // consent expiry to `OFFLINE`, and every caller that branches on auth — the
  // Drive restore among them — fell through to a generic dead end instead of
  // offering the reconnect that fixes it.
  const status = driveStatusOf(e);
  if (status === 401) return 'CONSENT_EXPIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'FILE_NOT_FOUND';

  // `typeof` guard so this module stays importable outside a DOM (worker/SSR/unit).
  //
  // Above `TokenExpiredError` DELIBERATELY, unlike the statuses. That error is
  // thrown when a silent refresh could not complete, and the ordinary reason it
  // could not is that the network was gone — so unlike a status it carries no
  // proof of connectivity, and when we genuinely are offline "you are offline" is
  // both true and the more useful of the two messages.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'OFFLINE';
  if (isTokenExpiredError(e)) return 'CONSENT_EXPIRED';
  return 'VERIFY_UNAVAILABLE'; // 408 timeout, 5xx, unknown — never silent
}

/**
 * A pod-access failure, ready to render.
 *
 * `data` is VIEW STATE, NOT TELEMETRY. `canonicalFileId` is a full Drive file id
 * because `switchToCanonical` needs it to call `rebindPodFile`. Never spread
 * `data` into a `logEvent`/`reportError` context — derive `file_id_tail`
 * explicitly. (`file_id` isn't in `ALLOWED_CONTEXT_KEYS` so the redactor would
 * strip it with a warning, but relying on the stripper is not a policy.)
 */
export interface PodAccessFailure {
  ok: false;
  code: PodAccessErrorCode;
  error?: unknown;
  data?: { canonicalFileId: string; canonicalName: string };
}

export type PodAccessResult = { ok: true } | PodAccessFailure;

/** Shape of the `getFileMetadata(…, 'capabilities/canEdit,trashed')` response. */
export interface PodFileMetadata {
  /**
   * ⚠️ `capabilities/canEdit` is a NESTED Drive field. The response is
   * `{ capabilities: { canEdit: true }, trashed: false }` — reading a flat
   * `meta.canEdit` yields `undefined` on every healthy file, a silent and
   * universal false positive. The type is shaped to make that mistake impossible.
   */
  capabilities?: { canEdit?: boolean };
  trashed?: boolean;
}

/**
 * Decide whether a successfully-fetched metadata response means "this is a
 * usable home". Returns `null` when everything is fine.
 *
 * Unreadable metadata (neither field present — an unexpected shape, a proxy
 * mangling the response) is `VERIFY_UNAVAILABLE`, not `PERMISSION_DENIED`:
 * we genuinely do not know, and guessing "denied" would page for a parse
 * problem.
 */
export function evaluatePodMetadata(meta: PodFileMetadata | null): PodAccessErrorCode | null {
  if (!meta) return 'VERIFY_UNAVAILABLE';
  if (meta.trashed === true) return 'FILE_NOT_FOUND';
  if (meta.capabilities?.canEdit === false) return 'PERMISSION_DENIED';
  // Require an explicit `true`. Anything else — the field absent, the response a
  // flat `{canEdit}` shape, a proxy having mangled it — means we did not verify
  // writability, and "we didn't check" must never read as "it's fine". Treating
  // undefined as healthy is exactly the silent false positive this whole change
  // exists to eliminate.
  if (meta.capabilities?.canEdit !== true) return 'VERIFY_UNAVAILABLE';
  return null;
}
