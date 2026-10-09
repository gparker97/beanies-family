/**
 * The create flow's Google Drive error registry: the ADR-024 pattern (`JOIN_ERRORS`,
 * `POD_ACCESS_ERRORS`) for "connect Google Drive as a new pod's storage".
 *
 * One code per thing that can go wrong, each mapped to one message key, the recoveries that can
 * apply, and a severity. `classifyCreateDriveFailure` is the ONE place a raw failure becomes a
 * code; both create surfaces (CreatePodView and ResumePodSetup) and the redirect-return producers
 * (OAuthCallbackPage, App.vue's boot catch) read the same answer, so they can no longer drift
 * apart on copy or on whether a failure pages Slack.
 *
 * ⚠️ LEAF-ONLY IMPORTS, AND THAT IS LOAD-BEARING. Nothing from `googleAuth`, `driveService`,
 * `capabilities` or `errorReporter`:
 *  - `resumePaths` imports this module, and it is dependency-light by contract (the router imports
 *    it statically). A `googleAuth` import would drag the auth and Capacitor graph in behind it.
 *  - 49 test files replace `@/services/google/googleAuth` with hand-written factories, and this
 *    classifier runs inside surfaces those tests mount. A factory missing a predicate would break
 *    a test that never touches auth (the hazard `podAccess.ts` records for `driveStatusOf`).
 * So the OAuth string predicates come from `oauthError`, the Drive shapes are duck-typed through
 * `podAccess`, and the report (which needs `isNative` / `reportError`) lives in `connectStorage`.
 */

import {
  CollisionCheckUnavailableError,
  DriveConsentDeniedError,
  FileNameCollisionError,
  OAuthRoundTripAbandonedError,
} from '@/types/sync';
import {
  isOAuthDescribedAccessDenied,
  isOAuthPolicyBlock,
  isPopupBlocked,
  isUserCancellation,
  POPUP_AUTH_TIMEOUT_NAME,
} from '@/services/google/oauthError';
import {
  driveStatusOf,
  isDriveStorageFull,
  isDriveThrottle,
  isTokenExpiredError,
} from '@/utils/podAccess';
import { classifyTransientFailure, type TransientFailure } from '@/utils/transientFailure';
import { GOOGLE_API_DISABLED_REASON, GOOGLE_DOMAIN_POLICY_REASON } from '@/utils/googleApiError';
import { resolveErrorView, type StructuredErrorEntry } from '@/utils/structuredError';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type CreateDriveErrorCode =
  | 'popup-blocked'
  | 'timeout'
  | 'offline'
  | 'consent-denied'
  | 'cancelled'
  | 'access-denied'
  | 'app-blocked'
  | 'auth-expired'
  | 'drive-busy'
  | 'drive-full'
  | 'drive-api-disabled'
  | 'name-collision'
  | 'collision-check-unavailable'
  | 'unsupported-browser'
  | 'unknown';

/**
 * - `retry`: run the same connect again.
 * - `chooseAccount`: run it with Google's account chooser forced ("use a different account").
 * - `useLocal`: keep the family file on this device instead (only where local files work).
 * - `getApp`: the beanies app, which supports local files, where this browser does not.
 */
export type CreateDriveRecovery = 'retry' | 'chooseAccount' | 'useLocal' | 'getApp';

export interface CreateDriveErrorEntry extends StructuredErrorEntry {
  recoveries: readonly CreateDriveRecovery[];
}

/**
 * Single source of truth. `as const satisfies` makes a missing code a build error.
 *
 * Severity: only `drive-api-disabled` (our own Google Cloud configuration) and `unknown` page
 * Slack. Everything else is a decision, the person's environment, or transient, and reports at
 * `warning`; its rate stays measurable in CloudWatch through `error_code`.
 *
 * Recoveries list EVERY action that can apply; `createDriveRecoveries` drops the local / app pair
 * that does not fit this device. `unsupported-browser` has none: it is set only by the local-file
 * connect, and the prose steers back to Drive.
 */
