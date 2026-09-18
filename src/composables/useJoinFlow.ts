/**
 * useJoinFlow — owns the joiner-side state machine.
 *
 * `JoinPodView.vue` binds to this composable and renders. All async work
 * (registry lookup, OAuth, Drive read, decrypt, member selection, join
 * commit) routes through `tryStep` so every failure has a structured
 * `JoinErrorCode` with a single source of truth in `JOIN_ERRORS`.
 *
 * MVO note: the composable is the orchestrator; the view binds reactive
 * state and emits user intents (`handleAuthTap`, `handleSelectMember`,
 * `handleSubmitPin`, etc.). Stores and services are imported at
 * module scope so tests can `vi.mock` them — no DI plumbing.
 */

import { ref, computed } from 'vue';
import { assertNever } from '@/utils/assertNever';
import { watchJoinSteps, emitJoinCompleted } from '@/services/telemetry/joinStepEvents';
import type { PickFailureReason } from '@/services/google/drivePicker';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import {
  PayloadLoadError,
  payloadErrorKind,
  type PayloadErrorKind,
  type RemoteBlocker,
} from '@/types/sync';
import { lookupFamily } from '@/services/registry/registryService';
import { features } from '@/config/features';
import {
  parseInviteLink,
  hashInviteToken,
  redeemInviteToken,
  isInviteExpired,
  buildInviteLink,
} from '@/services/crypto/inviteService';
import {
  ensureRedirectAuthSettled,
  tryGetSilentToken,
  shouldUseRedirectAuth,
  getGoogleAccountEmail,
} from '@/services/google/googleAuth';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { getDeviceInfo, tail } from '@/utils/diagnostics';
import { platformContext } from '@/utils/platformLabel';
import type { StructuredErrorEntry } from '@/utils/structuredError';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import type { FamilyMember, RegistryEntry } from '@/types/models';
import { refuseMagicLink, type MagicLinkRefusal } from '@/services/auth/magicLink';
import { emitLinkMinted, emitLinkRedeemed } from '@/services/telemetry/loginFlowEvents';
import { mintMagicLink } from '@/services/auth/linkMint';

// ─── State machine + error registry ──────────────────────────────────────────

/**
 * Why the joiner is on the awaiting-auth card.
 *
 * Deliberately NOT `JoinErrorCode` values. A registry entry routes through `recordError`, which
 * pages `#beanies-errors` at its declared severity — and "you closed the file chooser" is not an
 * incident. These are states to explain, not failures to report.
 */
export type AwaitingReason =
  | 'initial' // first arrival, or a local-provider flow waiting on the drop zone
  | 'needs-pick' // consent is done; the file still has to be picked to grant access
  | 'cancelled' // the user dismissed the Picker
  // The pick FAILED (not cancelled). Distinct from 'cancelled' because this reason drives
  // user-facing copy, and telling someone who hit an error that they "cancelled" is untrue.
  // The error banner above the step says what actually broke; this reason only gets the
  // primary CTA back on screen.
  | 'failed'
  | 'redirecting'; // we just navigated them to Google; this page is going away

export type JoinStep =
  | 'lookup' // parsing URL, registry lookup, post-redirect-auth probe
  | 'awaiting-auth' // user must tap "Choose your data file"
  | 'authenticating' // OAuth in flight (popup or redirect)
  | 'loading' // file fetch / Picker / decrypt / familyId validate
  | 'pick-member' // unclaimed-member grid
  | 'set-pin' // the invitee chooses their 6-digit PIN
  | 'link-ready' // Phase 4 device link: pod open — hand off to the standard login machine
  | 'joining' // final commit
  | 'link-saved'; // the joiner saves their magic link before the hand-off

export type JoinErrorCode =
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_POPUP_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_FAILED'
  // The Picker iframe never bootstrapped (no 'loaded' callback). A STRUCTURAL PLATFORM
  // condition, not a fault: see the registry entry for why it is 'warning' and PICKER_FAILED
  // stays 'critical'.
  | 'PICKER_IFRAME_BLOCKED'
  | 'PICKER_UNAVAILABLE'
  | 'PICKER_AUTH_FAILED'
  | 'PICKER_TIMEOUT'
  | 'FILE_READ_FAILED'
  | 'FILE_DECRYPT_FAILED'
  | 'MAGIC_LINK_REVOKED'
  | 'MAGIC_LINK_NOT_FOUND'
  | 'MAGIC_LINK_EXPIRED'
  | 'MAGIC_LINK_KEY_ROTATED'
  | 'MAGIC_LINK_INCOMPLETE'
  | 'INVITE_LINK_UNPARSEABLE'
  | 'FILE_TOO_LARGE'
  | 'FILE_CORRUPT'
  | 'FILE_NEWER_VERSION'
  // The file predates the oldest format this build reads. Same shape as the
  // newer case — nothing in the app can fix it — but the opposite sentence.
  // It used to resolve to `FILE_CORRUPT`, which tells a joiner the family's data
  // is DAMAGED and pages Slack, over a file that is merely old.
  | 'FILE_OLDER_VERSION'
  | 'FILE_FAMILY_MISMATCH'
  | 'INVITE_TOKEN_EXPIRED'
  | 'INVITE_TOKEN_INVALID'
  | 'NO_UNCLAIMED_MEMBERS';

/**
 * A failed decrypt, as the error `tryStep` should record.
 *
 * Two jobs. It picks the right registry CODE, so neither payload class renders
 * `join.error.fileDecrypt` — copy that tells the joiner to ask the inviter for
 * a new link, with `recoveries: []` so there is no button at all, for a failure
 * a new link cannot touch.
 *
 * And it FORWARDS the classified error rather than a synthetic one. `tryStep`
 * hands whatever it catches to `reportError({ error })`, so rebuilding a plain
 * `new Error(result.error)` here stripped `step` and `payloadBytes` from the
 * one payload surface where they were unrecoverable — while both siblings
 * forward the real thing.
 */
/**
 * The join code for a blocker, or null when the blocker is not the join flow's
 * to name (a lineage block carries its own copy; a decrypt-step failure is the
 * rotated-key signature a fresh link genuinely fixes).
 *
 * The `instanceof` and the `keyMayBeWrong` guard live HERE, not at the call
 * sites: `doPickAndLoad` receives a `RemoteBlocker` that may be a
 * `PodLineageError`, so a second site narrowing for itself is a second copy of
 * this decision. Exported for its test only.
 */
export function joinCodeForBlocker(blocker: RemoteBlocker | undefined): JoinErrorCode | null {
  const payload = blocker instanceof PayloadLoadError ? blocker : null;
  if (!payload) return null;
  // ⚠️ THROUGH `payloadErrorKind`, NOT A LADDER OF GETTERS. Reading
  // `needsAppUpdate` / `deviceCannotOpen` directly was correct until a file from
  // the PAST became its own case: `needsAppUpdate` is false for it, so it fell
  // all the way through to `FILE_CORRUPT` — the code that tells a joiner the
  // family's data is DAMAGED and pages Slack for it, over a file that is merely
  // old. The resolver already answers this exhaustively; a mapping table means a
  // seventh kind fails the build here instead of taking the last `else`.
  return JOIN_CODE_FOR_KIND[payloadErrorKind(payload)];
}

/**
 * ⚠️ `null` IS AN ANSWER HERE. `credential-stale` is the rotated-key signature a
 * fresh invite link genuinely fixes, so the join flow must NOT name it as a file
 * problem — that is the `keyMayBeWrong` guard this table absorbed, kept as data
 * rather than as an early return the next editor has to notice.
 */
const JOIN_CODE_FOR_KIND = {
  'credential-stale': null,
  'needs-update': 'FILE_NEWER_VERSION',
  'too-old': 'FILE_OLDER_VERSION',
  'too-large': 'FILE_TOO_LARGE',
  unreadable: 'FILE_CORRUPT',
  corrupt: 'FILE_CORRUPT',
} as const satisfies Record<PayloadErrorKind, JoinErrorCode | null>;

function asJoinDecryptError(result: {
  error?: string;
  // Any blocker: a lineage block reaches the join path too, and must not be
  // reported as a wrong password.
  payloadError?: RemoteBlocker;
}): Error & { joinCode?: JoinErrorCode } {
  const err: Error & { joinCode?: JoinErrorCode } =
    result.payloadError ?? new Error(result.error ?? 'Decryption failed');
  // ⚠️ Payload-family only. The join path can now also receive a lineage or
  // merge block, and neither is a decrypt problem: they carry their own copy
  // and must not be tagged `FILE_CORRUPT` (which tells a joiner the family's
  // data is damaged and pages Slack).
  // `keyMayBeWrong` gates this inside the mapper. A `CorruptPayloadError` at
  // the decrypt step is the ROTATED-KEY signature (a member was removed, or the
  // Drive envelope is a newer re-encrypted copy), and for that
  // `FILE_DECRYPT_FAILED` is right: a fresh invite link genuinely fixes it.
  // Tagging it `FILE_CORRUPT` would tell the joiner their family's data is
  // damaged, offer no recovery button at all, and page Slack every attempt.
  const code = joinCodeForBlocker(result.payloadError);
  if (code) err.joinCode = code;
  return err;
}

export type RecoveryAction =
  'retry' | 'signInDifferentAccount' | 'tryAnotherDevice' | 'pickDifferentBean';

