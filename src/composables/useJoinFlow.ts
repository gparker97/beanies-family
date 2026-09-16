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
import type { StructuredErrorEntry } from '@/utils/structuredError';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember, RegistryEntry } from '@/types/models';
import { emitDeviceLinkRedeemed } from '@/services/telemetry/loginFlowEvents';

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
  | 'redirecting'; // we just navigated them to Google; this page is going away

export type JoinStep =
  | 'lookup' // parsing URL, registry lookup, post-redirect-auth probe
  | 'awaiting-auth' // user must tap "Choose your data file"
  | 'authenticating' // OAuth in flight (popup or redirect)
  | 'loading' // file fetch / Picker / decrypt / familyId validate
  | 'pick-member' // unclaimed-member grid
  | 'set-pin' // the invitee chooses their 6-digit PIN
  | 'link-ready' // Phase 4 device link: pod open — hand off to the standard login machine
  | 'joining'; // final commit

export type JoinErrorCode =
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_POPUP_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_FAILED'
  | 'PICKER_UNAVAILABLE'
  | 'PICKER_AUTH_FAILED'
  | 'PICKER_TIMEOUT'
  | 'FILE_READ_FAILED'
  | 'FILE_DECRYPT_FAILED'
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
        file_id_tail: targetFileId.value || undefined,
        invite_token_tail: inviteToken.value || undefined,
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
  function parseUrl(): void {
    const url = `${window.location.origin}${route.fullPath}`;
    const parsed = parseInviteLink(url);
    if (!parsed) return;
    targetFamilyId.value = parsed.familyId;
    targetProvider.value = parsed.provider ?? 'local';
    targetFileName.value = parsed.fileName ?? '';
    targetFileId.value = parsed.fileId ?? '';
    inviteToken.value = parsed.token ?? '';
    inviteEmailHint.value = parsed.inviteeEmail ?? null;
    linkMode.value = parsed.linkMode === true;
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
  async function tryAutoLoadByFileId(): Promise<'loaded' | 'needs-pick' | 'auth' | 'error'> {
    if (targetProvider.value !== 'google_drive' || !targetFileId.value) {
      return 'auth';
    }
    const silent = await tryGetSilentToken();
    if (!silent) return 'auth';

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
    if (result.status === 404 || result.status === 403) return 'needs-pick';

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
   *   - `failed/open` or `failed/auth` or `failed/iframe` →
   *     `PICKER_FAILED` (picker reachable but wouldn't render)
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
    iframe: 'PICKER_FAILED',
  } as const satisfies Record<PickFailureReason, JoinErrorCode>;

  async function doPickAndLoad(chooseAccount = false): Promise<boolean> {
    const picked = await pickBeanpod({
      chooseAccount,
      loginHint: inviteEmailHint.value ?? undefined,
    });

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
        return false;

      case 'picked':
        break;

      default:
        return assertNever(picked, 'unhandled pick result');
    }

    targetFileId.value = picked.fileId;
    targetFileName.value = picked.fileName;

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
   * Try to decrypt the pending V4 file using the cached invite token.
   * Returns true if decryption succeeded; false if a password modal is
   * needed instead (no invite token, or the token isn't recognized).
   * Sets `INVITE_TOKEN_EXPIRED` / `INVITE_TOKEN_INVALID` /
   * `FILE_DECRYPT_FAILED` as appropriate.
   */
  async function tryInviteTokenDecrypt(): Promise<boolean> {
    if (!inviteToken.value) return false;
    const pending = syncStore.pendingEncryptedFile;
    if (!pending?.envelope?.inviteKeys) return false;

    const tokenHash = await hashInviteToken(inviteToken.value);
    const pkg = pending.envelope.inviteKeys[tokenHash];

    if (!pkg) {
      // R2-F15: the redeem failure arm must reach the firehose for device links —
      // "minted with no matching redeem" is otherwise untriageable.
      if (linkMode.value) emitDeviceLinkRedeemed(false, 'token-invalid');
      recordError('INVITE_TOKEN_INVALID');
      return false;
    }
    if (isInviteExpired(pkg.expiresAt)) {
      if (linkMode.value) emitDeviceLinkRedeemed(false, 'token-expired');
      recordError('INVITE_TOKEN_EXPIRED', { expiresAt: pkg.expiresAt });
      return false;
    }

    const decrypted = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const fk = await redeemInviteToken(pkg.wrapped, pkg.salt, inviteToken.value);
      const result = await syncStore.decryptPendingFileWithKey(fk);
      if (!result.success) throw asJoinDecryptError(result);
      return true;
    });

    if (!decrypted && linkMode.value) emitDeviceLinkRedeemed(false, 'decrypt-failed');
    return decrypted ?? false;
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
      // ⚠️ THE DENOMINATOR APPLIES HERE TOO. `emitJoinCompleted` had exactly one call site,
      // on the claim path, so the whole device-link population produced failure events and no
      // successes — a failure count with no denominator, which cannot tell a broken release
      // from a busy week. Worse, the `needs-pick` loop counter is cleared inside it, so a
      // device link that reached the Picker once left the counter set: the NEXT join in the
      // same tab logged its first, entirely normal `needs-pick` arrival at `warn` and looked
      // like a loop.
      emitJoinCompleted();
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
      // Persist the PIN hash to the file before handing off.
      await syncStore.syncNow(true);
      return true;
    });
    if (!ok) {
      // Step regresses so the user can retry from the same form.
      //
      // NOTE a `syncNow` failure here is NOT the claim bug: `joinFamily` succeeded, so this
      // person really is in the pod on this device, and the claim converges to the shared file
      // on the next save. Rolling it back would sign them out of a join that worked. The
      // rollback that matters lives inside `joinFamily`, for a failure DURING the claim.
      currentStep.value = 'set-pin';
      return false;
    }
    // The denominator. Without it the firehose can count failed joins but never the rate.
    emitJoinCompleted();
    return true;
  }

  // ─── View-side modal toggle for the "Continue on another device" recovery ──
  const showShareFallback = ref(false);
  function handleTryAnotherDevice(): void {
    showShareFallback.value = true;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init(): Promise<void> {
    parseUrl();

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
      recordError('OAUTH_SCOPE_DENIED', { reason: authError });
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
    handleTryAnotherDevice,
    clearError,
    // diagnostics
    buildDiagnosticReport,
  };
}