export const CREATE_DRIVE_ERRORS = {
  'popup-blocked': {
    messageKey: 'join.error.popupBlocked',
    recoveries: ['retry'],
    severity: 'warning',
  },
  timeout: {
    messageKey: 'createPod.driveError.timeout',
    recoveries: ['retry', 'useLocal'],
    severity: 'warning',
  },
  offline: {
    messageKey: 'createPod.driveError.offline',
    recoveries: ['retry'],
    severity: 'warning',
  },
  'consent-denied': {
    messageKey: 'createPod.driveConsentDenied',
    recoveries: ['retry', 'useLocal'],
    severity: 'warning',
  },
  cancelled: {
    messageKey: 'googleDrive.authCancelled',
    recoveries: ['retry', 'useLocal'],
    severity: 'warning',
  },
  // A described `access_denied`: Google said no without saying why we can trust (free text).
  // Not "Google needs a yes from you" (that is `cancelled`), and not proof of a policy block.
  'access-denied': {
    messageKey: 'createPod.driveError.accessDenied',
    recoveries: ['retry', 'chooseAccount', 'useLocal'],
    severity: 'warning',
  },
  // No `retry`: a policy block does not clear by asking again.
  'app-blocked': {
    messageKey: 'createPod.driveError.appBlocked',
    recoveries: ['chooseAccount', 'useLocal', 'getApp'],
    severity: 'warning',
  },
  'auth-expired': {
    messageKey: 'join.error.oauthRedirect',
    recoveries: ['retry'],
    severity: 'warning',
  },
  // Also the PROJECT quota reasons (`quotaExceeded` / `dailyLimitExceeded`), which are ours; the
  // report's `detail` carries Google's reason so an alarm can single them out.
  'drive-busy': {
    messageKey: 'createPod.driveError.busy',
    recoveries: ['retry'],
    severity: 'warning',
  },
  'drive-full': {
    messageKey: 'createPod.driveError.driveFull',
    recoveries: ['retry', 'chooseAccount', 'useLocal'],
    severity: 'warning',
  },
  'drive-api-disabled': {
    messageKey: 'createPod.driveError.apiDisabled',
    recoveries: ['retry', 'useLocal', 'getApp'],
    severity: 'critical',
  },
  'name-collision': {
    messageKey: 'createPod.duplicateFile',
    recoveries: ['retry', 'useLocal'],
    severity: 'warning',
  },
  'collision-check-unavailable': {
    messageKey: 'createPod.driveCheckUnavailable',
    recoveries: ['retry'],
    severity: 'warning',
  },
  'unsupported-browser': {
    messageKey: 'setup.localFileUnsupported',
    recoveries: [],
    severity: 'warning',
  },
  unknown: {
    messageKey: 'createPod.driveError.unknown',
    recoveries: ['retry', 'useLocal', 'getApp'],
    severity: 'critical',
  },
} as const satisfies Record<CreateDriveErrorCode, CreateDriveErrorEntry>;

/**
 * The `errorName` `connectStorage` gives `withTimeout` for its 150 s connect cap. One literal,
 * shared by the thrower and the classifier: a renamed literal would otherwise reclassify the
 * deadline as `unknown` and page Slack, silently.
 */
export const DRIVE_CONNECT_TIMEOUT_NAME = 'DriveConnectTimeoutError';

/**
 * A transient class, as the create flow names it. A `Record`, so a new class fails the build here.
 *
 * `network` is `offline` whatever `navigator.onLine` says: it stays true on a dead Wi-Fi link, so
 * gating on it would file those failures as `unknown` and page Slack on every tap.
 */
const TRANSIENT_CODES: Record<TransientFailure, CreateDriveErrorCode> = {
  timeout: 'timeout',
  server: 'drive-busy',
  network: 'offline',
};

function nameOf(e: unknown): unknown {
  return (e as { name?: unknown } | null | undefined)?.name;
}

function reasonOf(e: unknown): unknown {
  return (e as { reason?: unknown } | null | undefined)?.reason;
}