/**
 * Alias of the shared `StructuredErrorEntry` (`@/utils/structuredError`), narrowed
 * so this registry's `recoveries` are checked against the join flow's own action
 * union. The shape is the ADR-024 pattern; the view derivation is shared via
 * `resolveErrorView`.
 */
export interface JoinErrorEntry extends StructuredErrorEntry {
  recoveries: readonly RecoveryAction[];
}

export interface JoinError {
  code: JoinErrorCode;
  context?: Record<string, unknown>;
}

/**
 * Single source of truth for join-flow errors. Every code maps to one
 * i18n message key + an ordered list of recovery actions (rendered as
 * buttons) + a severity. Adding a new `JoinErrorCode` to the union and
 * forgetting to add a registry entry fails the build (`as const
 * satisfies` enforces exhaustiveness).
 */
export const JOIN_ERRORS = {
  OAUTH_REDIRECT_FAILED: {
    messageKey: 'join.error.oauthRedirect',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  /**
   * ⚠️ `severity: 'warning'`, NOT critical, and for the same reason `PICKER_UNAVAILABLE` is.
   * The overwhelmingly common cause is a person tapping "Cancel" on Google's consent screen,
   * which is a choice, not an incident. At `'critical'` every such decline paged
   * `#beanies-errors` — the surest way to teach an on-call human to ignore the channel.
   * It still reaches the CloudWatch firehose, which is where the decline RATE belongs.
   */
  OAUTH_SCOPE_DENIED: {
    messageKey: 'join.error.scopeDenied',
    recoveries: ['retry'],
    severity: 'warning',
  },
  /**
   * ⚠️ `severity: 'warning'` for the same reason: a browser's popup blocker firing is a
   * local browser setting, actionable only by the person in front of it — and the recoveries
   * below are exactly that action. Nothing for on-call to do at 2am.
   */
  OAUTH_POPUP_BLOCKED: {
    messageKey: 'join.error.popupBlocked',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'warning',
  },
  PICKER_SCRIPT_LOAD_FAILED: {
    messageKey: 'join.error.pickerScript',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_FAILED: {
    messageKey: 'join.error.pickerFailed',
    recoveries: ['retry', 'signInDifferentAccount', 'tryAnotherDevice'],
    severity: 'critical',
  },
  /**
   * The Picker iframe was built and shown, and then never called back at all — no `'loaded'`,
   * no `CANCEL`. On the installed iOS app that is the expected outcome BY CONSTRUCTION, because
   * the document origin is `capacitor://app.beanies.family`, which Google cannot validate as a
   * JavaScript origin; on iOS Safari it is ITP partitioning the `docs.google.com` frame's
   * storage after the trip through `accounts.google.com`.
   *
   * ⚠️ 'warning', DELIBERATELY, AND THE REASON IS THE 8s BUDGET. Detecting this at 8s instead of
   * 30s means strictly MORE occurrences reach the alert channel, because fewer users background
   * away first. Paging a developer on a structural platform condition is a rate to watch in the
   * firehose, not an incident — the same call the registry already makes at INVITE_TOKEN_EXPIRED
   * and NO_UNCLAIMED_MEMBERS. All severities still reach CloudWatch, so no signal is lost.
   * `PICKER_FAILED` (a genuine throw from `build()`/`setVisible`) stays 'critical'.
   *
   * Shares `join.error.pickerFailed`: the user-facing sentence is identical and a second string
   * saying the same thing in other words is a translation cost for nothing.
   */
  PICKER_IFRAME_BLOCKED: {
    messageKey: 'join.error.pickerFailed',
    recoveries: ['retry', 'signInDifferentAccount', 'tryAnotherDevice'],
    severity: 'warning',
  },
  /**
   * The Picker cannot run because THIS BUILD is misconfigured — `VITE_GOOGLE_API_KEY` is unset,
   * so `drivePicker` refuses before touching gapi.
   *
   * ⚠️ `severity: 'warning'`, NOT critical, and the distinction is the point: only `'critical'`
   * pages `#beanies-errors` (errorReporter.ts), and a build-configuration fault is not an
   * incident an on-call person can act on at 2am. It also used to render as "check your internet
   * connection and try again", which is a sentence with no relationship to the cause.
   *
   * `messageKey` is taken from `PICK_FAILURE_COPY` rather than invented, so the Picker's own
   * words and the join flow's stay one string.
   */
  PICKER_UNAVAILABLE: {
    messageKey: 'settings.drivePickerUnavailable',
    recoveries: ['tryAnotherDevice'],
    severity: 'warning',
  },
  /**
   * Google auth failed BEFORE the Picker could open. Previously collapsed into `PICKER_FAILED`,
   * which blamed the Picker for something it never got to attempt.
   */
  PICKER_AUTH_FAILED: {
    messageKey: 'settings.drivePickerAuth',
    recoveries: ['signInDifferentAccount', 'retry', 'tryAnotherDevice'],
    severity: 'warning',
  },
  /**
   * The Picker iframe loaded and then went quiet for the rest of the 30s window.
   *
   * ⚠️ NARROWER THAN IT WAS, AND THAT IS WHY IT STAYS 'critical'. Before the 8s bootstrap probe
   * this code absorbed the common iOS case (a frame that never called back at all), which is a
   * structural platform condition and not worth paging on. That case is now
   * `PICKER_IFRAME_BLOCKED` at 'warning'. What is left here is a frame that demonstrably
   * bootstrapped and then stalled, which is rare and genuinely an incident.
   *
   * DECISION POINT, deliberately left open rather than guessed: `recordError` now ships `os` and
   * `detail` on every join error, so once there is production data, check whether what remains
   * here still clusters on one platform. If it does, it is structural too and belongs at
   * 'warning' beside its sibling. Downgrading costs no diagnostic signal: `reportError` gates
   * Slack on 'critical' alone, and every severity reaches CloudWatch regardless.
   */
  PICKER_TIMEOUT: {
    messageKey: 'join.error.pickerTimeout',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_READ_FAILED: {
    messageKey: 'join.error.fileRead',
    recoveries: ['signInDifferentAccount', 'retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_DECRYPT_FAILED: {
    messageKey: 'join.error.fileDecrypt',
    recoveries: [],
    severity: 'critical',
  },
  /**
   * The invite and the key are FINE — this device ran out of memory inflating
   * the family's pod. Distinct from `FILE_DECRYPT_FAILED` because that entry's
   * copy tells the joiner to ask the inviter for a new link, which cannot help
   * and which they will do forever. `tryAnotherDevice` is the only recovery
   * that can actually work.
   */
  FILE_TOO_LARGE: {
    messageKey: 'join.error.fileTooLarge',
    recoveries: ['tryAnotherDevice'],
    severity: 'critical',
  },
  /**
   * The family's pod itself is damaged. Also distinct from
   * `FILE_DECRYPT_FAILED`: a new invite link points at the SAME file, so
   * "ask the inviter for a new link" sends the joiner in a circle. Nothing the
   * joiner can do fixes it, so no recovery action is offered either — but the
   * copy says who to talk to.
   */
  FILE_CORRUPT: {
    messageKey: 'join.error.fileCorrupt',
    recoveries: [],
    severity: 'critical',
  },
  /** The family file was saved by a newer beanies. Update, then reopen the link. */
  FILE_NEWER_VERSION: {
    messageKey: 'join.error.newerVersion',
    recoveries: [],
    severity: 'warning',
  },
  /** The family file predates the oldest format this build reads. */
  FILE_OLDER_VERSION: {
    messageKey: 'podOlderVersion.inline',
    recoveries: [],
    severity: 'warning',
  },
  FILE_FAMILY_MISMATCH: {
    messageKey: 'join.error.familyMismatch',
    recoveries: ['signInDifferentAccount'],
    severity: 'critical',
  },
  INVITE_TOKEN_EXPIRED: {
    messageKey: 'join.error.tokenExpired',
    recoveries: ['retry'],
    severity: 'critical',
  },
  // ── Magic link ──────────────────────────────────────────────────────────────
  // Three codes rather than one shared "link didn't work", because the way OUT differs
  // and a person holding a dead link is on a device that cannot self-serve. `retry` is
  // deliberately absent from all three: retrying a revoked, expired or stale-keyId link
  // does the same nothing every time, and offering a button that cannot work is worse
  // than offering none.
  MAGIC_LINK_NOT_FOUND: {
    messageKey: 'join.error.magicLinkNotFound',
    recoveries: [],
    severity: 'warning',
  },
  MAGIC_LINK_EXPIRED: {
    messageKey: 'join.error.magicLinkExpired',
    recoveries: [],
    severity: 'warning',
  },
  MAGIC_LINK_REVOKED: {
    messageKey: 'join.error.magicLinkRevoked',
    recoveries: [],
    severity: 'warning',
  },
  MAGIC_LINK_KEY_ROTATED: {
    messageKey: 'join.error.magicLinkKeyRotated',
    recoveries: [],
    severity: 'warning',
  },
  INVITE_LINK_UNPARSEABLE: {
    // The URL carried invite-shaped params but `parseInviteLink` rejected it outright.
    // ⚠️ ITS OWN CODE, and 'warning' NOT 'critical'. Routing this to
    // `INVITE_TOKEN_INVALID` (severity 'critical') meant every truncated link someone
    // pasted paged `#beanies-errors` — and truncation is expected input here, not an
    // exceptional event, so that is a noise generator aimed at the alerting channel.
    // A separate code also makes it distinguishable in CloudWatch from a token that
    // parsed fine but matched no key, which is a genuinely different failure.
    messageKey: 'join.error.linkUnparseable',
    recoveries: [],
    severity: 'warning',
  },
  MAGIC_LINK_INCOMPLETE: {
    // `ml=1` with no `m=`. Expected input, not an edge case: chat apps wrap and truncate
    // long URLs, so a half-copied link is a normal thing to arrive with.
    messageKey: 'join.error.magicLinkIncomplete',
    recoveries: [],
    severity: 'warning',
  },
  INVITE_TOKEN_INVALID: {
    // Most common cause is a stale Drive read — the inviter just generated
    // the link, but the device read a cached version of the .beanpod from
    // before the new inviteKey was persisted. `retry` re-runs the load,
    // which typically picks up the freshest version. The error copy
    // already directs the user to ask the inviter for a new link if retry
    // doesn't help — no in-app button is honest here, since the only real
    // remedy is out-of-band (a new link from the inviter).
    messageKey: 'join.error.tokenInvalid',
    recoveries: ['retry'],
    severity: 'critical',
  },
  NO_UNCLAIMED_MEMBERS: {
    // No in-app recovery — the user must contact a family admin out-of-band.
    // Empty recoveries render no buttons; the prose copy carries the action.
    messageKey: 'join.error.noUnclaimed',
    recoveries: [],
    severity: 'warning',
  },
} as const satisfies Record<JoinErrorCode, JoinErrorEntry>;

const log = (msg: string, ctx?: Record<string, unknown>): void => {
  console.warn(`[useJoinFlow] ${msg}`, ctx ?? {});
};

// ─── Composable ──────────────────────────────────────────────────────────────

export function useJoinFlow() {
  const route = useRoute();
  const router = useRouter();
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();
  const familyContextStore = useFamilyContextStore();
  const syncStore = useSyncStore();
  const { pick: pickBeanpod } = usePickBeanpodFile();

  // ─── State ────────────────────────────────────────────────────────────────

  const currentStep = ref<JoinStep>('lookup');

  /**
   * WHY the joiner is sitting on the awaiting-auth card.
   *
   * ⚠️ This exists because the card used to be reached from five places with no reason attached,
   * so "we are waiting for your tap", "you closed the chooser" and "we just sent you to Google and
   * you came back" all rendered as the same silent screen. A user reported it as the app doing
   * nothing.
   */
  const awaitingReason = ref<AwaitingReason>('initial');

  /**
   * The ONLY way to reach `awaiting-auth`.
   *
   * ⚠️ Structural, not conventional. There were FIVE direct writes of
   * `currentStep.value = 'awaiting-auth'` (four here, one in `JoinPodView.handleBack`), so "also
   * set the reason" would have been a five-site invariant policed by a test — the same shape as
   * the bug it is meant to prevent. As a required argument it is a compile error instead.
   */
  // ⚠️ Armed HERE, inside the composable's setup scope, so `watch` binds to the component
  // effect scope. The loop this exists to make visible produced no telemetry at all.
  watchJoinSteps(currentStep, awaitingReason);

  function enterAwaiting(reason: AwaitingReason): void {
    awaitingReason.value = reason;
    currentStep.value = 'awaiting-auth';
  }
  const currentError = ref<JoinError | null>(null);

  // Parsed from URL on mount.
  const targetFamilyId = ref('');
  // Phase 4 device-link mode (`lk=1`): the redeemer is an EXISTING member — after
  // decrypt, hand off to the standard login machine (full person picker + PIN prove)
  // instead of the unclaimed-only claim flow.
  const linkMode = ref(false);
  /**
   * Set when the URL carried `ml=1&m=<memberId>` — a magic link. It reuses every
   * `linkMode` branch (both skip the unclaimed-only claim flow and land on
   * `link-ready`); the only difference is WHERE the wrap comes from and that the
   * receiving screen already knows which member it is.
   */
  const magicLinkMemberId = ref<string | null>(null);
  /** Which link kind this arrival is, for telemetry. One funnel, two kinds. */
  function linkKind(): 'device' | 'magic' {
    return magicLinkMemberId.value ? 'magic' : 'device';
  }
  const targetProvider = ref<'google_drive' | 'local'>('local');
  const targetFileId = ref('');
  const targetFileName = ref('');
  const inviteToken = ref('');
  const inviteEmailHint = ref<string | null>(null);

  // Discovered during the flow.
  const registryEntry = ref<RegistryEntry | null>(null);
  const selectedMember = ref<FamilyMember | null>(null);

  // Tracks the last failed step so `handleRetry` knows what to re-fire.
  let lastFailedAction: (() => Promise<void>) | null = null;

  // ─── Computed ─────────────────────────────────────────────────────────────

  const expectedFileName = computed(() => {
    if (registryEntry.value?.displayPath) return registryEntry.value.displayPath;
    return targetFileName.value || null;
  });

  const unclaimedMembers = computed(() =>
    familyStore.members.filter((m) => m.requiresPassword && !m.isPet)
  );

  const currentInviteUrl = computed(() => {
    if (!targetFamilyId.value) return '';
    return buildInviteLink({
      familyId: targetFamilyId.value,
      token: inviteToken.value || undefined,
      provider: targetProvider.value,
      fileName: targetFileName.value || undefined,
      fileId: targetFileId.value || undefined,
      inviteeEmail: inviteEmailHint.value || undefined,
    });
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Single source of truth for join-flow error reporting. Sets
   * `currentError.value` AND fires a Slack alert via `reportError` with
   * the underlying detail in the message body. Used by `tryStep` for
   * caught errors and by every direct caller that knows synchronously
   * an error has occurred (file mismatch, invite token mismatch, etc.).
   *
   * **Allowlist routing — read before adding new context fields:**
   * fields passed in `context` land in the user-copied diagnostic blob
   * (read by `buildDiagnosticReport`) but only land in the Slack
   * `*Context:*` block if they're listed in `ALLOWED_CONTEXT_KEYS` in
   * `errorReporter.ts`. Anything else is silently dropped (with a
   * console.warn). The `message` field below is the escape hatch — it's
   * free text. We embed the disambiguating detail there so future
   * maintainers don't have to chase the allowlist for every new field.
   */
  function recordError(
    code: JoinErrorCode,
    context: Record<string, unknown> = {},
    err?: unknown
  ): void {
    currentError.value = { code, context };

    // Build a Slack-bound detail string from whatever the caller gave us.
    const detail =
      (typeof context.message === 'string' && context.message) ||
      (typeof context.error === 'string' && context.error) ||
      '';

    reportError({
      surface: `join-flow:${code}`,
      message: detail ? `${code}: ${detail}` : code,
      error: err,
      // Forward the per-code severity already declared on the registry so the
      // genuinely-fatal join failures page Slack under the critical-only gate;
      // recoverable codes (e.g. NO_UNCLAIMED_MEMBERS, 'warning') stay log-only.
      severity: JOIN_ERRORS[code].severity,
      context: {
        error_code: code,
        // ⚠️ WHICH PLATFORM THIS CAME FROM. Every join error code is reported from here, so
        // one spread answers it for all of them rather than patching the picker codes alone.
        // Without it a PICKER_TIMEOUT in CloudWatch cannot be attributed: the UA that
        // `enrichAndRedact` already stamps cannot separate the native WKWebView from Mobile
        // Safari, and that is precisely the distinction #98 turns on. Both keys are already
        // allowlisted and already mirrored in the Lambda, so nothing else has to change.
        ...platformContext(),
        // ⚠️ TAILED, NOT RAW. These two keys are on the telemetry allowlist, so whatever
        // they hold reaches CloudWatch and (on a critical) Slack. Assigned raw they carried
        // the FULL value despite the `_tail` names: a live 24h invite token, and a Drive file
        // id. `buildDiagnosticReport` below has always tailed these; this path had not, so
        // every join ERROR published a working invite token to the log firehose.
        file_id_tail: tail(targetFileId.value) || undefined,
        invite_token_tail: tail(inviteToken.value) || undefined,
        provider_type: targetProvider.value,
      },
    });
  }

  /**
   * Run an async step with structured error handling. On throw: log,
   * route through `recordError` (sets `currentError` + Slack alert),
   * return null. On success: return the value. Never throws to callers.
   */
  async function tryStep<T>(
    code: JoinErrorCode,
    fn: () => Promise<T>,
    contextExtra?: Record<string, unknown>
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A step may REFINE its code: `asJoinDecryptError` tags an out-of-memory
      // failure `FILE_TOO_LARGE` so the joiner is not told to ask for a new
      // invite link, which cannot help and which they would do forever.
      // Guarded: `err` is `unknown`. A bare `Promise.reject()` or a `throw
      // null` from a gapi/picker callback would make a raw property access
      // throw INSIDE the catch, so `tryStep` would reject instead of returning
      // null — no registry code, no Slack page, and the rejection escaping to
      // the deliberately non-paging unhandledrejection handler.
      const refined =
        (err && typeof err === 'object' && 'joinCode' in err
          ? (err as { joinCode?: JoinErrorCode }).joinCode
          : undefined) ?? code;
      log(`step ${refined} failed`, { err: message });
      recordError(refined, { error: message, ...contextExtra }, err);
      return null;
    }
  }

  async function buildDiagnosticReport(): Promise<string> {
    // Capture inviteKey hash prefixes from the loaded (or pending) envelope
    // so debugging can correlate the URL token's hash against what's
    // actually in the file. Hashes are non-secret (storage keys derived
    // via SHA-256), but we truncate anyway for log readability.
    const envelopeWithKeys = syncStore.envelope ?? syncStore.pendingEncryptedFile?.envelope ?? null;
    const inviteKeyHashes = envelopeWithKeys?.inviteKeys
      ? Object.keys(envelopeWithKeys.inviteKeys).map((h) => `${h.slice(0, 8)}…`)
      : [];

    // Hash of the URL's invite token. Including this lets us tell at a
    // glance whether the URL token's hash IS in the envelope (different
    // bug — should not happen given the equality check at line 500) or
    // is NOT (the documented "stale envelope" case where Drive returned
    // a copy from before addInvitePackage's syncNow landed). Empty when
    // no token is present in the URL (password-only join).
    let urlTokenHash: string | null = null;
    if (inviteToken.value) {
      try {
        const { hashInviteToken } = await import('@/services/crypto/inviteService');
        const full = await hashInviteToken(inviteToken.value);
        urlTokenHash = `${full.slice(0, 8)}…`;
      } catch {
        urlTokenHash = 'hash-failed';
      }
    }

    return JSON.stringify(
      {
        device: getDeviceInfo(),
        step: currentStep.value,
        error: currentError.value,
        url: {
          familyId: targetFamilyId.value || null,
          provider: targetProvider.value,
          fileIdTail: tail(targetFileId.value),
          fileName: targetFileName.value || null,
          inviteTokenTail: tail(inviteToken.value),
          inviteEmailHint: inviteEmailHint.value,
        },
        registry: {
          familyName: registryEntry.value?.familyName ?? null,
          provider: registryEntry.value?.provider ?? null,
        },
        envelope: {
          familyIdMatchesUrl:
            envelopeWithKeys?.familyId && targetFamilyId.value
              ? envelopeWithKeys.familyId === targetFamilyId.value
              : null,
          inviteKeyCount: inviteKeyHashes.length,
          inviteKeyHashes,
          urlTokenHash,
        },
        redirectAuth: shouldUseRedirectAuth(),
        googleEmail: getGoogleAccountEmail(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  function clearError(): void {
    currentError.value = null;
  }

  // ─── Step orchestration ───────────────────────────────────────────────────

  /** Read URL params into reactive state. */
  /**
   * @returns false when the URL is unusable and the caller must NOT continue. It used to
   * return void, so `init()` recorded the correct "this link is incomplete" error and then
   * ran the entire cloud flow anyway — walking the user through a full Google consent
   * round-trip for a link already known to be dead, and ending on "ask for a new invite
   * link" from the CLASSIC branch, because `magicLinkMemberId` was null. Exactly the
   * misleading fall-through the comment inside it claims to prevent.
   */
  function parseUrl(): boolean {
    const url = `${window.location.origin}${route.fullPath}`;
    const parsed = parseInviteLink(url);
    if (!parsed) return false;
    targetFamilyId.value = parsed.familyId;
    targetProvider.value = parsed.provider ?? 'local';
    targetFileName.value = parsed.fileName ?? '';
    targetFileId.value = parsed.fileId ?? '';
    inviteToken.value = parsed.token ?? '';
    inviteEmailHint.value = parsed.inviteeEmail ?? null;
    linkMode.value = parsed.linkMode === true || parsed.magicLink === true;
    magicLinkMemberId.value = parsed.magicLink === true ? (parsed.memberId ?? null) : null;
    // ⚠️ `ml=1` with no `m=` is an UNUSABLE link, not a classic invite. Chat apps
    // truncate long URLs, so this is expected input rather than an edge case, and it must
    // say so instead of falling through to the invite path and failing later with
    // something misleading.
    // ⚠️ DO NOT STRIP `t=` FROM THE URL HERE. This was tried and reverted in the same
    // change that added the magic link, because it breaks the primary platform.
    //
    // The intent was good: this repo's convention is that a full-key secret rides the
    // FRAGMENT, never the query string (`recoveryKit`: "fragments never leave the
    // browser"), so leaving a 7-day token in the address bar, the history entry and any
    // `Referer` is not ideal.
    //
    // But `usePickBeanpodFile` composes the OAuth returnPath as
    // `${window.location.pathname}${window.location.search}` — read from the LIVE address
    // bar — and that returnPath is the ONLY carrier of the invite token across a
    // full-page redirect. Nothing stashes it anywhere else. So a `router.replace` that
    // removes `t=` means: joiner taps the CTA, goes to Google, consents, comes back with
    // `inviteToken` empty, the decrypt is skipped with no error, and they land on
    // "contact a family admin" (classic invite) or on an UNDECRYPTED pod (`ml=1`). That is
    // every redirect-auth platform — iPhone, iPad, installed PWA, native shell — failing
    // in a way indistinguishable from the consent loop that was just fixed.
    //
    // Deferring the strip until after decrypt does not save it either: iOS Safari discards
    // backgrounded tabs, and a reload of a stripped URL has nothing to recover from.
    //
    // The real fix is the fragment, and it is blocked on the returnPath carrying one.
    // Until then the token stays in the query string, which is the same risk CLASS as the
    // existing 24-hour invite rather than a new one.
    if (parsed.magicLink === true && !parsed.memberId) {
      emitLinkRedeemed({ kind: 'magic', ok: false, errorCode: 'no-member-param' });
      recordError('MAGIC_LINK_INCOMPLETE');
      return false;
    }
    return true;
  }

  /**
   * If we're returning from a full-page redirect-auth, complete the
   * exchange so subsequent silent-token calls find a cached token.
   * Errors here mean the redirect round-trip failed cleanly — we surface
   * `OAUTH_REDIRECT_FAILED` and let the user retry. No-op if there's no
   * pending redirect to consume.
   */
  async function consumePendingRedirectAuth(): Promise<void> {
    // Share the one memoized redemption with App.vue's boot handler so the invite
    // page can't double-consume the one-time code (native-safe no-op). See ADR-026.
    await tryStep('OAUTH_REDIRECT_FAILED', () => ensureRedirectAuthSettled());
  }

  /**
   * Look up the family in the registry. Failures here aren't fatal —
   * the user can still proceed with the URL params we already have.
   * Logs but does not set `currentError`.
   */
  async function performLookup(): Promise<void> {
    if (!targetFamilyId.value) return;
    if (!features.registry) return;
    try {
      const entry = await lookupFamily(targetFamilyId.value);
      registryEntry.value = entry;
      if (entry?.provider) {
        const provider = entry.provider;
        if (provider === 'google_drive' || provider === 'local') {
          targetProvider.value = provider;
        }
      }
    } catch (err) {
      // Registry being offline is acceptable — log and continue with
      // whatever the URL provided. The cloud-load step will fail with
      // a more specific code if applicable.
      log('registry lookup failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Try a silent direct read by fileId. Returns 'loaded' on success,
   * 'needs-pick' on a 404/403 / "File not found" symptom (drive.file
   * scope hasn't granted API-level access yet — Picker is the recovery
   * path), or 'auth' if no silent token is available. Errors set
   * `FILE_READ_FAILED`.
   */
  /**
   * The last (fileId, token) pair observed to need the Picker.
   *
   * ⚠️ INSTANCE SCOPE, NOT MODULE SCOPE. `tryAutoLoadByFileId` takes no arguments and reads
   * `targetFileId` from closure, so this lives inside `useJoinFlow()`. At module scope it would
   * leak across join attempts and across unit tests, which is the failure mode this kind of
   * optimisation usually ships with.
   *
   * WHY: the ordinary init-then-tap sequence issues up to THREE identical Drive reads — `init()`
   * → `runCloudFlow(false)`, the tap's `runCloudFlow(true)`, and `resolveWithoutPicker`. The
   * second and third are deliberate (see the comments on `resolveWithoutPicker`) and must not be
   * deleted; only a read that would repeat a KNOWN answer with the SAME token is skipped.
   *
   * INVALIDATION: every exit BELOW the token check writes this (the 404/403 branch sets it, every
   * other exit nulls it), and `doPickAndLoad`'s `'picked'` arm nulls it because a successful pick
   * creates the grant. The two early returns ABOVE the token check (no provider/fileId, and no
   * silent token) deliberately leave it untouched: they never reached Drive, so they have no
   * verdict to record, and a stale entry cannot mislead because the memo is keyed on
   * `(fileId, token)` and can only ever replay the same answer for the same pair.
   */
  let lastNeedsPick: { fileId: string; token: string } | null = null;

  async function tryAutoLoadByFileId(): Promise<'loaded' | 'needs-pick' | 'auth' | 'error'> {
    if (targetProvider.value !== 'google_drive' || !targetFileId.value) {
      return 'auth';
    }
    const silent = await tryGetSilentToken();
    if (!silent) return 'auth';

    // ⚠️ SHORT-CIRCUITS ONLY 'needs-pick', which is the one outcome decided by the HTTP status
    // alone and so is exact to replay. Every other exit consults `syncStore.error` /
    // `result.payloadError`, where a skipped call could report a stale error.
    //
    // ⚠️ KEYED ON THE TOKEN AS WELL AS THE FILE. `usePickBeanpodFile` runs
    // `tryReconnectSilently(loginHint)` before `tryGetSilentToken()`, which can mint a token for a
    // DIFFERENT account — that retry is a genuine recovery and must not be suppressed. A coarser
    // "skip if the last call said needs-pick" rule would wrongly kill it.
    if (lastNeedsPick?.fileId === targetFileId.value && lastNeedsPick.token === silent) {
      return 'needs-pick';
    }
    // Fail open: from here every exit rewrites the memo, so an unexpected path costs a repeated
    // read (today's behaviour) and never a wrong answer.
    lastNeedsPick = null;

    const fileName = expectedFileName.value || 'family.beanpod';
    const result = await syncStore.loadFromGoogleDrive(targetFileId.value, fileName);

    if (result.success) {
      return 'loaded';
    }

    if (result.needsPassword) {
      // File read OK, just needs decryption — handled downstream.
      return 'loaded';
    }

    // Branch on the STRUCTURED HTTP status, not a localized message substring
    // (2026-06-19, finding 7). A 404 (file not visible) or 403 (no permission)
    // means the `drive.file` scope hasn't granted API-level access yet → the
    // Picker is the recovery path. Locale-independent: the old substring match
    // silently failed for non-English Drive messages, dead-ending the iOS join.
    if (result.status === 404 || result.status === 403) {
      lastNeedsPick = { fileId: targetFileId.value, token: silent };
      return 'needs-pick';
    }

    // A classified blocker (a file from a newer beanies, a torn or oversized
    // one) gets its own code through the ONE mapper; `FILE_READ_FAILED` is the
    // fallback for everything else.
    const storeError = (syncStore.error as string | null) ?? '';
    const blockerCode = joinCodeForBlocker(result.payloadError);
    if (blockerCode) {
      recordError(blockerCode, {
        error: storeError || result.payloadError?.inlineMessageKey || blockerCode,
        hintEmail: inviteEmailHint.value,
        actualEmail: getGoogleAccountEmail(),
      });
      return 'error';
    }
    recordError('FILE_READ_FAILED', {
      error: storeError || 'Unknown file-load error',
      hintEmail: inviteEmailHint.value,
      actualEmail: getGoogleAccountEmail(),
    });
    return 'error';
  }

  /**
   * Open the Picker, read the picked file. Returns `true` only when the
   * file was picked AND loaded into `syncStore.pendingEncryptedFile`.
   * Returns `false` for any non-progressing outcome — caller decides
   * whether to advance or bail.
   *
   * Maps the `PickBeanpodFileResult` discriminated union to the right
   * `JoinErrorCode`:
   *   - `failed/config` or `failed/load` → `PICKER_SCRIPT_LOAD_FAILED`
   *     (true script/config issues)
   *   - `failed/timeout` → `PICKER_TIMEOUT`
   *   - `failed/open` or `failed/auth` → `PICKER_FAILED` (a genuine throw out of
   *     build()/setVisible — still 'critical')
   *   - `failed/iframe` → `PICKER_IFRAME_BLOCKED` (the frame never called back, which on iOS
   *     happens by construction — 'warning', deliberately off the pager)
   *
   * The underlying Error message rides in `currentError.context.message`
   * so the diagnostic blob — and the Slack alert via `recordError` —
   * carries the actual cause.
   *
   * `cancelled` is silent (no error; step regresses to `awaiting-auth`).
   */
  /**
   * Which join error a Picker failure becomes.
   *
   * ⚠️ A TABLE, NOT A NESTED TERNARY, and `satisfies` is the point: adding a `PickFailureReason`
   * without a mapping here fails the build instead of silently taking the last ternary arm. The
   * ternary this replaced told two lies — it rendered a build-configuration fault as "check your
   * internet connection", and it blamed the Picker for an auth failure.
   *
   * Keep in step with `PICK_FAILURE_COPY` in `drivePicker.ts`, which is the sibling table over the
   * same union and supplies the user-facing words. Both are `satisfies Record<PickFailureReason,…>`
   * so a new reason breaks BOTH builds.
   */
  const JOIN_CODE_FOR_PICK_REASON = {
    config: 'PICKER_UNAVAILABLE',
    auth: 'PICKER_AUTH_FAILED',
    'popup-blocked': 'OAUTH_POPUP_BLOCKED',
    load: 'PICKER_SCRIPT_LOAD_FAILED',
    timeout: 'PICKER_TIMEOUT',
    open: 'PICKER_FAILED',
    // Split from `open` deliberately. `open` is a THROW out of build()/setVisible (a genuine
    // fault, still 'critical'); `iframe` is the frame never calling back, which on iOS is a
    // structural platform condition. See the PICKER_IFRAME_BLOCKED registry entry.
    iframe: 'PICKER_IFRAME_BLOCKED',
  } as const satisfies Record<PickFailureReason, JoinErrorCode>;

  async function doPickAndLoad(chooseAccount = false): Promise<boolean> {
    const picked = await pickBeanpod({
      chooseAccount,
      // ⚠️ ASK FOR OFFLINE ACCESS. Google returns a refresh token only when the prompt
      // includes `consent`, and the join's default prompt is `select_account` alone. A
      // joiner whose Google account had already granted these scopes elsewhere (their
      // phone, another browser) therefore received an access token with nothing to refresh
      // it, and Drive stopped working about an hour after they joined, silently — the
      // `auth-no-refresh-token` warning is that happening.
      //
      // ⚠️ NOT `chooseAccount: true`, which would produce the same prompt. That flag also
      // skips the silent token, and skipping it forces a full-page redirect instead of
      // opening the Picker — the closed consent loop two iPhone users hit in production.
      // `offlineAccess` changes the prompt and nothing else.
      offlineAccess: true,
      loginHint: inviteEmailHint.value ?? undefined,
      // The invite link carries the pod's file id, so the system-browser picker can show that
      // ONE file instead of opening on the joiner's whole Drive.
      expectedFileId: targetFileId.value ?? undefined,
      // ⚠️ RETRY THE DIRECT READ FIRST. The silent attempt in `runCloudFlow` runs BEFORE
      // authentication, so on a fresh browser it returns 'auth' without ever trying the
      // `fileId` — and nothing retried it once a token existed. Anyone whose app already
      // has a `drive.file` grant for that file (always true for the pod's OWNER, since the
      // app created it, and for any member who has picked it before on this account) was
      // therefore shown a file chooser for a file they already had access to.
      //
      // `tryAutoLoadByFileId` is reused rather than reimplemented so the 404/403 → Picker
      // classification stays in ONE place. On a genuine first join it returns 'needs-pick'
      // and the Picker opens exactly as before — that path is unchanged.
      resolveWithoutPicker: async () => {
        if (!targetFileId.value) return false;
        const direct = await tryAutoLoadByFileId();
        // 'error' means it already recorded a classified failure; treat it as handled so
        // the Picker does not open on top of an error card.
        return direct === 'loaded' || direct === 'error';
      },
    });

    // A successful pick CREATES the grant, so any remembered "this needs the Picker" verdict is
    // now stale and a later probe with the same token must be allowed to succeed.
    if (picked.kind === 'picked') lastNeedsPick = null;

    // ⚠️ A `switch` with `assertNever`, NOT an `if` chain. A fifth `kind` must be a compile error
    // rather than another silent fall-through — which is precisely how `redirecting` spent its
    // life disguised as `cancelled`.
    switch (picked.kind) {
      case 'cancelled':
        // The user dismissed the chooser. Not an error, but they must be told something and
        // offered a way on, or the awaiting card looks identical to "nothing happened".
        enterAwaiting('cancelled');
        return false;

      case 'redirecting':
        // We navigated them to Google. Nothing is wrong and nothing is owed to the UI — but the
        // step still carries a reason so the return journey is legible in telemetry.
        enterAwaiting('redirecting');
        return false;

      case 'failed':
        recordError(JOIN_CODE_FOR_PICK_REASON[picked.reason], {
          reason: picked.reason,
          message: picked.message,
        });
        // ⚠️ MOVE THE STEP, or the joiner is left with no button at all. `recordError` only sets
        // `currentError`; it never touches `currentStep`, so without this the step stays at
        // 'authenticating'. In `JoinPodView` the spinner renders on `isBusy && !currentErrorView`
        // (now false, an error exists) and the CTA renders only on 'awaiting-auth' (also false),
        // so NEITHER renders and the primary "Choose your data file" button disappears at exactly
        // the moment it is needed. The error banner sits outside the step template, so moving the
        // step shows the CTA *and* keeps the banner.
        enterAwaiting('failed');
        return false;

      case 'loaded':
        // Already loaded by `resolveWithoutPicker`; the Picker never opened. `currentError`
        // is set only on the classified-failure arm, so it is what tells the two apart.
        if (currentError.value) return false;
        logEvent({
          level: 'info',
          surface: 'join-flow',
          message: 'file loaded directly; picker not needed',
          context: { action: 'direct_load_no_picker' },
        });
        return true;

      case 'picked':
        break;

      default:
        return assertNever(picked, 'unhandled pick result');
    }

    targetFileId.value = picked.fileId;
    // ⚠️ ONLY WHEN THE PICK ACTUALLY CARRIED A NAME. This was unconditional, which was harmless
    // while every pick came from the iframe Picker (it always supplies `docs[0].name`). The
    // system-browser Picker returns file IDS ONLY, so an unconditional assignment writes `''`
    // here and DESTROYS the `fn=` value parsed from the invite link one line before it is used:
    // `expectedFileName` reads `registryEntry?.displayPath ?? targetFileName.value`, so on any
    // join where the registry lookup produced no displayPath (offline, registry miss) the
    // fallback below would collapse to an empty name and the pod would bind with no name at all.
    if (picked.fileName) targetFileName.value = picked.fileName;

    const fileName = expectedFileName.value || picked.fileName;
    const result = await syncStore.loadFromGoogleDrive(picked.fileId, fileName);

    if (!result.success && !result.needsPassword) {
      const storeError = (syncStore.error as string | null) ?? '';
      recordError('FILE_READ_FAILED', {
        error: storeError || 'Picked file could not be loaded',
        hintEmail: inviteEmailHint.value,
        actualEmail: getGoogleAccountEmail(),
      });
      return false;
    }
    return true;
  }

  /**
   * Each magic-link refusal maps onto the join-error registry, which already owns the
   * user-facing copy, the severity and the recovery affordance for every code.
   */
  /**
   * ⚠️ MAGIC-LINK REFUSALS GET THEIR OWN CODES. Reusing `INVITE_TOKEN_*` looked like
   * sensible DRY and was wrong twice over:
   *
   *  · both are `severity: 'critical'`, so every lapsed 7-day link would page
   *    `#beanies-errors`. Links minted in the same week lapse in the same week, so that
   *    is a self-inflicted alert storm on the one channel that must stay readable;
   *  · their copy says "ask the inviter for a new link". There is no inviter — the person
   *    minted their own link — and the real remedy (Settings, on a device where they are
   *    already signed in) is never named.
   *
   * The three codes added with this feature are `warning` with `recoveries: []`, for the
   * documented reason that retrying a revoked, expired or stale-key link fails
   * identically every time. These two must match them.
   */
  const MAGIC_LINK_JOIN_ERROR: Record<MagicLinkRefusal, JoinErrorCode> = {
    'no-entry': 'MAGIC_LINK_NOT_FOUND',
    'link-revoked': 'MAGIC_LINK_REVOKED',
    'token-expired': 'MAGIC_LINK_EXPIRED',
    'key-rotated': 'MAGIC_LINK_KEY_ROTATED',
  };

  /**
   * Try to decrypt the pending V4 file using the cached invite token.
   * Returns true if decryption succeeded; false if a password modal is
   * needed instead (no invite token, or the token isn't recognized).
   * Sets `INVITE_TOKEN_EXPIRED` / `INVITE_TOKEN_INVALID` /
   * `FILE_DECRYPT_FAILED` as appropriate.
   */
  /**
   * The shared tail: unwrap, decrypt, classify. Extracted so the invite resolver and the
   * magic-link resolver differ ONLY in how they find the wrap. Every error arm below is
   * unchanged from the invite-only version.
   */
  async function decryptPendingWithWrap(
    wrapped: string,
    salt: string,
    token: string
  ): Promise<boolean> {
    const decrypted = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const fk = await redeemInviteToken(wrapped, salt, token);
      const result = await syncStore.decryptPendingFileWithKey(fk);
      if (!result.success) throw asJoinDecryptError(result);
      return true;
    });
    if (!decrypted && linkMode.value)
      emitLinkRedeemed({ kind: linkKind(), ok: false, errorCode: 'decrypt-failed' });
    return decrypted ?? false;
  }

  /**
   * Magic link: resolve the wrap from `memberLinkKeys[memberId]` and run the four
   * ordered refusal checks, each with its OWN named reason. Deliberately a sibling of
   * `tryInviteTokenDecrypt` rather than a branch inside it — that function is named for
   * the invite token and guards on `inviteKeys` being present on its first line, so a
   * magic-link branch above it makes the name a lie and one below it makes the whole
   * feature depend on a dict it does not use.
   */
  async function tryMagicLinkDecrypt(): Promise<boolean> {
    const memberId = magicLinkMemberId.value;
    if (!memberId || !inviteToken.value) return false;
    const envelope = syncStore.pendingEncryptedFile?.envelope;
    if (!envelope) return false;

    const pkg = envelope.memberLinkKeys?.[memberId];
    const refusal = await refuseMagicLink(pkg, inviteToken.value, envelope.keyId);
    if (refusal) {
      emitLinkRedeemed({ kind: 'magic', ok: false, errorCode: refusal });
      // Each refusal has its own copy because the way out differs: a revoked link means
      // "a newer one exists", an expired one means "ask a signed-in device", a rotated
      // key means "this is out of date". A shared generic message would send all three
      // to the wrong remedy.
      recordError(MAGIC_LINK_JOIN_ERROR[refusal]);
      return false;
    }

    // Non-null: `refuseMagicLink` returns 'no-entry' when the package is missing.
    return decryptPendingWithWrap(pkg!.wrapped, pkg!.salt, inviteToken.value);
  }

  async function tryInviteTokenDecrypt(): Promise<boolean> {
    if (magicLinkMemberId.value) return tryMagicLinkDecrypt();
    if (!inviteToken.value) return false;
    const pending = syncStore.pendingEncryptedFile;
    if (!pending?.envelope?.inviteKeys) return false;

    const tokenHash = await hashInviteToken(inviteToken.value);
    const pkg = pending.envelope.inviteKeys[tokenHash];

    if (!pkg) {
      // R2-F15: the redeem failure arm must reach the firehose for device links —
      // "minted with no matching redeem" is otherwise untriageable.
      if (linkMode.value)
        emitLinkRedeemed({ kind: linkKind(), ok: false, errorCode: 'token-invalid' });
      recordError('INVITE_TOKEN_INVALID');
      return false;
    }
    if (isInviteExpired(pkg.expiresAt)) {
      if (linkMode.value)
        emitLinkRedeemed({ kind: linkKind(), ok: false, errorCode: 'token-expired' });
      recordError('INVITE_TOKEN_EXPIRED', { expiresAt: pkg.expiresAt });
      return false;
    }

    return decryptPendingWithWrap(pkg.wrapped, pkg.salt, inviteToken.value);
  }

  /**
   * Validate the loaded file's familyId, then move into member-pick.
   * Handles `FILE_FAMILY_MISMATCH` and `NO_UNCLAIMED_MEMBERS`.
   */
  /**
   * The LOCAL-file counterpart of the three Drive routes above.
   *
   * ⚠️ The local path used to skip the invite redemption ENTIRELY. `JoinPodView` loaded the
   * file and opened a PASSWORD modal on both `success` and `needsPassword`, so a joiner
   * holding a perfectly valid invite was asked for a password instead of having their
   * invite redeemed — and a family born since 0.13R2 has no `wrappedKeys` at all, so that
   * modal could never succeed for them. The invite IS the credential.
   *
   * With no token this is not a join at all. Joining is only ever via an invite link;
   * anyone else holding this family's file is signing in, which is a different surface.
   */
  async function handleLocalFileLoaded(): Promise<void> {
    currentStep.value = 'loading';
    if (!inviteToken.value) {
      recordError('INVITE_TOKEN_INVALID');
      return;
    }
    if (syncStore.pendingEncryptedFile) {
      const ok = await tryInviteTokenDecrypt();
      if (!ok) return; // error already recorded by tryInviteTokenDecrypt
    }
    advanceAfterFileLoaded();
  }

  function advanceAfterFileLoaded(): void {
    const loadedFamilyId =
      syncStore.envelope?.familyId ?? familyContextStore.activeFamilyId ?? null;
    if (targetFamilyId.value && loadedFamilyId && loadedFamilyId !== targetFamilyId.value) {
      recordError('FILE_FAMILY_MISMATCH', {
        expected: targetFamilyId.value,
        actual: loadedFamilyId,
      });
      return;
    }

    // Phase 4 device link: the pod is open — the view hands off to the standard
    // login machine, which serves EVERY member (PIN / tap-through prove), not just
    // unclaimed ones. The claim flow below structurally cannot serve a claimed member.
    if (linkMode.value) {
      clearError();
      // ⚠️ NO `emitJoinCompleted()` HERE, AND THE ATTEMPT TO ADD ONE WAS WRONG. A previous
      // round noticed this path had no success event and put one here — but `link-ready` is
      // where the file DECRYPTS, not where anyone joins: it hands off to the standard login
      // machine, which still has to show the person picker and prove a PIN. Counting it as a
      // completed join means the denominator reports success for everyone who abandons at the
      // picker, fails the PIN, or closes the tab, which is worse than having no denominator:
      // the rate would look healthy during exactly the failure it exists to surface. It also
      // cleared the needs-pick loop counter early, disarming the escalation for a link that
      // had not finished.
      //
      // The device-link population therefore still has NO success denominator. Recorded in
      // docs/STATUS.md rather than papered over — the event belongs wherever the login machine
      // confirms a member, which is outside this composable.
      currentStep.value = 'link-ready';
      return;
    }

    if (unclaimedMembers.value.length === 0) {
      recordError('NO_UNCLAIMED_MEMBERS');
      return;
    }

    clearError();
    currentStep.value = 'pick-member';
  }

  /**
   * The full cloud join sequence, kicked off either from `init()` (when
   * a silent token is already available) or from `handleAuthTap()` (when
   * the user explicitly taps the CTA).
   */
  async function runCloudFlow(triggeredByGesture: boolean): Promise<void> {
    currentStep.value = 'loading';

    // 1. Try silent direct-load by fileId, if applicable.
    const autoResult = await tryAutoLoadByFileId();

    if (autoResult === 'loaded') {
      // File read OK — try invite-token decrypt.
      if (syncStore.pendingEncryptedFile && inviteToken.value) {
        const ok = await tryInviteTokenDecrypt();
        if (!ok && !currentError.value) {
          // No invite token, or token didn't match: caller should show
          // the password modal. Step stays as 'loading' until the view
          // shows the modal; once the user decrypts via password, the
          // view calls the password-submit handler (below) which advances.
          currentStep.value = 'loading'; // unchanged but explicit
          return;
        }
        if (!ok) return; // error already set
        advanceAfterFileLoaded();
        return;
      }
      // Already decrypted (no pending) — just advance.
      advanceAfterFileLoaded();
      return;
    }

    if (autoResult === 'error') return; // FILE_READ_FAILED already set

    // 'auth' or 'needs-pick' — both require an interactive Picker tap.
    if (!triggeredByGesture) {
      // We were called from init() without a user gesture (e.g. a fresh load on a
      // redirect-auth-completed session). Defer to the user's explicit CTA tap so popups aren't
      // blocked.
      //
      // ⚠️ `autoResult` is the reason, and carrying it is what makes this screen legible. A
      // redirect return lands here with 'needs-pick' — the joiner has consented and now needs to
      // pick the file. Before, that was indistinguishable from the very first page load.
      enterAwaiting(autoResult === 'needs-pick' ? 'needs-pick' : 'initial');
      return;
    }

    currentStep.value = 'authenticating';
    // ⚠️ NO `forceConsent` HERE, AND THAT DELETION IS THE WHOLE BUG FIX.
    //
    // This used to read `const forceConsent = autoResult === 'needs-pick'`, on the theory that a
    // 404 from the silent token was "strong proof the cached account is wrong". On a FIRST JOIN
    // that theory is simply false: the joiner has never picked the file, so their fresh
    // `drive.file` grant cannot reach the INVITER's file by construction. 404 is the expected
    // state, not evidence of a wrong account — and no amount of re-consenting fixes it. Only the
    // Picker can, because under `drive.file` the Picker selection IS the access grant.
    //
    // What that mistaken diagnosis cost: forcing an interactive grant skips the silent-token fast path
    // (`usePickBeanpodFile.ts`), so `token` is null, so on a redirect-auth platform
    // (iOS/iPadOS/PWA/native) `startRedirectAuth` fires and the page navigates away. The call
    // returns before the Picker ever opens; the user comes back, `init()` runs, 404 again,
    // 'needs-pick' again, tap again — a closed loop that emitted nothing and paged nobody. Two
    // iPhone users hit it in production before it was reported by hand.
    //
    // Safe because `'needs-pick'` is only reachable WITH a live silent token: `tryAutoLoadByFileId`
    // returns `'auth'` when the token is falsy. So the silent path here is guaranteed to find that
    // token and go straight to the Picker.
    //
    // `handleSignInDifferent` passes `chooseAccount: true` — that is the ONE place the account
    // chooser is genuinely wanted, and the awaiting-auth block now offers it as a recovery.
    //
    // ⚠️ `chooseAccount`, NOT the old `forceConsent`. They read as synonyms and are opposites:
    // `forceConsent` maps to `prompt=consent`, which re-asks permission on the account already
    // signed in and SUPPRESSES the chooser. A joiner stuck on the wrong Google account could tap
    // "sign in with a different account" and be handed the same account back, forever.
    const picked = await doPickAndLoad(false);
    if (!picked) return; // cancel, redirect, or file-read-error — no advance

    // File loaded; reflect that in the step before any decrypt-stage
    // failures fire. Without this update, INVITE_TOKEN_INVALID would
    // appear in the diagnostic blob with step='authenticating', which
    // is misleading — the auth + file read succeeded, only the
    // invite-key match failed.
    currentStep.value = 'loading';

    if (syncStore.pendingEncryptedFile && inviteToken.value) {
      const ok = await tryInviteTokenDecrypt();
      if (!ok) return; // either error set or password modal needed
    }

    advanceAfterFileLoaded();
  }

  // ─── Intent handlers (called by view) ─────────────────────────────────────

  /** Primary CTA: "Choose your data file". */
  async function handleAuthTap(): Promise<void> {
    clearError();
    lastFailedAction = handleAuthTap;
    if (targetProvider.value !== 'google_drive') {
      // Local provider — view shows drop zone; nothing to do here.
      return;
    }
    await runCloudFlow(true);
  }

  /** "Sign in with a different Google account" recovery. */
  async function handleSignInDifferent(): Promise<void> {
    clearError();
    lastFailedAction = handleSignInDifferent;
    currentStep.value = 'authenticating';
    const picked = await doPickAndLoad(/* chooseAccount */ true);
    if (!picked) return;
    currentStep.value = 'loading';
    if (syncStore.pendingEncryptedFile && inviteToken.value) {
      const ok = await tryInviteTokenDecrypt();
      if (!ok) return;
    }
    advanceAfterFileLoaded();
  }

  /** Re-fire whichever step set the last error. */
  async function handleRetry(): Promise<void> {
    if (lastFailedAction) {
      const action = lastFailedAction;
      clearError();
      await action();
    }
  }

  /** User picks a bean to claim. */
  function handleSelectMember(member: FamilyMember): void {
    selectedMember.value = member;
    clearError();
    currentStep.value = 'set-pin';
  }

  /**
   * Final commit (Phase 4): claim the bean with a 6-digit PIN — doc-side hash +
   * this device's unlock wrap (both inside `authStore.joinFamily`). NO envelope
   * wrap is created any more (the old password `wrapFamilyKeyForMember` call is
   * retired — no new password wraps, ever); cross-device access thereafter is
   * the PIN on an opened device, a device link, the kit, or the passphrase.
   * Returns true on success.
   */
  async function handleSubmitPin(pin: string): Promise<boolean> {
    if (!selectedMember.value) return false;
    currentStep.value = 'joining';
    const ok = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const result = await authStore.joinFamily({
        memberId: selectedMember.value!.id,
        pin,
        familyId: familyContextStore.activeFamilyId ?? targetFamilyId.value,
      });
      if (!result.success) throw new Error(result.error ?? 'Join failed');
      // ⚠️ NO PUBLISH HERE. It used to `await syncStore.syncNow(true)` to persist the PIN
      // hash, and then the magic-link mint ~200ms later published the ENTIRE pod a second
      // time. The second upload queued behind the first on syncService's save mutex, which
      // is how a 5s link-publish budget expired before its upload had even started, and why
      // a joiner on a perfectly good connection was told "your link wasn't saved".
      //
      // The mint below stages its wrap in the envelope and then runs ONE publish that
      // carries both. The fallback after `mintJoinerMagicLink` covers the case where that
      // publish never happens, so the claim is never left to the autosave timer alone.
      return true;
    });
    if (!ok) {
      // Step regresses so the user can retry from the same form.
      //
      // NOTE a publish failure is NOT the claim bug: `joinFamily` succeeded, so this
      // person really is in the pod on this device, and the claim converges to the shared file
      // on the next save. Rolling it back would sign them out of a join that worked. The
      // rollback that matters lives inside `joinFamily`, for a failure DURING the claim.
      currentStep.value = 'set-pin';
      return false;
    }
    // The denominator. Without it the firehose can count failed joins but never the rate.
    emitJoinCompleted();

    // ⚠️ THE ONE MOMENT THE JOINER CAN EVER SEE THEIR LINK. The token is never persisted,
    // so if it is not shown now it is gone — minted and destroyed in the same tick, a dead
    // entry in the envelope and a member with no saved way back in. Hence a step rather
    // than a toast.
    const published = await mintJoinerMagicLink(selectedMember.value.id);
    if (!published) {
      // The mint's publish is what carries the PIN hash to the file as well. If it never
      // ran (the mint threw before staging) or did not confirm, push once more rather than
      // leaving the claim to the autosave timer. Best-effort by design: the person is
      // already a member on this device either way, so this must not block the step.
      // Outcome recorded, not discarded: this is the write that carries the joiner's PIN
      // hash to the family file. If it fails the claim is local-only, the inviter still
      // sees the bean unclaimed, and without this event the firehose cannot tell us how
      // often that happens. Emitted on BOTH arms so the rate is measurable, per the
      // observability rule.
      void syncStore.syncNowBounded().then((ok) =>
        logEvent({
          level: ok ? 'info' : 'warn',
          surface: 'join-flow',
          message: 'join claim fallback publish',
          context: { action: 'join_claim_fallback', error_code: ok ? undefined : 'not-saved' },
        })
      );
    }
    currentStep.value = 'link-saved';
    return true;
  }

  /** The joiner's magic link, shown once on the `link-saved` step. */
  const joinerMagicLink = ref('');
  /** A `uiStrings` key when the mint failed. The step degrades; it never blocks. */
  const joinerMagicLinkErrorKey = ref('');

  /**
   * Mint the joiner's link. BEST-EFFORT, for the same reason the creation step is: this
   * runs AFTER `joinFamily` has already committed, so a failure here must not strand
   * someone who is, at this point, genuinely a member of the family. They reach the app
   * with their PIN exactly as before, plus a pointer to Settings.
   */
  async function mintJoinerMagicLink(memberId: string): Promise<boolean> {
    joinerMagicLink.value = '';
    joinerMagicLinkErrorKey.value = '';
    try {
      // ⚠️ The JOIN budget explicitly, not the default. This step's whole job is to hand
      // over the link and there is nothing behind it, so it can afford to wait; the
      // creation and Settings mints deliberately cannot. That is why `linkMint` takes
      // the timeout as a parameter rather than owning a constant.
      const result = await mintMagicLink({
        memberId,
        publishTimeoutMs: syncStore.CREDENTIAL_PUBLISH_TIMEOUT_MS,
      });
      if ('errorKey' in result) {
        joinerMagicLinkErrorKey.value = 'magicLink.mintFailed';
        emitLinkMinted({
          kind: 'magic',
          ok: false,
          errorCode: result.errorCode,
          detail: 'origin=join',
        });
        if (result.errorCode === 'publish-failed') {
          reportError({
            surface: 'login-flow',
            message: 'joiner magic link never reached the durable file',
            severity: 'critical',
            context: { action: 'publish_failed', kind: 'magic' },
          });
        }
        return false;
      }
      joinerMagicLink.value = result.link;
      emitLinkMinted({ kind: 'magic', ok: true, detail: 'origin=join' });
      return true;
    } catch (e) {
      joinerMagicLinkErrorKey.value = 'magicLink.mintFailed';
      emitLinkMinted({ kind: 'magic', ok: false, errorCode: 'mint-threw', detail: 'origin=join' });
      reportError({
        surface: 'login-flow',
        message: 'joiner magic link mint threw; continuing without it',
        severity: 'error',
        error: e,
        context: { action: 'mint_threw', kind: 'magic' },
      });
      return false;
    }
  }

  /** The joiner confirmed they saved it — drop the link and hand off. */
  function handleMagicLinkSaved(): void {
    joinerMagicLink.value = '';
  }

  // ─── View-side modal toggle for the "Continue on another device" recovery ──
  const showShareFallback = ref(false);
  function handleTryAnotherDevice(): void {
    showShareFallback.value = true;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init(): Promise<void> {
    // ⚠️ THE RETURN VALUE IS LOAD-BEARING. `parseUrl` records its own error for the one
    // case it can name (`ml=1` with no `m=`); its OTHER false case is `parseInviteLink`
    // rejecting the URL outright, and that was silent. A bare `/join` visit is also
    // false, and correctly falls through to the instructions screen — so the two were
    // indistinguishable, and someone who tapped a TRUNCATED link (chat apps wrap long
    // URLs; this is expected input, not an edge case) got the generic "how to join" card
    // with nothing to act on and nothing in the firehose.
    if (!parseUrl() && !currentError.value) {
      // `route.query`, not a hand-split of `fullPath` — the manual version mis-slices when
      // a hash follows the query, and this is the parsed source the rest of the app uses.
      // Any of these means the URL was TRYING to be an invite. Absent them, it is a bare
      // visit and the instructions screen is the right answer.
      const looksLikeInvite = ['fam', 't', 'fid', 'fileId', 'ml', 'm', 'lk'].some(
        (k) => route.query[k] !== undefined
      );
      if (looksLikeInvite) recordError('INVITE_LINK_UNPARSEABLE');
    }

    // ⚠️ Google sent them back with an error — record it. `OAUTH_SCOPE_DENIED` was a declared
    // code that NOTHING in the app ever emitted, so declining the consent prompt (by far the
    // commonest of these) was invisible: no error for the user, no event in the firehose, and
    // until the companion fix in `OAuthCallbackPage` the invite URL was discarded too. A
    // registry entry nothing emits is a lie about coverage.
    // Read from `route.fullPath`, the same source `parseUrl` uses — not `window.location`, so
    // this works identically under the router, in tests, and after a redirect return.
    const authError = new URLSearchParams(route.fullPath.split('?')[1] ?? '').get('authError');
    if (authError) {
      // ⚠️ STRIP IT FIRST, and this is a bug fix rather than tidiness. `authError` rides the
      // invite URL, which is the link the joiner has in their messages and will tap again. Left
      // in place it short-circuits THIS branch on every subsequent visit — including the visit
      // right after they grant consent successfully — so one declined prompt poisoned the link
      // permanently and no later success could ever be redeemed. Replace, not push, so the back
      // button does not walk them into the poisoned URL again.
      await router
        .replace({ path: route.path, query: { ...route.query, authError: undefined } })
        .catch(() => {
          // A redundant-navigation rejection is not a failure worth surfacing; the error below
          // is what the joiner needs to see either way.
        });

      // ⚠️ AND GIVE `retry` SOMETHING TO DO. `OAUTH_SCOPE_DENIED` declares exactly one
      // recovery — `retry` — and `handleRetry` re-fires `lastFailedAction`, which on this path
      // had never been assigned: the button rendered, did nothing, and left the only offered way
      // forward as a dead control on the one screen where the person is already stuck.
      lastFailedAction = handleAuthTap;

      // ⚠️ LOOK THE FAMILY UP FIRST, AND ENTER A STEP THAT RENDERS. Returning straight from
      // here left two things broken that the error card cannot survive:
      //
      //  · `recordError` only assigns `currentError`. Nothing moved `currentStep` off `'lookup'`,
      //    so the view kept the "looking up your family…" subtitle forever and the whole
      //    `awaiting-auth` block never mounted — including the CTA and the brand-new "sign in
      //    with a different account" escape hatch, which is the one recovery that helps here.
      //  · `parseUrl` defaults `targetProvider` to `'local'` when the invite carries no `p=`
      //    (older links do not). `performLookup` is what corrects that from the registry, so
      //    skipping it left `handleAuthTap` returning immediately at its provider check — the
      //    retry button we just armed would have done nothing, which is the very defect the
      //    arming was added to fix. It also left `registryEntry` null, so the "family found"
      //    confirmation and the expected file name vanished from the card.
      if (targetFamilyId.value) await performLookup();
      enterAwaiting('cancelled');

      // ⚠️ NOT EVERY GOOGLE ERROR IS A DECLINE. `OAuthCallbackPage` forwards whatever Google
      // sent — `access_denied`, `server_error`, `temporarily_unavailable`, `invalid_scope`,
      // `interaction_required` — and collapsing all of them into `OAUTH_SCOPE_DENIED` told a
      // joiner hitting a Google outage, or a real console misconfiguration, to "try again and
      // allow Drive access", then filed it as a deliberately de-paged `warning`. A provider
      // outage and a user changing their mind became the same event in the UI and in
      // CloudWatch.
      //
      // ⚠️ AND THE VALUE RIDES `message`, NOT `reason`. `reason` is not in
      // `ALLOWED_CONTEXT_KEYS`, so it was stripped before reaching the firehose — the one
      // discriminating datum, dropped. `recordError` builds its Slack detail from
      // `context.message`, which is why the sibling call in `doPickAndLoad` uses that key.
      const DECLINES = ['access_denied', 'consent_required', 'interaction_required'];
      const code = DECLINES.includes(authError) ? 'OAUTH_SCOPE_DENIED' : 'OAUTH_REDIRECT_FAILED';
      recordError(code, { message: authError });
      return;
    }
    if (!targetFamilyId.value) {
      // No URL params — view shows the "how to join" instructions.
      enterAwaiting('initial');
      return;
    }
    await consumePendingRedirectAuth();
    await performLookup();

    if (targetProvider.value === 'google_drive') {
      // Try a silent auto-load; if it can't, defer to user gesture.
      await runCloudFlow(false);
    } else {
      // Local provider — wait for drop-zone interaction.
      enterAwaiting('initial');
    }
  }

  return {
    // init (called from the view's onMounted)
    init,
    // state
    currentStep,
    awaitingReason,
    // ⚠️ Exported so `JoinPodView.handleBack` stops writing `currentStep.value` directly. The
    // reason must travel with every entry to that step, and a required argument is the only way
    // to guarantee it.
    enterAwaiting,
    currentError,
    targetFamilyId,
    targetProvider,
    targetFileId,
    targetFileName,
    inviteToken,
    // Exposed for the URL-contract test in useJoinFlow.test.ts. The contract — that the
    // invite token stays in the address bar because the OAuth returnPath is built from it
    // — has no other observable seam, and it is worth a test rather than a comment: the
    // bug it guards against broke every redirect-auth platform and looked exactly like a
    // different bug that had just been fixed.
    parseUrl,
    inviteEmailHint,
    registryEntry,
    selectedMember,
    showShareFallback,
    // computed
    expectedFileName,
    unclaimedMembers,
    currentInviteUrl,
    // actions
    handleAuthTap,
    handleSignInDifferent,
    handleRetry,
    handleLocalFileLoaded,
    handleSelectMember,
    handleSubmitPin,
    linkMode,
    magicLinkMemberId,
    joinerMagicLink,
    joinerMagicLinkErrorKey,
    handleMagicLinkSaved,
    handleTryAnotherDevice,
    clearError,
    // diagnostics
    buildDiagnosticReport,
  };
}