/**
 * Classify a create-flow Drive failure. Accepts anything a connect can throw, and also the bare
 * OAuth error STRING the redirect return carries (`access_denied`, `access_denied: <desc>`).
 *
 * ⚠️ A FLAT FIRST-MATCH LADDER: one `if (…) return code` per rule, no nesting, so a new rule is
 * one line in one visible position and the table test mirrors it row for row. Duck-typed on
 * `name` / `status` / `reason` / message; only the `@/types/sync` classes are matched by identity.
 * The order IS the logic:
 *  - typed errors first (a regex must never outrank a definite classification);
 *  - named deadlines next;
 *  - Google's explicit policy codes are `app-blocked`; a DESCRIBED `access_denied` is
 *    `access-denied` (neither the person's own Cancel nor a proven block: the #128 fixture is a
 *    localized plain decline that carries one, and so does a test-user restriction); a BARE
 *    `access_denied` falls through to `isUserCancellation` below and is `cancelled`;
 *  - an HTTP status outranks `navigator.onLine` and every message regex: a status means Google
 *    answered, so "offline" is provably wrong (same proof as `classifyDriveFailure`);
 *  - `classifyTransientFailure` is called ONCE; it returns null for every status the 4xx rules
 *    above it own;
 *  - `isTokenExpiredError` sits below `onLine`: a refresh that failed because the network is gone
 *    is better told as "you are offline".
 */
export function classifyCreateDriveFailure(e: unknown): CreateDriveErrorCode {
  if (e instanceof OAuthRoundTripAbandonedError) return 'cancelled';
  if (e instanceof DriveConsentDeniedError) return 'consent-denied';
  if (e instanceof FileNameCollisionError) return 'name-collision';
  if (e instanceof CollisionCheckUnavailableError) return 'collision-check-unavailable';
  if (nameOf(e) === DRIVE_CONNECT_TIMEOUT_NAME) return 'timeout';
  if (nameOf(e) === POPUP_AUTH_TIMEOUT_NAME) return 'timeout';
  if (isOAuthPolicyBlock(e)) return 'app-blocked';
  if (isOAuthDescribedAccessDenied(e)) return 'access-denied';
  if (driveStatusOf(e) === 401) return 'auth-expired';
  if (isDriveStorageFull(e)) return 'drive-full';
  if (driveStatusOf(e) === 403 && isDriveThrottle(e)) return 'drive-busy';
  if (driveStatusOf(e) === 429) return 'drive-busy';
  if (driveStatusOf(e) === 403 && reasonOf(e) === GOOGLE_API_DISABLED_REASON) {
    return 'drive-api-disabled';
  }
  if (driveStatusOf(e) === 403 && reasonOf(e) === GOOGLE_DOMAIN_POLICY_REASON) return 'app-blocked';
  const transient = classifyTransientFailure(e);
  if (transient) return TRANSIENT_CODES[transient];
  if (driveStatusOf(e) !== null) return 'unknown';
  if (isPopupBlocked(e)) return 'popup-blocked';
  if (isUserCancellation(e)) return 'cancelled';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (isTokenExpiredError(e)) return 'auth-expired';
  return 'unknown';
}

/**
 * The recoveries to offer for `code` on this device. Pure: the one caller passes
 * `canUseLocalFiles()`. Drops `useLocal` where local files do not work, and `getApp` where they
 * do (native and Chromium desktop already have the local alternative right here).
 *
 * `opts.alwaysOfferLocal`: append `useLocal` once (where local files work) even when this code's
 * recoveries omit it. For a host screen whose own purpose is choosing storage (ResumePodSetup's
 * failure phases): its local-file button is replaced by the stack, so it must not vanish behind
 * a Drive failure.
 */
export function createDriveRecoveries(
  code: CreateDriveErrorCode,
  canUseLocal: boolean,
  opts: { alwaysOfferLocal?: boolean } = {}
): CreateDriveRecovery[] {
  const all: readonly CreateDriveRecovery[] = CREATE_DRIVE_ERRORS[code].recoveries;
  const list = all.filter((r) =>
    r === 'useLocal' ? canUseLocal : r === 'getApp' ? !canUseLocal : true
  );
  if (opts.alwaysOfferLocal && canUseLocal && !list.includes('useLocal')) list.push('useLocal');
  return list;
}

/** Whether `v` is a registry code. The one validator for a stashed code read back from storage. */
export function isCreateDriveErrorCode(v: unknown): v is CreateDriveErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CREATE_DRIVE_ERRORS, v);
}

/**
 * The translated message for a create-flow Drive failure, or '' when there is none. The ONE
 * code-to-copy path for both create surfaces (CreatePodView, ResumePodSetup), so they cannot drift.
 */
export function createDriveFailureMessage(
  code: CreateDriveErrorCode | null,
  t: (key: UIStringKey) => string
): string {
  if (!code) return '';
  return resolveErrorView(CREATE_DRIVE_ERRORS, { code }, t)?.message ?? '';
}
