import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { hashPassword, verifyPassword } from '@/services/auth/passwordService';
import {
  registerPasskeyForMember,
  authenticateWithPasskey,
  resolveDeviceKeys,
  MEMBER_MISMATCH,
  WRONG_FAMILY_CREDENTIAL,
  type RegisterPasskeyResult,
} from '@/services/auth/passkeyService';
import { isChildMember } from '@/services/auth/proveMethods';
import {
  seal as sealSession,
  open as openSession,
  type SealResult,
} from '@/services/auth/sessionSeal';
import type { FamilyMember, PasskeyRegistration, PasskeySecret } from '@/types/models';
import { bufferToBase64 } from '@/utils/encoding';
import { getRegistryDatabase, isStorageBlockedError } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import {
  deleteFamilyDatabase,
  getActiveFamilyId as getActiveFamilyIdFromDb,
} from '@/services/indexeddb/database';
import { saveNow, cancelPendingSave } from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { clearGoogleSessionState, getGoogleAccountEmail } from '@/services/google/googleAuth';
import { clearDriveConnectionForAccount } from '@/services/google/driveTokenRecovery';
import { clearLastGoogleAccount } from '@/services/sync/fileHandleStore';
import { clearFolderCache } from '@/services/google/driveService';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { emitSignoutTier } from '@/services/telemetry/loginFlowEvents';
import {
  runSignOutSteps,
  SIGN_OUT_TRUSTED_STEPS,
  SIGN_OUT_UNTRUSTED_STEPS,
  SIGN_OUT_CLEAR_STEPS,
  type SignOutStepImpls,
} from '@/services/auth/signOutSteps';
import type { WrappedMemberKey } from '@/types/syncFileV4';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from './translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { track } from '@/services/analytics/plausible';

/**
 * Sentinel `passwordHash` for an owner created in deferred-password mode
 * (`signUp({ deferPassword: true })`). The unified create-a-family flow
 * collects the password ONCE on the post-connect finish surface (after
 * storage is connected), not at step 1 — so step-1 `signUp` builds the owner
 * with this empty sentinel and the real hash is applied later by
 * `rehydrateOwnerDoc`. Exported so `syncStore.createNewFile`'s fail-closed
 * precondition references the SAME constant (single source of truth): a pod
 * whose owner still carries this sentinel must never be written.
 *
 * NOTE: `familyMemberRepository.applyDefaults` DERIVES `requiresPassword`
 * from `!passwordHash` on every read, so an owner with this sentinel reads as
 * `requiresPassword: true` until `rehydrateOwnerDoc` sets a real hash — at
 * which point every read flips it back to `false` automatically. Verified
 * safe pre-pod: the only consumer, `familyStore.normalizeRoles`, only elects
 * an owner when `owners.length === 0`, and our owner keeps `role: 'owner'`.
 *
 * ⚠️ THREE LOCKSTEP INVARIANTS — keep all three in sync or a pod can ship with
 * an owner who can never authenticate. Phase 4 (login rethink): the deferred
 * credential is now the owner's PIN — the owner NEVER gets a passwordHash (it
 * stays this sentinel permanently; `requiresPassword` derives from
 * "no passwordHash AND no pinHash", so a PIN-only owner reads as claimed):
 *   1. `signUp({ deferPassword: true })` builds the owner with this sentinel
 *      and NO pinHash, and does no hashing/key derivation.
 *   2. `rehydrateOwnerDoc` MUST NOT early-return while the owner has no
 *      `pinHash` — it applies the real PIN hash (in place on desktop, via a
 *      rebuild on iOS). Early-returning only on a REAL pinHash is the guard.
 *   3. `syncStore.createNewFile`'s fail-closed precondition refuses to write a
 *      pod whose resolved owner has no `pinHash` (the envelope's only wrap at
 *      creation is the recovery kit's — the PIN is the owner's identity +
 *      device-unlock credential, never an envelope wrap).
 *
 * FUTURE: the cleaner design is to not create the owner member at all until the
 * password is known — pre-generate `memberId` in `signUp`, create the owner via
 * `createMemberWithId` on the finish surface — which removes this sentinel, the
 * fail-closed guard, and the rehydrate special-case together. Deferred (2026-06-26):
 * it's an auth-layer refactor touching `signUp`'s contract, the registry
 * mapping, the iOS rehydrate path, and the "🫘 started" ping ordering — too
 * high-blast-radius for a flow that can't yet be iOS device-tested. Revisit once
 * iOS is verified on a real device.
 */
export const DEFERRED_PASSWORD_HASH = '';

// ─── Password-rotation shared helper ─────────────────────────────────────
// `rotateMemberPassword` is the single source of truth for the four-step
// "re-wrap envelope, hash, updateMember, sync" sequence. All three flows
// (changePassword, resetMemberPassword, signIn self-heal) delegate to it.
// The discriminated-union return type forces each caller to check `success`
// before reading any other field.
// ─────────────────────────────────────────────────────────────────────────

export type RotateError =
  | 'familyKeyMissing'
  | 'wrapFailed'
  | 'updateFailed'
  | 'saveFailed'
  | 'noConnection'
  | 'rollbackFailed';
export type RotateResult = { success: true } | { success: false; error: RotateError };

export type RotateSurface = 'change-password' | 'reset-member-password' | 'signin-heal';

/**
 * Closed union of every reason `resetMemberPassword` can fail. Adding a
 * new failure mode requires updating this type AND every caller's mapping
 * — compile-time enforcement of the no-silent-failures contract.
 */
export type ResetError =
  | RotateError
  | 'notAuthenticated'
  | 'memberNotFound'
  | 'cannotResetSelf'
  | 'isPet'
  | 'cannotResetOwner'
  | 'notAuthorized';

/**
 * The three pre-mutation credential pieces captured so a rotation can be
 * FULLY undone. `wrappedKeyEntry` is the member's prior envelope wrapped-key
 * (or `undefined` when the member had no entry — a first-time password set,
 * whose rollback must REMOVE the freshly-added entry). `requiresPassword` is
 * derived from `!passwordHash` on every read, so restoring `passwordHash`
 * alone already restores it — we capture it only for the explicit restore call.
 */
interface RotationSnapshot {
  wrappedKeyEntry: WrappedMemberKey | undefined;
  passwordHash: string;
  requiresPassword: boolean;
}

async function rotateMemberPassword(
  memberId: string,
  newPassword: string,
  surface: RotateSurface
): Promise<RotateResult> {
  // Lazy import to avoid the syncStore ↔ authStore circular dependency
  // (established pattern — see other lazy imports below).
  const { useSyncStore } = await import('@/stores/syncStore');
  const syncStore = useSyncStore();
  const familyStore = useFamilyStore();
  const memberIdTail = memberId.slice(-8);
  if (!syncStore.familyKey) {
    reportError({
      surface,
      message: 'familyKey not loaded — cannot wrap',
      severity: 'warning',
      context: { member_id_tail: memberIdTail },
    });
    return { success: false, error: 'familyKeyMissing' };
  }

  // Early offline gate (user surfaces only): if a durable save is CONFIDENTLY
  // impossible (no write provider, or a cloud provider while the browser is
  // offline), block BEFORE mutating anything and tell the user plainly. This
  // avoids the scary rollback+critical-page+~24s-wait path for the common offline
  // case. signin-heal is best-effort and never blocks — it skips this gate.
  if (surface !== 'signin-heal' && !syncStore.canDurablySaveNow()) {
    logEvent({
      level: 'info',
      surface,
      message: 'rotation blocked — no durable save target',
      context: { member_id_tail: memberIdTail, action: 'rotation-blocked-offline' },
    });
    return { success: false, error: 'noConnection' };
  }

  // Capture-before-mutate: snapshot the exact pre-change credential state so a
  // failed durable save can restore it byte-for-byte (transactional rotation).
  const member = familyStore.members.find((m) => m.id === memberId);
  const old: RotationSnapshot = {
    wrappedKeyEntry: syncStore.envelope?.wrappedKeys?.[memberId],
    passwordHash: member?.passwordHash ?? '',
    requiresPassword: member?.requiresPassword ?? true,
  };

  // Single-sourced, fully-guarded rollback used by both undo sites (updateFailed +
  // save-fail), so they can never drift. Returns true only if the pre-change state
  // was fully restored. `wrapOnly` reverts just the envelope wrapped key (the
  // updateFailed case, where passwordHash never changed). A failed rollback is
  // genuinely data-at-risk (the local doc may still hold the NEW hash) → critical.
  async function restoreCredential(opts?: { wrapOnly?: boolean }): Promise<boolean> {
    try {
      // setMemberWrappedKey(id, undefined) DELETES the entry — correct when the
      // member had no prior one (first-time set), else restores the old entry.
      // This is the only call that can throw (mid-flight envelope-clear).
      await syncStore.setMemberWrappedKey(memberId, old.wrappedKeyEntry);
      if (!opts?.wrapOnly) {
        const restored = await familyStore.updateMember(memberId, {
          passwordHash: old.passwordHash,
          requiresPassword: old.requiresPassword,
        });
        if (!restored) {
          // local hash NOT reverted — new hash may persist (data-at-risk).
          reportError({
            surface,
            message: 'rollback hash-restore returned null — credential may be half-rotated',
            severity: 'critical',
            context: {
              member_id_tail: memberIdTail,
              action: 'rotation-rollback-failed',
              error_code: 'update-null',
            },
          });
          return false;
        }
      }
      return true;
    } catch (e) {
      reportError({
        surface,
        message: 'rollback threw — credential may be half-rotated',
        severity: 'critical',
        error: e,
        context: { member_id_tail: memberIdTail, action: 'rotation-rollback-failed' },
      });
      return false;
    }
  }

  try {
    await syncStore.wrapFamilyKeyForMember(memberId, newPassword);
  } catch (e) {
    reportError({
      surface,
      message: 'wrapFamilyKeyForMember threw',
      error: e,
      context: { member_id_tail: memberIdTail },
    });
    return { success: false, error: 'wrapFailed' };
  }

  const newHash = await hashPassword(newPassword);
  const updated = await familyStore.updateMember(memberId, {
    passwordHash: newHash,
    requiresPassword: false,
  });
  if (!updated) {
    // Wrap succeeded but the passwordHash write failed — roll back the wrap so
    // no half-rotated envelope (new wrapped key + old hash) ever persists.
    const rolledBack = await restoreCredential({ wrapOnly: true });
    if (!rolledBack) {
      // critical already logged inside restoreCredential.
      return { success: false, error: 'rollbackFailed' };
    }
    reportError({
      surface,
      message: 'updateMember returned null after wrap succeeded — wrap rolled back',
      severity: 'error',
      context: {
        member_id_tail: memberIdTail,
        action: 'rotation-rolled-back',
        error_code: 'update-failed',
      },
    });
    return { success: false, error: 'updateFailed' };
  }

  // ── Durable save vs best-effort, by surface ──────────────────────────────
  // signin-heal re-wraps with the CURRENT password (no old/new split-brain) and
  // must never block or fail sign-in — keep its best-effort resolve-and-proceed
  // 5s bound. NO rollback, NO error surface (regressing this would re-introduce
  // the 0.9.5R3/R4 spinner-freeze class). The caller discards the result.
  if (surface === 'signin-heal') {
    const synced = await syncStore.syncNowBounded();
    logEvent({
      level: 'info',
      surface,
      message: 'signin-heal rotation save (best-effort)',
      context: {
        member_id_tail: memberIdTail,
        action: synced ? 'rotation-saved' : 'rotation-deferred',
      },
    });
    return { success: true };
  }

  // User-initiated change/reset: block on the REAL Drive save (~12s). The
  // three-state outcome distinguishes a clean failure (nothing reached Drive)
  // from a timeout (the non-cancellable write may still land) — the whole reason
  // we don't use syncNowBounded here. A post-write reject maps to 'saved' inside
  // syncNowDurable (the credential is durable; only the metadata write failed).
  const outcome = await syncStore.syncNowDurable(syncStore.DURABLE_ROTATION_SAVE_TIMEOUT_MS);
  if (outcome === 'saved') {
    logEvent({
      level: 'info',
      surface,
      message: 'rotation saved durably',
      context: { member_id_tail: memberIdTail, action: 'rotation-saved' },
    });
    return { success: true };
  }

  // Not saved → fully restore the pre-change credential (all three pieces). A
  // rollback that can't complete is itself data-at-risk (critical logged inside).
  const restored = await restoreCredential();
  if (!restored) {
    return { success: false, error: 'rollbackFailed' };
  }
  reportError({
    surface,
    message: 'password rotation rolled back — durable save did not confirm',
    severity: 'warning',
    context: {
      member_id_tail: memberIdTail,
      action: 'rotation-rolled-back',
      error_code: outcome, // 'failed' | 'timeout'
    },
  });

  // Convergence re-save ONLY on timeout (the non-cancellable write may have
  // landed). It serializes the rolled-back (old-password) state BEHIND any stray
  // in-flight upload via syncService's save() mutex, so Drive converges back to
  // the old password. On a clean 'failed' nothing reached Drive, so no
  // convergence + no critical is needed. Reuses syncNowDurable so a post-write
  // metadata reject here maps to 'saved' (Drive converged) rather than firing a
  // false page. If this re-save doesn't confirm 'saved', Drive may hold the new
  // password while local is old (a cross-device lockout window) — the one
  // data-at-risk case that pages.
  if (outcome === 'timeout') {
    const converged = await syncStore.syncNowDurable(syncStore.DURABLE_ROTATION_SAVE_TIMEOUT_MS);
    if (converged !== 'saved') {
      reportError({
        surface,
        message:
          'rollback re-save did not confirm after a timed-out durable save — Drive may hold the new password while local reverted (possible cross-device lockout window)',
        severity: 'critical',
        context: {
          member_id_tail: memberIdTail,
          action: 'rotation-resave-failed',
          error_code: converged,
        },
      });
    }
  }
  return { success: false, error: 'saveFailed' };
}

/**
 * Self-heal stale `envelope.wrappedKeys[memberId]` on successful password
 * sign-in. Fires whenever a member authenticates via password (PickBean or
 * welcome-gate auto-sign-in). Compares the just-verified password against
 * the envelope's wrappedKey entry; if missing or unwrappable with a
 * different password, re-wraps and pushes.
 *
 * Defense-in-depth for the envelope-merge corruption mode: once the merge
 * fixes ship, fresh corruption stops; this heal cleans up any
 * already-corrupted pod the next time the affected member signs in. Safe
 * because `verifyPassword` has already proven the caller is the legitimate
 * member.
 *
 * Never throws to the caller — every failure mode is surfaced via banner
 * (sync), toast (defensive crash), or `reportError` (all paths). Sign-in
 * proceeds regardless.
 */
async function healStaleWrappedKey(memberId: string, password: string): Promise<void> {
  try {
    const { useSyncStore } = await import('@/stores/syncStore');
    const { unwrapWrappedKey } = await import('@/services/sync/fileSync');
    const syncStore = useSyncStore();
    const env = syncStore.envelope;
    if (!env || !syncStore.familyKey) return; // passkey / cache-only sign-in — no password-shaped repair possible
    const entry = env.wrappedKeys?.[memberId];
    if (entry && (await unwrapWrappedKey(entry, password))) return; // fresh — no heal needed

    console.warn(
      `[authStore.signIn] stale wrappedKey for ${memberId} — re-wrapping; symptom of envelope-merge corruption, verify replaceEnvelope/preserveLocalKeyDicts are deployed`
    );
    await rotateMemberPassword(memberId, password, 'signin-heal');
    // rotateMemberPassword reports its own failures via reportError;
    // SaveFailureBanner surfaces sync issues to the user. Nothing further.
  } catch (e) {
    // Should be unreachable — every internal call has its own catch. Loud-fail
    // required so this never silently regresses.
    const translationStore = useTranslationStore();
    showToast(
      'error',
      translationStore.t('auth.signinHeal.unexpectedError'),
      translationStore.t('auth.signinHeal.unexpectedErrorHint'),
      { surface: 'auth-signin-heal' }
    );
    console.error('[authStore.signIn] healStaleWrappedKey threw unexpectedly:', e);
  }
}

/**
 * Why a persisted session was rejected. Defined here because `invalidateSession` is the
 * one place a session dies; `familyStore` imports it with `import type` so the vocabulary
 * has a single definition without a runtime dependency. (#80)
 */
export type SessionRejectionKind =
  | 'malformed'
  | 'bad-signature'
  | 'key-changed'
  | 'unknown-member'
  /** The pod file was swapped for another family's — expected, not an integrity event. */
  | 'roster-switched'
  /** The member deliberately removed their own bean — expected, not an integrity event. */
  | 'self-removed';

/**
 * The kinds that mean "somebody edited a session", as opposed to the routine ways a
 * session can stop naming a real member. Only these are worth a `reportError`; folding the
 * routine ones in would make the tamper metric unusable.
 */
const INTEGRITY_REJECTIONS: ReadonlySet<SessionRejectionKind> = new Set([
  'malformed',
  'bad-signature',
  'unknown-member',
]);

export interface AuthUser {
  memberId: string;
  email: string;
  familyId?: string;
  role?: string;
  /**
   * Cached display name, persisted with the session so the resume-setup
   * recovery screen can pre-fill the owner-name field with what the user
   * actually typed during signUp — instead of guessing from the email's
   * local part. Stale once the user renames themselves, so always prefer
   * `familyStore.members.find(...)?.name` when the doc is loaded; this is
   * a fallback for the pre-doc-load window.
   */
  displayName?: string;
}

const SESSION_KEY = 'beanies_auth_session';

// Whether the authenticated user's `.beanpod` file actually exists yet.
// `signUp()` creates the session *before* storage is chosen (step 2 of the
// create-pod wizard), so "authenticated" alone doesn't mean "has a pod" — a
// half-finished onboarding (or a failed Drive connect) leaves an authenticated
// session with no pod file. This flag is the discriminator the router guard +
// App.vue use to route such users to the resume-setup recovery screen instead
// of an empty `/nook`. Persisted (per-browser) so it survives reload and the
// iOS full-page-redirect round-trip.
//
// Semantics: `'1'` → pod exists; `'0'` → pod pending (set the moment `signUp`
// succeeds, cleared once `syncStore.createNewFile` writes the file); ABSENT →
// treated as "pod exists" (migration: users who created a pod before this flag
// existed, and the moment of `signIn`/`joinFamily` into an already-built pod).
const POD_CREATED_KEY = 'beanies_pod_created';

/**
 * Bumped by every `clearSession()`. `persistSession` captures it before awaiting the
 * seal and refuses to write if it moved, so a sign-out can never be undone by an
 * in-flight seal. This is what makes the three SYNCHRONOUS call sites
 * (`createSessionForVerifiedMember`, `updateCurrentUserRole`,
 * `updateSessionWithMemberData`) safe to leave fire-and-forget rather than rippling an
 * `async` signature change through familyStore and useBiometricSignIn (#80).
 */
let sessionGeneration = 0;
/**
 * Monotonic per-write ticket. The generation counter above orders writes against CLEARS;
 * this orders writes against each other. Two fire-and-forget callers share a generation
 * but seal via independent `crypto.subtle.sign` promises, so without this an older payload
 * could resolve last and persist a stale role (e.g. a post-transfer role update overtaken
 * by an earlier session write).
 */
let sessionWriteSeq = 0;
let lastCommittedWrite = 0;

/**
 * Persist the session, sealed (#80).
 *
 * NEVER REJECTS — by contract, not by luck. Three callers invoke this from synchronous
 * store actions and cannot `await` it; a rejecting promise would surface as an unhandled
 * rejection, and `no-floating-promises` is not enabled to catch it.
 */
async function persistSession(
  user: AuthUser,
  opts: { keepStoredOnFailure?: boolean } = {}
): Promise<void> {
  const generation = sessionGeneration;
  const ticket = ++sessionWriteSeq;
  try {
    const sealed = await sealSession(user);
    if (sealed === null) {
      // No device key (private browsing, blocked IndexedDB). Degrades exactly as before,
      // but is now COUNTED: without this a browser with working localStorage and blocked
      // IndexedDB would sign users out on every reload with no trace anywhere.
      logEvent({
        level: 'warn',
        surface: 'session-integrity',
        message: 'session_seal_unavailable',
        context: { action: 'session_rejected', kind: 'unavailable' },
      });
      // Drop the stored session rather than leaving it. MOST callers write to CHANGE the
      // session, and one of them (`updateCurrentUserRole`) writes to DOWNGRADE a role. The
      // previous envelope is sealed with the same still-valid device key, so returning
      // early leaves it authoritative and the next boot restores the ex-owner AS owner.
      // Signing out is the safe failure; silently keeping the higher privilege is not.
      //
      // `keepStoredOnFailure` is the one exception, and it inverts the reasoning rather
      // than waiving it: `confirmSessionMember` re-seals a payload that is ALREADY the
      // stored one, so there is no stale higher privilege to strand. `open()` serves a
      // bare legacy session without ever needing the device key, so boot can succeed
      // while the registry IndexedDB is momentarily unavailable — and dropping here
      // signed a returning user out on the next reload for a write that changed nothing
      // (#80 review). The caller cannot catch it either; persistSession is `void`-ed.
      if (!opts.keepStoredOnFailure) dropStoredSession();
      return;
    }
    // The session was cleared while we were sealing — do not resurrect it.
    if (generation !== sessionGeneration) return;
    // A newer write already landed — do not overwrite it with our older payload.
    if (ticket < lastCommittedWrite) return;
    lastCommittedWrite = ticket;
    localStorage.setItem(SESSION_KEY, sealed);
  } catch (e) {
    // Same reasoning as the unavailable branch, including its one exception: a write that
    // did not land must not leave the previous, higher-privilege envelope behind — unless
    // this write was an optional re-seal of that very envelope.
    if (!opts.keepStoredOnFailure) dropStoredSession();
    logEvent({
      level: 'warn',
      surface: 'session-integrity',
      message: 'session_persist_failed',
      context: { action: 'session_rejected', kind: 'persist-failed' },
      error: e,
    });
  }
}

/**
 * Remove the stored session without bumping the generation.
 *
 * Distinct from `clearSession`: this is the failure tail of a WRITE, so it must not
 * invalidate concurrent in-flight writes the way a real sign-out does.
 */
function dropStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing further to try — localStorage is gone in both directions.
  }
}

function clearSession(): void {
  sessionGeneration += 1;
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(POD_CREATED_KEY);
  } catch {
    // silent fail
  }
}

/**
 * Read the persisted session. Returns the full `SealResult` so the caller can act on
 * WHY it failed — flattening it to `null` would erase the difference between tampering
 * and an evicted registry.
 */
async function restoreSession(): Promise<SealResult | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  return openSession(raw);
}

/** Read the persisted "pod file exists" flag. Absent ⇒ true (see above). */
function restorePodCreated(): boolean {
  try {
    return localStorage.getItem(POD_CREATED_KEY) !== '0';
  } catch {
    return true;
  }
}

function persistPodCreated(value: boolean): void {
  try {
    localStorage.setItem(POD_CREATED_KEY, value ? '1' : '0');
  } catch {
    // localStorage unavailable — the in-memory ref still reflects reality for
    // this tab; only the cross-reload signal is lost (private-mode users hit
    // every other persistence limitation too).
  }
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const isInitialized = ref(false);
  /**
   * A persisted session was rejected for integrity reasons this page load (#80). Blocks
   * familyStore's owner fallback, which would otherwise resurrect the escalation.
   */
  const sessionRejected = ref(false);
  /**
   * The restored session came from an UNSEALED pre-#80 blob, so nothing about it has been
   * verified yet. Cleared by `confirmSessionMember` once the roster vouches for it.
   */
  const sessionIsLegacy = ref(false);
  const isAuthenticated = ref(false);
  const hasFamilies = ref(false);
  const currentUser = ref<AuthUser | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const freshSignIn = ref(false);
  // Newsletter opt-in captured during signUp; read by syncStore when
  // registering the family so the choice is forwarded to the registry.
  const newsletterOptIn = ref<boolean | null>(null);
  // Whether the authenticated user's `.beanpod` file exists yet — see
  // POD_CREATED_KEY above. Routing guard reads this; `signUp` clears it;
  // `syncStore.createNewFile` (via `markPodCreated`) sets it.
  const podCreated = ref(restorePodCreated());

  /**
   * Record that the session has a real `.beanpod` (drives `needsPodSetup` and
   * the onboarding-zombie routing). Idempotent + cheap.
   *
   * CONTRACT — call this at EVERY terminus that successfully creates OR reads a
   * pod, so `podCreated` tracks reality rather than relying on key-absence. A
   * loader that forgets it strands the user on the create-recovery screen and
   * false-fires `app.onboardingZombieState`. Current callers (all in syncStore):
   *   1. createNewFile (create)              — the point of no return
   *   2. completeAutoLoad (registry resume)  — password recovery
   *   3. decryptPendingFileWithKey (join/invite cached-key decrypt)
   *   4. loadFromFile (decrypt-with-current-FK success)
   *   5. loadFromPersistenceCache (cache hit, both permission branches)
   * `syncStore.podCreatedTermini.test.ts` asserts each public loader marks on
   * success — a new loader added without the call fails that suite.
   */
  function markPodCreated(): void {
    podCreated.value = true;
    persistPodCreated(true);
  }

  // Getters
  const needsAuth = computed(() => !isAuthenticated.value);
  /**
   * Authenticated session whose `.beanpod` file does not exist yet — the
   * half-finished-onboarding ("zombie") state (signup done but storage not
   * chosen/written, or an iOS Drive OAuth redirect mid-flight). Single source
   * of truth for this condition, consumed by the router guards, App.vue boot,
   * the app-chrome layout helper, and LoginPage's self-rescue.
   */
  const needsPodSetup = computed(() => !needsAuth.value && !podCreated.value);
  const displayName = computed(() => {
    if (!currentUser.value) return '';
    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === currentUser.value?.memberId);
    // Truth wins (the loaded doc); session-cached `displayName` covers the
    // pre-doc-load window (e.g. the resume-setup recovery screen, where the
    // doc hasn't been rehydrated yet); email is the last-ditch fallback.
    return member?.name ?? currentUser.value.displayName ?? currentUser.value.email ?? '';
  });

  /**
   * Initialize auth on app startup.
   * Checks if a family exists in registry — if yes, auth happens after file load.
   */
  async function initializeAuth(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      // Check if any family exists in registry
      const db = await getRegistryDatabase();
      const families = await db.getAll('families');

      hasFamilies.value = families.length > 0;

      /**
       * ONE consumer of the seal result, shared by both restore sites below, so the
       * iOS-ITP path can never drift from the normal one. Returns whether a session was
       * adopted. (#80)
       */
      const adoptRestoredSession = async (result: SealResult | null): Promise<boolean> => {
        if (!result) return false;
        if (result.ok) {
          currentUser.value = result.user;
          isAuthenticated.value = true;
          sessionRejected.value = false;
          podCreated.value = restorePodCreated();
          // A legacy blob is UNVERIFIED — `open()` accepts any bare JSON object with a
          // string memberId, no signature checked. Sealing it here would HMAC a forgery
          // with the real device key and mint a permanently-valid session that outlives
          // LEGACY_SESSION_SUNSET, which is exactly the escalation the seal exists to
          // stop. The re-seal is deferred to `confirmSessionMember`, which familyStore
          // calls only once the loaded roster actually contains this member.
          sessionIsLegacy.value = result.legacy;
          return true;
        }
        // 'unavailable' is not a rejection: there is no key to verify WITH, so there is
        // nothing to accuse. persistSession already counted it.
        if (result.reason !== 'unavailable') invalidateSession(result.reason);
        return false;
      };

      if (families.length > 0) {
        // Try restoring a previous session (survives page refresh)
        await adoptRestoredSession(await restoreSession());
        isInitialized.value = true;
        return;
      }

      // No family in the LOCAL registry. Normally a brand-new user — BUT on iOS
      // Safari, ITP can evict the IndexedDB registry independently of the
      // localStorage session (~7-day partition). If a persisted session still
      // exists, this is a RETURNING user whose registry was evicted, not a new
      // one — restore the session so they land on the resume/recovery flow
      // (which re-loads their pod via the REMOTE registry) rather than being
      // dumped on the WelcomeGate as brand-new. Guarded so a restore failure can
      // never throw out of boot (a thrown boot is worse than a mis-route).
      try {
        const result = await restoreSession();
        const adopted = await adoptRestoredSession(result);
        if (adopted) {
          hasFamilies.value = true;
        } else if (result && !result.ok && result.reason !== 'unavailable') {
          // #80: the blob was present but unverifiable. It still proves a returning user
          // exists on this device, and that fact grants no authority, so record it — but
          // do NOT authenticate on it, which is what this branch used to do.
          //
          // Note `hasFamilies` has no consumer outside this store; the real user-visible
          // outcome of an evicted registry is WelcomeGate -> Sign In -> Drive chooser,
          // which finds their pod. One extra tap, on a path where their PIN wrap was
          // evicted too, so they had to re-prove regardless.
          hasFamilies.value = true;
        }
      } catch (e) {
        console.warn('[authStore] session restore on empty registry failed:', e);
        reportError({
          surface: 'authStore.initializeAuth.restoreOnEmptyRegistry',
          message: `Session restore on empty registry failed (falling back to WelcomeGate): ${e instanceof Error ? e.message : String(e)}`,
          error: e,
          severity: 'warning',
        });
      }
      isInitialized.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to initialize auth';
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign in with member selection and password.
   * Called after the data file is loaded and member is selected.
   */
  async function signIn(
    memberId: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);

      if (!member) {
        error.value = 'Member not found';
        return { success: false, error: error.value };
      }

      if (!member.passwordHash) {
        error.value = 'No password set for this member';
        return { success: false, error: error.value };
      }

      const valid = await verifyPassword(password, member.passwordHash);
      if (!valid) {
        error.value = 'Incorrect password';
        return { success: false, error: error.value };
      }

      // Self-heal any drifted envelope.wrappedKeys[memberId] using the
      // just-verified password. Never throws to us — every failure surfaces
      // via banner/toast/reportError inside the helper. Awaited so the next
      // cold sign-in (which only has the envelope to go on) works the first
      // time, not the second.
      await healStaleWrappedKey(memberId, password);

      const familyContextStore = useFamilyContextStore();

      const user: AuthUser = {
        memberId: member.id,
        email: member.email,
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      familyStore.setCurrentMember(member.id);

      // Track last login timestamp
      const now = toISODateString(new Date());
      familyStore.updateMember(member.id, { lastLoginAt: now });
      track('login', { props: { method: 'password' } });

      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Sign in failed';
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  /** Closed vocabulary for `signInPasswordless`'s refusal telemetry — kept tight so the
   * `kind` dimension in CloudWatch cannot sprawl as guards are added. */
  type PasswordlessRefusal = 'not-found' | 'credentialed' | 'adult';

  /**
   * Tap-through sign-in for a CHILD with NO credential, on an already-open pod
   * (2026-08-28 login rethink — the prove engine's 'tap-through' method; today's
   * passwordless kids). Fail-closed guards: the member must exist in the LOADED doc,
   * must genuinely have no hash, and must be a child — a credentialed member and an
   * unclaimed adult can never enter this way, and a closed pod has no roster to check
   * against so it refuses too. Mirrors `signIn`'s session tail exactly (one drift point
   * fewer than a hand-rolled copy in a view).
   *
   * This is defence in depth, NOT the primary gate: the prove engine decides what to
   * OFFER, and this decides what to ALLOW, so a caller that bypasses the engine is
   * still refused. Both sides share ONE definition of "child" (`isChildMember`).
   */
  async function signInPasswordless(
    memberId: string
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;
    const translationStore = useTranslationStore();
    try {
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);

      /**
       * Every refusal, one shape: translated copy for the user (it reaches ProveView's
       * role=alert box) plus one `reportError` so the reason is greppable in CloudWatch.
       * Before this helper the two existing guards reported NOTHING, so a wrongly-refused
       * sign-in was invisible in production. A refusal is the system working, so
       * `warning` — never `critical`, which would page Slack for correct behaviour.
       */
      const refuse = (kind: PasswordlessRefusal, messageKey: UIStringKey) => {
        error.value = translationStore.t(messageKey);
        reportError({
          surface: 'login-flow',
          message: 'passwordless sign-in refused',
          severity: 'warning',
          context: { action: 'passwordless_refused', kind },
        });
        return { success: false, error: error.value };
      };

      // Guard order is load-bearing: not-found → credentialed → adult.
      if (!member) return refuse('not-found', 'auth.memberNotFound');
      if (member.passwordHash || member.pinHash) {
        // A credentialed member must prove — never tap through. "Credentialed" means
        // password OR PIN, matching the prove engine's definition (review F6: a
        // PIN-only member could previously be minted a session with zero proof via a
        // stale card or a sync race).
        return refuse('credentialed', 'auth.memberHasPassword');
      }
      if (!isChildMember(member)) {
        // #79: an unclaimed ADULT must be claimed out-of-band via a 24h invite, never by
        // whoever picks up the tablet while the pod happens to be open. Reaching here
        // means the engine was bypassed or a race occurred.
        return refuse('adult', 'auth.memberNeedsInvite');
      }

      const familyContextStore = useFamilyContextStore();
      const user: AuthUser = {
        memberId: member.id,
        email: member.email,
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      familyStore.setCurrentMember(member.id);

      const now = toISODateString(new Date());
      familyStore.updateMember(member.id, { lastLoginAt: now });
      track('login', { props: { method: 'tap-through' } });

      return { success: true };
    } catch (e) {
      // A throw here (blocked IndexedDB in private mode, a failed projection write)
      // must not be silent either: the refusal helper above covers the deliberate
      // rejections, this covers the unexpected ones. Translated, so a raw exception
      // string never lands in the prove screen's role=alert box.
      error.value = translationStore.t('auth.signInFailed');
      reportError({
        surface: 'login-flow',
        message: 'passwordless sign-in threw',
        error: e,
        severity: 'error',
        context: { action: 'passwordless_failed' },
      });
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * (Re)build the in-memory Automerge doc with just the owner member.
   *
   * Shared by `signUp` (fresh) and `rehydrateOwnerDoc` (recovery — a
   * full-page redirect during onboarding destroys the in-memory doc). When
   * `id` is given, the member is created with that exact id (rehydrate must
   * keep `currentUser.memberId` — and the `.beanpod` envelope's `wrappedKeys`
   * keyed by it — pointing at the recreated member). `gender: 'male'` and
   * `ageGroup: 'adult'` match `signUp`'s long-standing behavior (the role
   * picker in the wizard is cosmetic; the owner is always stored as an adult).
   */
  /**
   * Tear down ALL in-memory family state before building a fresh owner doc.
   *
   * ORDER IS LOAD-BEARING — do not reorder:
   *  1. `docClient.reset()` — drop the previous family's worker doc + family key
   *     + persist debounce, and reset the projection. With the key now null, any
   *     in-flight pre-pod `createMember` persist early-returns, so the new
   *     family's doc can never be written into the OLD family's encrypted cache
   *     (ADR-032 defect 2). Does NOT delete the old cache DB (correct — we don't
   *     delete another family's data; `createNewFile`'s `initAndLoadCache` later
   *     re-points the handle).
   *  2. `docClient.initDoc()` — fresh empty doc + empty projection.
   *  3. `familyStore.resetState()` — null the stale `currentMemberId` sentinel
   *     (`reloadAllStores` → `loadMembers` RESTORES, not nulls, `currentMemberId`;
   *     `createMember` + `setCurrentMember` set it fresh afterwards).
   *  4. `reloadAllStores()` — re-derive every entity store from the now-empty
   *     projection, clearing any previous family's rows still resident in the
   *     store `ref<T[]>` arrays (ADR-032 defect 1 — the cross-family mixing).
   *
   * Runs BEFORE `createMember`, so the owner write (which appends to the reactive
   * ref, with no later reload) survives. A cheap, safe no-op on the resume-after-
   * redirect path where the worker respawned fresh (keyless reset + empty-
   * projection reload). Dynamic `import('./syncStore')` matches the existing
   * cross-store pattern used in sign-out below.
   */
  async function resetInMemoryFamilyState(): Promise<void> {
    await docClient.reset();
    await docClient.initDoc();
    useFamilyStore().resetState();
    const { useSyncStore } = await import('./syncStore');
    await useSyncStore().reloadAllStores();
  }

  async function buildOwnerDoc(
    owner: {
      name: string;
      email: string;
      passwordHash: string;
      pinHash?: string;
      pinVersion?: number;
    },
    id?: string
  ) {
    // Tear down any previous family's in-memory state, then start a fresh doc.
    // Must run before any mutation (createMember writes to the worker doc).
    await resetInMemoryFamilyState();
    const familyStore = useFamilyStore();
    const memberInput = {
      name: owner.name,
      email: owner.email,
      gender: 'male' as const,
      ageGroup: 'adult' as const,
      role: 'owner' as const,
      color: '#3b82f6',
      passwordHash: owner.passwordHash,
      ...(owner.pinHash ? { pinHash: owner.pinHash, pinVersion: owner.pinVersion ?? 1 } : {}),
      requiresPassword: false,
    };
    const member = id
      ? await familyStore.createMemberWithId(id, memberInput)
      : await familyStore.createMember(memberInput);
    if (member) familyStore.setCurrentMember(member.id);
    // Leave onboarding incomplete so the money/savings onboarding wizard
    // shows on /nook. Lives in `buildOwnerDoc` (not `signUp` alone) so the
    // resume-setup path also restores it — the full-page Drive-OAuth redirect
    // destroys the in-memory doc, including the onboardingCompleted flag
    // `signUp` had written; without this re-set the wizard silently skips
    // for any user who finishes pod-creation via the recovery flow.
    const settingsStore = useSettingsStore();
    await settingsStore.setOnboardingCompleted(false);
    return member;
  }

  /**
   * Apply the owner's real credential — Phase 4: their 6-digit PIN — on the
   * create-finish surface (and rebuild the owner after a full-page redirect
   * destroyed the in-memory doc). The owner's `passwordHash` stays the deferred
   * sentinel PERMANENTLY (kit-born families are password-free); the PIN hash +
   * `pinVersion: 1` are what get applied. Re-uses the persisted session for the
   * immutable bits (memberId/email) and the caller-supplied name + PIN for the
   * rest. Requires an active session.
   *
   * Two paths:
   * - **Owner still in the doc** (desktop deferred-password hand-off — no reload
   *   between step-1 `signUp` and this call): stamp the real hash IN PLACE via
   *   `updateMember`. Do NOT rebuild the doc — `buildOwnerDoc` would `initDoc()`
   *   (a whole-doc reset), recreate the member, and redo step-1's onboarding
   *   settings write. That churn is wasted AND swaps the doc identity mid-create,
   *   which widened the `/nook` stale-`onboardingCompleted` projection window.
   *   The step-1 doc already holds name + `onboardingCompleted:false`; only the
   *   `passwordHash` (and possibly an edited name) changed.
   * - **Owner gone** (iOS Drive redirect reloaded the app → in-memory doc wiped):
   *   rebuild it from the persisted session via `buildOwnerDoc`.
   *
   * No-op short-circuit when the owner already holds a REAL `pinHash` (a genuine
   * recovery re-entry on the same session) — never while they have none, or the
   * fail-closed `createNewFile` guard would block the create.
   */
  async function rehydrateOwnerDoc(
    name: string,
    pin: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentUser.value) return { success: false, error: 'No active session to resume' };
    const familyStore = useFamilyStore();
    const existingOwner = familyStore.owner;
    if (existingOwner?.pinHash) {
      return { success: true };
    }
    try {
      const { isValidPin } = await import('@/services/auth/deviceUnlock');
      if (!isValidPin(pin)) {
        return { success: false, error: useTranslationStore().t('pin.invalidFormat') };
      }
      const pinHashValue = await hashPassword(pin);
      if (existingOwner) {
        // Desktop: owner present with no credential yet — set the PIN hash (and
        // any edited name) in place, preserving the rest of the step-1 doc.
        const updated = await familyStore.updateMember(existingOwner.id, {
          name,
          pinHash: pinHashValue,
          pinVersion: 1,
        });
        if (!updated) return { success: false, error: 'Failed to set owner PIN' };
        return { success: true };
      }
      // iOS: the redirect reloaded the app — rebuild the owner from scratch.
      const member = await buildOwnerDoc(
        {
          name,
          email: currentUser.value.email,
          passwordHash: DEFERRED_PASSWORD_HASH,
          pinHash: pinHashValue,
          pinVersion: 1,
        },
        currentUser.value.memberId
      );
      if (!member) return { success: false, error: 'Failed to rebuild owner member' };
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Failed to rebuild owner' };
    }
  }

  /**
   * Sign up: create a new family + owner member.
   * This is the owner-only "Create Pod" flow.
   *
   * Two modes, enforced by a discriminated union so they can never be mixed:
   * - **`deferPassword: true`** (the unified create flow): build the owner with
   *   the empty `DEFERRED_PASSWORD_HASH` sentinel; the real password is hashed
   *   later by `rehydrateOwnerDoc` on the post-connect finish surface. No
   *   `password` field is accepted in this mode.
   * - **`password` given** (legacy / non-deferred callers): hash it now, as
   *   before.
   *
   * Either way nothing here derives a key or writes the `.beanpod` — that's
   * `syncStore.createNewFile` on the finish surface (Phase 4: it generates the
   * recovery kit internally as the envelope's only wrap; no password anywhere).
   */
  async function signUp(
    params: {
      email: string;
      familyName: string;
      memberName: string;
      subscribeNewsletter?: boolean;
    } & ({ deferPassword: true; password?: never } | { deferPassword?: false; password: string })
  ): Promise<{ success: boolean; error?: string }> {
    // Idempotency guard: a session already exists (the user re-entered the
    // create flow — WelcomeGate→Create again, browser-back to /create, or any
    // future re-call). Re-running would mint a SECOND family via createFamily()
    // and orphan the first. Return success without side effects; do NOT re-set
    // `freshSignIn` — re-navigation is not a fresh sign-in. The primary guard
    // lives in CreatePodView.handleStep1Next (which also skips the duplicate
    // Slack ping + newsletter); this is the store-layer backstop.
    if (currentUser.value) return { success: true };

    isLoading.value = true;
    error.value = null;
    newsletterOptIn.value =
      typeof params.subscribeNewsletter === 'boolean' ? params.subscribeNewsletter : null;

    try {
      // Create the family
      const familyContextStore = useFamilyContextStore();
      const family = await familyContextStore.createFamily(params.familyName);

      if (!family) {
        return { success: false, error: 'Failed to create family' };
      }

      // Hash the password + build the owner doc. In deferred mode the owner
      // carries the empty sentinel; `rehydrateOwnerDoc` applies the real hash
      // on the finish surface (after storage connect).
      const passwordHashValue = params.deferPassword
        ? DEFERRED_PASSWORD_HASH
        : await hashPassword(params.password);
      const member = await buildOwnerDoc({
        name: params.memberName,
        email: params.email,
        passwordHash: passwordHashValue,
      });
      if (!member) {
        return { success: false, error: 'Failed to create owner member' };
      }

      // Create UserFamilyMapping in registry
      {
        const registryDb = await getRegistryDatabase();
        await registryDb.add('userFamilyMappings', {
          id: generateUUID(),
          email: params.email,
          familyId: family.id,
          memberId: member.id,
          lastActiveAt: toISODateString(new Date()),
        });
      }

      // (`setOnboardingCompleted(false)` is now inside `buildOwnerDoc` —
      // shared with the resume-setup path so the money-wizard shows there
      // too. signUp itself doesn't need to re-set it.)

      // Auto sign in. `displayName` is cached on the session for the
      // pre-doc-load window — the resume-setup recovery screen reads it
      // to pre-fill the owner-name field with what the user actually
      // typed here, instead of guessing from the email's local part.
      const user: AuthUser = {
        memberId: member.id,
        email: params.email,
        familyId: family.id,
        role: 'owner',
        displayName: params.memberName,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      // The session now exists but no `.beanpod` file does yet — that's
      // written later by `syncStore.createNewFile` (step 2 of the wizard).
      // Until then, the routing guard treats this as "resume setup", not
      // "ready for /nook".
      podCreated.value = false;
      persistPodCreated(false);
      track('signup');
      track('login', { props: { method: 'pin' } });

      return { success: true };
    } catch (e) {
      // iOS Safari Private Browsing (and Firefox private mode) block IndexedDB,
      // so the family/registry writes above throw. Surface a specific, actionable
      // message naming the real obstacle instead of a generic failure, and report
      // it so we can see how often onboarding is blocked this way.
      if (isStorageBlockedError(e)) {
        reportError({
          surface: 'authStore.signUp.storageBlocked',
          message: `signUp failed — storage blocked (likely Private Browsing): ${(e as Error).name}`,
          error: e,
          severity: 'warning',
        });
        const blockedMessage = useTranslationStore().t('auth.storageBlocked');
        error.value = blockedMessage;
        return { success: false, error: blockedMessage };
      }
      const message = e instanceof Error ? e.message : 'Sign up failed';
      error.value = message;
      return { success: false, error: message };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Change the current authenticated member's password.
   *
   * Verifies the current password, re-wraps the family key under the new
   * password (replacing the existing wrappedKeys[memberId] entry so the
   * old password can no longer unwrap), and updates the stored password
   * hash. Caller must pass both old and new — there is no admin path
   * to reset a forgotten password (by design: data is encrypted at rest
   * with no recovery key).
   */
  async function changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isAuthenticated.value || !currentUser.value) {
      return { success: false, error: 'Not authenticated' };
    }
    if (!newPassword) {
      return { success: false, error: 'New password is required' };
    }
    if (newPassword === currentPassword) {
      return { success: false, error: 'New password must be different from current' };
    }

    const familyStore = useFamilyStore();
    const memberId = currentUser.value.memberId;
    const member = familyStore.members.find((m) => m.id === memberId);
    if (!member?.passwordHash) {
      return { success: false, error: 'No current password set for this account' };
    }

    const valid = await verifyPassword(currentPassword, member.passwordHash);
    if (!valid) {
      return { success: false, error: 'Current password is incorrect' };
    }

    const result = await rotateMemberPassword(memberId, newPassword, 'change-password');
    if (!result.success) {
      // Map RotateError → user-facing copy for THIS surface. Each translation
      // is owned by the caller, so different surfaces (Settings vs. Family
      // page) can use different language. `result.error` is a closed union,
      // so this switch is exhaustive at compile time.
      const t = useTranslationStore().t;
      const errorMessages: Record<RotateError, string> = {
        familyKeyMissing: 'Could not load family key — please sign out and back in, then try again',
        wrapFailed: 'Failed to re-wrap your account key. Please try again.',
        // Now that updateFailed rolls back the wrap, nothing is saved — corrected
        // from the old "saved the new key locally" copy (English-only, in place).
        updateFailed: "Couldn't update your password. Nothing was changed. Please try again.",
        // The connection-dependent cases are routed through i18n (en + beanie +
        // zh). The two legacy strings above stay English-only (out of scope).
        saveFailed: t('changePassword.error.saveFailed'),
        noConnection: t('changePassword.error.noConnection'),
        rollbackFailed: t('changePassword.error.rollbackFailed'),
      };
      return { success: false, error: errorMessages[result.error] };
    }
    return { success: true };
  }

  /**
   * Admin/owner reset of another member's password. Closed `ResetError`
   * union forces callers to handle every authz reject + every RotateError
   * propagation at compile time. Caller is responsible for translating
   * error keys to user-facing copy.
   *
   * Security: no new attack surface — any user with `canManagePod`
   * (owner / admin) already has the family key in memory and can decrypt
   * the pod. Resetting another member's password is strictly less
   * destructive than the delete-member capability they already have.
   */
  /**
   * The SINGLE admin-reset authorization gate, shared by the password (legacy) and
   * PIN reset paths. Returns the refusal reason or null when allowed.
   * `BeanAccountPanel.vue` mirrors these conditions for its UI gating — keep them
   * in step with THIS helper.
   */
  function assertCanResetMember(targetMemberId: string): ResetError | null {
    if (!isAuthenticated.value || !currentUser.value) return 'notAuthenticated';
    if (targetMemberId === currentUser.value.memberId) return 'cannotResetSelf';
    const familyStore = useFamilyStore();
    const target = familyStore.members.find((m) => m.id === targetMemberId);
    if (!target) return 'memberNotFound';
    if (target.isPet) return 'isPet';
    if (target.role === 'owner') return 'cannotResetOwner';
    const me = familyStore.members.find((m) => m.id === currentUser.value!.memberId);
    if (!me?.canManagePod) return 'notAuthorized';
    return null;
  }

  async function resetMemberPassword(
    targetMemberId: string,
    newPassword: string
  ): Promise<{ success: true } | { success: false; error: ResetError }> {
    const refused = assertCanResetMember(targetMemberId);
    if (refused) {
      return { success: false, error: refused };
    }

    const result = await rotateMemberPassword(targetMemberId, newPassword, 'reset-member-password');
    if (!result.success) {
      return { success: false, error: result.error };
    }
    track('admin_password_reset');
    return { success: true };
  }

  // ── Member PIN (Phase 2 of the 2026-08-28 login rethink) ──────────────────
  // The PIN is the member's family-wide identity secret: its hash lives INSIDE the
  // encrypted doc (FamilyMember.pinHash — a file-only attacker never sees anything
  // guessable), and each set/change also (re-)wraps the family key for THIS device
  // via deviceUnlock so the PIN unlocks here. Envelope untouched: a PIN can never be
  // an envelope wrap (10⁶ offline guesses — see the plan's Decision 6).

  /**
   * Enrol THIS device's PIN unlock wrap for a member whose doc-side pinHash is
   * already set (review R2-F8: the create flow sets the owner's hash via
   * `rehydrateOwnerDoc` long before the pod/key exist, so the wrap has to be
   * enrolled AFTER `createNewFile` — without it the owner's own PIN cannot open
   * their pod cold and the kit becomes the only cold method). Verifies the PIN
   * against the doc hash first (fail-closed; never wraps on an unverified secret).
   * Non-fatal by contract: callers treat a failure as degraded, not broken.
   */
  async function enrollDevicePinWrapForMember(
    memberId: string,
    pin: string
  ): Promise<{ success: boolean }> {
    try {
      const { enrollPinUnlock } = await import('@/services/auth/deviceUnlock');
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);
      if (!member?.pinHash || !(await verifyPassword(pin, member.pinHash))) {
        return { success: false };
      }
      const { useSyncStore } = await import('./syncStore');
      const syncStore = useSyncStore();
      const familyContextStore = useFamilyContextStore();
      const familyId = familyContextStore.activeFamilyId;
      if (!syncStore.familyKey || !familyId) return { success: false };
      const enrolled = await enrollPinUnlock({
        familyId,
        member: { id: member.id, name: member.name, pinVersion: member.pinVersion ?? 1 },
        pin,
        familyKey: syncStore.familyKey,
        keyId: syncStore.envelope?.keyId ?? '',
      });
      if (!enrolled.success) {
        reportError({
          surface: 'login-flow',
          message: 'post-create owner PIN wrap enrolment failed',
          severity: 'warning',
          context: { action: 'enroll_owner_wrap_failed' },
        });
      }
      return { success: enrolled.success };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'enrollDevicePinWrapForMember threw',
        error: e,
        severity: 'warning',
        context: { action: 'enroll_owner_wrap_failed' },
      });
      return { success: false };
    }
  }

  /**
   * Set a member's PIN: doc-side hash + version bump, then this device's unlock wrap.
   * Guard: setting is allowed when the member has NO PIN yet, or when `currentPin`
   * verifies (a change). Fail-closed — never overwrites a hash it can't verify.
   */
  async function setMemberPin(
    memberId: string,
    pin: string,
    currentPin?: string
  ): Promise<{ success: boolean; error?: string }> {
    const translationStore = useTranslationStore();
    try {
      const { isValidPin, enrollPinUnlock } = await import('@/services/auth/deviceUnlock');
      if (!isValidPin(pin)) {
        return { success: false, error: translationStore.t('pin.invalidFormat') };
      }
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);
      if (!member) {
        return { success: false, error: translationStore.t('auth.memberNotFound') };
      }
      if (member.pinHash) {
        const okCurrent = currentPin ? await verifyPassword(currentPin, member.pinHash) : false;
        if (!okCurrent) {
          return { success: false, error: translationStore.t('pin.currentRequired') };
        }
      }

      const pinHash = await hashPassword(pin);
      const pinVersion = (member.pinVersion ?? 0) + 1;
      await familyStore.updateMember(memberId, { pinHash, pinVersion });

      // Device wrap: only possible while the pod is open (we hold the family key).
      const { useSyncStore } = await import('./syncStore');
      const syncStore = useSyncStore();
      const familyContextStore = useFamilyContextStore();
      const familyId = familyContextStore.activeFamilyId;
      if (syncStore.familyKey && familyId) {
        const enrolled = await enrollPinUnlock({
          familyId,
          member: { id: member.id, name: member.name, pinVersion },
          pin,
          familyKey: syncStore.familyKey,
          keyId: syncStore.envelope?.keyId ?? '',
        });
        if (!enrolled.success) {
          // The doc-side hash IS set (the PIN works family-wide); only this device's
          // fast-unlock wrap failed. Say so rather than pretending total failure.
          reportError({
            surface: 'login-flow',
            message: 'PIN set but device-unlock enrolment failed on this device',
            severity: 'warning',
            context: { action: 'enroll_after_set_failed' },
          });
        }
      }

      // Ride the next save; best-effort push so the doc-side hash reaches other devices.
      await syncStore.syncNowBounded();
      return { success: true };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'setMemberPin threw',
        error: e,
        severity: 'warning',
        context: { action: 'set_pin_failed' },
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : translationStore.t('auth.signInFailed'),
      };
    }
  }

  /**
   * Recovery-mode PIN reset (the kit/passphrase break-glass): set a NEW PIN for a member
   * with NO current-credential check, then sign them in. Authorization is possession of
   * the family-level recovery secret that just opened the pod — the holder already has
   * the family key (they can read everything), so gating this on the forgotten PIN would
   * protect nothing and would strand the family the kit exists to rescue. Callers MUST
   * only reach this from the recovery-mode prove screen.
   */
  /**
   * The ONE no-current-check "set this member's PIN" mutation body (validate →
   * hash → doc write → this device's unlock wrap). Shared by the recovery reset
   * (break-glass) and the admin reset (parents for kids) so there is exactly one
   * implementation. Authorization is the CALLER's job.
   */
  async function applyPinReset(
    memberId: string,
    newPin: string
  ): Promise<
    | { success: true; member: FamilyMember; pinVersion: number; familyId: string | null }
    | { success: false; error: string }
  > {
    const translationStore = useTranslationStore();
    const { isValidPin, enrollPinUnlock } = await import('@/services/auth/deviceUnlock');
    if (!isValidPin(newPin)) {
      return { success: false, error: translationStore.t('pin.invalidFormat') };
    }
    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === memberId);
    if (!member) {
      return { success: false, error: translationStore.t('auth.memberNotFound') };
    }

    const pinHash = await hashPassword(newPin);
    const pinVersion = (member.pinVersion ?? 0) + 1;
    await familyStore.updateMember(memberId, { pinHash, pinVersion });

    const { useSyncStore } = await import('./syncStore');
    const syncStore = useSyncStore();
    const familyContextStore = useFamilyContextStore();
    const familyId = familyContextStore.activeFamilyId;
    if (syncStore.familyKey && familyId) {
      const enrolled = await enrollPinUnlock({
        familyId,
        member: { id: member.id, name: member.name, pinVersion },
        pin: newPin,
        familyKey: syncStore.familyKey,
        keyId: syncStore.envelope?.keyId ?? '',
      });
      if (!enrolled.success) {
        // The doc-side hash IS set (the PIN works family-wide); only this device's
        // fast-unlock wrap failed — report, never silent (R2-F13).
        reportError({
          surface: 'login-flow',
          message: 'PIN reset set the doc hash but device-unlock enrolment failed',
          severity: 'warning',
          context: { action: 'enroll_after_reset_failed' },
        });
      }
    }
    return { success: true, member, pinVersion, familyId };
  }

  /**
   * Admin PIN reset (Phase 4 — replaces the admin password reset for PIN members):
   * an authenticated pod manager sets a member's NEW PIN with no current-PIN check.
   * Same trust model as the password reset it succeeds: the admin already holds the
   * family key. Gate + mutation are both shared single implementations
   * (`assertCanResetMember` + `applyPinReset`) — no third copy of either.
   */
  async function adminResetMemberPin(
    targetMemberId: string,
    newPin: string
  ): Promise<{ success: true } | { success: false; error: ResetError | string }> {
    const refused = assertCanResetMember(targetMemberId);
    if (refused) {
      return { success: false, error: refused };
    }
    try {
      const result = await applyPinReset(targetMemberId, newPin);
      if (!result.success) return result;
      // Review R2-F7: this surface REPLACED the admin password reset, and its use
      // case includes "I think their password is compromised". A legacy target's old
      // password must stop opening the pod — rotate their envelope wrap + hash to a
      // random secret nobody knows (full-entropy wrap = harmless leftover; the
      // member is PIN-first from here, per the Phase-4 model). Best-effort: the PIN
      // reset itself already succeeded; a rotation failure is reported, not fatal.
      if (result.member.passwordHash) {
        try {
          const randomSecret = bufferToBase64(
            crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer
          );
          const rotated = await rotateMemberPassword(
            targetMemberId,
            randomSecret,
            'reset-member-password'
          );
          if (!rotated.success) {
            reportError({
              surface: 'login-flow',
              message: 'admin PIN reset could not retire the legacy password wrap',
              severity: 'warning',
              context: { action: 'admin_reset_pw_retire_failed', detail: rotated.error },
            });
          }
        } catch (rotateErr) {
          reportError({
            surface: 'login-flow',
            message: 'admin PIN reset password retirement threw',
            error: rotateErr,
            severity: 'warning',
            context: { action: 'admin_reset_pw_retire_failed' },
          });
        }
      }
      const { useSyncStore } = await import('./syncStore');
      const pushed = await useSyncStore().syncNowBounded();
      if (!pushed) {
        // R2-F13: the deferred push must be visible in the firehose — other devices
        // keep the old PIN until the next successful save.
        logEvent({
          level: 'warn',
          surface: 'login-flow',
          message: 'admin_pin_reset push deferred — rides the next save',
          context: { action: 'admin_reset_push_deferred' },
        });
      }
      track('admin_password_reset');
      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'admin_pin_reset',
        context: { action: 'admin_reset', member_id_tail: targetMemberId.slice(-8) },
      });
      return { success: true };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'admin PIN reset failed',
        error: e,
        severity: 'warning',
        context: { action: 'admin_reset_failed' },
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : useTranslationStore().t('auth.signInFailed'),
      };
    }
  }

  async function resetMemberPinViaRecovery(
    memberId: string,
    newPin: string
  ): Promise<{ success: boolean; error?: string }> {
    const translationStore = useTranslationStore();
    try {
      const result = await applyPinReset(memberId, newPin);
      if (!result.success) return result;
      const { member, familyId } = result;
      const familyStore = useFamilyStore();
      const { useSyncStore } = await import('./syncStore');
      const syncStore = useSyncStore();

      // Session tail — mirrors signIn.
      const user: AuthUser = {
        memberId: member.id,
        email: member.email,
        familyId: familyId ?? undefined,
        role: member.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      familyStore.setCurrentMember(member.id);
      familyStore.updateMember(member.id, { lastLoginAt: toISODateString(new Date()) });
      track('login', { props: { method: 'recovery-reset' } });
      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'recovery_pin_reset',
        context: { action: 'reset', member_id_tail: memberId.slice(-8) },
      });
      await syncStore.syncNowBounded();
      return { success: true };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'recovery PIN reset failed',
        error: e,
        severity: 'warning',
        context: { action: 'recovery_reset_failed' },
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : translationStore.t('auth.signInFailed'),
      };
    }
  }

  /** Verify a PIN against the doc-side hash (identity check on an open pod). */
  async function verifyMemberPin(memberId: string, pin: string): Promise<boolean> {
    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === memberId);
    if (!member?.pinHash) return false;
    return verifyPassword(pin, member.pinHash);
  }

  /**
   * Sign a member in with their PIN on an OPEN pod (identity-only — the pod is already
   * decrypted; the device wrap covers the closed-pod case in the flow driver). Mirrors
   * signIn's session tail.
   */
  async function signInWithPin(
    memberId: string,
    pin: string
  ): Promise<{ success: boolean; error?: string }> {
    const translationStore = useTranslationStore();
    isLoading.value = true;
    error.value = null;
    try {
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);
      if (!member) {
        error.value = translationStore.t('auth.memberNotFound');
        return { success: false, error: error.value };
      }
      if (!member.pinHash) {
        error.value = translationStore.t('pin.notSet');
        return { success: false, error: error.value };
      }
      const valid = await verifyPassword(pin, member.pinHash);
      if (!valid) {
        error.value = translationStore.t('pin.incorrect');
        return { success: false, error: error.value };
      }

      const familyContextStore = useFamilyContextStore();
      const user: AuthUser = {
        memberId: member.id,
        email: member.email,
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      familyStore.setCurrentMember(member.id);
      familyStore.updateMember(member.id, { lastLoginAt: toISODateString(new Date()) });
      track('login', { props: { method: 'pin' } });
      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : translationStore.t('auth.signInFailed');
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  // ── Recovery kit + passphrase (Phase 3 of the 2026-08-28 login rethink) ────

  /**
   * Generate a recovery kit for the open pod: full-entropy code wrapped into the
   * envelope's `recoveryKeys`. Returns the one-time code for display — NEVER persisted.
   * Best-effort push; the wrap rides the next save either way (keyDictSize counts it).
   */
  async function createRecoveryKit(): Promise<
    { success: true; kitId: string; code: string } | { success: false; error: string }
  > {
    const translationStore = useTranslationStore();
    try {
      const { useSyncStore } = await import('./syncStore');
      const syncStore = useSyncStore();
      if (!syncStore.familyKey || !syncStore.envelope) {
        return { success: false, error: translationStore.t('recovery.podNotOpen') };
      }
      const { generateRecoveryKit } = await import('@/services/auth/recoveryKit');
      const kit = await generateRecoveryKit(syncStore.familyKey);
      syncStore.addRecoveryKey(kit.kitId, kit.pkg);
      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'kit_generated',
        context: { action: 'kit_generated' },
      });
      await syncStore.syncNowBounded();
      return { success: true, kitId: kit.kitId, code: kit.code };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'recovery kit generation failed',
        error: e,
        severity: 'warning',
        context: { action: 'kit_generate_failed' },
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : translationStore.t('auth.signInFailed'),
      };
    }
  }

  /**
   * Set (or replace) the family recovery passphrase: a strength-checked memorable
   * phrase wrapped into the envelope's own `recoveryPassphrase` field via the SAME
   * password machinery members use (deriveMemberKey → AES-KW). Never a `wrappedKeys`
   * entry — legacy clients would surface a phantom member (Pass-4 finding).
   */
  async function setRecoveryPassphrase(
    passphrase: string
  ): Promise<{ success: boolean; error?: string }> {
    const translationStore = useTranslationStore();
    try {
      const { useSyncStore } = await import('./syncStore');
      const syncStore = useSyncStore();
      if (!syncStore.familyKey || !syncStore.envelope) {
        return { success: false, error: translationStore.t('recovery.podNotOpen') };
      }
      // Trim FIRST (review F11): validation ran on the trimmed string while the wrap
      // derived from the raw one, so a stray trailing space made the recovery credential
      // permanently un-redeemable as the user knows it.
      passphrase = passphrase.trim();
      const { checkPassphrase } = await import('@/utils/passphraseStrength');
      const familyStore = useFamilyStore();
      const familyContextStore = useFamilyContextStore();
      const verdict = checkPassphrase(passphrase, {
        familyName: familyContextStore.activeFamilyName ?? undefined,
        memberNames: familyStore.members.map((m) => m.name),
      });
      if (!verdict.ok) {
        const key =
          verdict.reason === 'matches-name'
            ? 'recovery.passphraseMatchesName'
            : 'recovery.passphraseTooWeak';
        return { success: false, error: translationStore.t(key) };
      }

      const { deriveMemberKey, wrapFamilyKey, SALT_LENGTH } =
        await import('@/services/crypto/familyKeyService');
      const { bufferToBase64 } = await import('@/utils/encoding');
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const wrapKey = await deriveMemberKey(passphrase, salt);
      const wrapped = await wrapFamilyKey(syncStore.familyKey, wrapKey);
      syncStore.setRecoveryPassphraseWrap({
        salt: bufferToBase64(salt),
        wrapped,
        createdAt: toISODateString(new Date()),
      });
      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'recovery_passphrase_set',
        context: { action: 'passphrase_set' },
      });
      await syncStore.syncNowBounded();
      return { success: true };
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'recovery passphrase set failed',
        error: e,
        severity: 'warning',
        context: { action: 'passphrase_set_failed' },
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : translationStore.t('auth.signInFailed'),
      };
    }
  }

  /**
   * Join an existing family as a pre-created member.
   *
   * Phase 4 (login rethink): the claim credential is the member's 6-digit PIN —
   * doc-side hash + this device's unlock wrap. NO envelope wrap is created (the
   * old `wrapFamilyKeyForMember` password wrap is retired; cross-device access
   * thereafter = PIN on an opened device, a device link, the kit, or the
   * passphrase). Creates a UserFamilyMapping and marks onboarding complete.
   */
  async function joinFamily(params: {
    memberId: string;
    pin: string;
    familyId: string;
  }): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      // ONE set-PIN mutation body (R2-F13 DRY): validate → hash → doc write → this
      // device's unlock wrap, shared with the recovery and admin resets. The pod is
      // open at claim time (the invite/file was just decrypted), so the wrap enrols
      // here; a wrap failure is reported inside and is non-fatal.
      const pinResult = await applyPinReset(params.memberId, params.pin);
      if (!pinResult.success) return pinResult;
      const joiningMember = pinResult.member;

      // Sign the member in — the shared session shape (see `signIn`'s tail).
      const familyStoreForPin = useFamilyStore();
      const familyContextStoreForPin = useFamilyContextStore();
      const user: AuthUser = {
        memberId: params.memberId,
        email: joiningMember.email ?? '',
        familyId: familyContextStoreForPin.activeFamilyId ?? params.familyId,
        role: joiningMember.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      familyStoreForPin.setCurrentMember(params.memberId);

      // Create UserFamilyMapping in registry DB
      const familyStore = useFamilyStore();

      // Track last login timestamp for the newly joined member
      const now = toISODateString(new Date());
      await familyStore.updateMember(params.memberId, { lastLoginAt: now });

      const member = familyStore.members.find((m) => m.id === params.memberId);
      const registryDb = await getRegistryDatabase();
      await registryDb.add('userFamilyMappings', {
        id: generateUUID(),
        email: member?.email ?? '',
        familyId: params.familyId,
        memberId: params.memberId,
        lastActiveAt: toISODateString(new Date()),
      });

      // Mark onboarding as completed
      const settingsStore = useSettingsStore();
      await settingsStore.setOnboardingCompleted(true);
      track('member_joined');
      track('login', { props: { method: 'pin' } });

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to join family';
      error.value = message;
      return { success: false, error: message };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign in using a registered passkey (biometric).
   * Returns familyKey for file decryption if available via PRF or trusted device cache.
   */
  /**
   * Takes a params object rather than positionals: `memberId` is now required, and a
   * third positional argument on an auth entry point is how
   * `signInWithPasskey(familyId, undefined, memberId)` eventually gets written.
   */
  async function signInWithPasskey(params: {
    familyId: string;
    memberId: string;
    passkeySecrets?: PasskeySecret[];
  }): Promise<{
    success: boolean;
    cancelled?: boolean;
    memberId?: string;
    familyKey?: CryptoKey;
    credentialId?: string;
    error?: string;
  }> {
    const { familyId, memberId, passkeySecrets } = params;
    isLoading.value = true;
    error.value = null;

    try {
      const result = await authenticateWithPasskey({ familyId, memberId, passkeySecrets });
      if (!result.success || !result.memberId) {
        // Don't pollute `error.value` with a user-cancellation — keeps
        // any reactive UI bound to authStore.error from rendering an
        // error state for a deliberate dismiss gesture.
        if (!result.cancelled) {
          // MEMBER_MISMATCH / WRONG_FAMILY_CREDENTIAL are SENTINELS the caller branches
          // on, not copy. Assigning one to the store's user-facing `error` would put
          // untranslated machine text in a display field; the views map them to strings.
          const isSentinel =
            result.error === MEMBER_MISMATCH || result.error === WRONG_FAMILY_CREDENTIAL;
          error.value = isSentinel ? null : (result.error ?? 'Passkey authentication failed');
        }
        return {
          success: false,
          cancelled: result.cancelled,
          credentialId: result.credentialId,
          error: result.error,
        };
      }

      // The member data may not be loaded yet (file not decrypted),
      // so we create a session with just the memberId.
      // After file decryption, we'll have full member info.
      const user: AuthUser = {
        memberId: result.memberId,
        email: '', // Will be filled after file decryption
        familyId,
        role: undefined,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      sessionRejected.value = false;
      freshSignIn.value = true;
      await persistSession(user);
      track('login', { props: { method: 'passkey' } });

      return {
        success: true,
        memberId: result.memberId,
        familyKey: result.familyKey,
      };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Passkey sign in failed';
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Create a full session for a member already verified by passkey (cross-device flow).
   * Skips password verification — the passkey already authenticated the user.
   */
  function createSessionForVerifiedMember(memberId: string, familyId: string): void {
    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === memberId);
    const user: AuthUser = {
      memberId,
      email: member?.email ?? '',
      familyId,
      role: member?.role,
    };
    currentUser.value = user;
    isAuthenticated.value = true;
    freshSignIn.value = true;
    // A real sign-in clears the rejection, exactly as the other seven sign-in sites do.
    // Without it a member who was rejected earlier this page load, then signed in with a
    // passkey, stayed blocked from familyStore's owner fallback for the rest of the load.
    sessionRejected.value = false;
    // Fire-and-forget by design (#80): this action is SYNCHRONOUS and is called
    // synchronously from familyStore / useBiometricSignIn. persistSession never
    // rejects, and the generation counter makes ordering safe, so an await here
    // would only ripple an async signature through two other modules.
    void persistSession(user);
    if (member) {
      familyStore.setCurrentMember(member.id);
      familyStore.updateMember(member.id, { lastLoginAt: toISODateString(new Date()) });
    }
    track('login', { props: { method: 'cross_device' } });
  }

  /**
   * Update the role on the current session (used by ownership transfer).
   * Mutates currentUser.value.role and re-persists the session so a
   * page reload picks up the new role.
   */
  function updateCurrentUserRole(role: 'owner' | 'admin' | 'member'): void {
    if (!currentUser.value) return;
    currentUser.value = { ...currentUser.value, role };
    // Fire-and-forget by design (#80): this action is SYNCHRONOUS and is called
    // synchronously from familyStore / useBiometricSignIn. persistSession never
    // rejects, and the generation counter makes ordering safe, so an await here
    // would only ripple an async signature through two other modules.
    void persistSession(currentUser.value);
  }

  /**
   * After file decryption, update the auth session with full member data.
   */
  function updateSessionWithMemberData(): void {
    if (!currentUser.value) return;

    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === currentUser.value?.memberId);
    if (member) {
      currentUser.value = {
        ...currentUser.value,
        email: member.email,
        role: member.role,
      };
      // Fire-and-forget by design (#80): this action is SYNCHRONOUS and is called
      // synchronously from familyStore / useBiometricSignIn. persistSession never
      // rejects, and the generation counter makes ordering safe, so an await here
      // would only ripple an async signature through two other modules.
      void persistSession(currentUser.value);
      familyStore.setCurrentMember(member.id);

      // Track last login timestamp
      const now = toISODateString(new Date());
      familyStore.updateMember(member.id, { lastLoginAt: now });
    }
  }

  /**
   * Register a passkey for the current user.
   * Uses the active family key from the sync store.
   */
  async function registerPasskeyForCurrentUser(label?: string): Promise<RegisterPasskeyResult> {
    if (!currentUser.value) {
      return { success: false, error: 'Not signed in' };
    }

    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === currentUser.value?.memberId);
    if (!member) {
      return { success: false, error: 'Member not found' };
    }

    // Get family key from sync store
    const { useSyncStore } = await import('./syncStore');
    const syncStore = useSyncStore();
    if (!syncStore.familyKey) {
      return { success: false, error: 'No family key available — data file must be loaded' };
    }

    return registerPasskeyForMember({
      memberId: member.id,
      memberName: member.name,
      memberEmail: member.email,
      familyId: currentUser.value.familyId ?? '',
      familyKey: syncStore.familyKey,
      label,
    });
  }

  /**
   * WHICH members this device can sign in for a family — the store-level seam the views
   * use, so no view imports the passkey service directly (MVO) and tests have one place
   * to stub. Replaces the old `checkHasRegisteredPasskeys` boolean: every caller of that
   * needed the list, not the count.
   */
  async function resolveDeviceKeysForFamily(familyId: string): Promise<PasskeyRegistration[]> {
    return resolveDeviceKeys(familyId);
  }

  /**
   * Tier 1 — "Switch person" (Phase 5 of the 2026-08-28 rethink): clear the MEMBER
   * session only. The decrypted doc, family key, sync state, and Google tokens are all
   * untouched — the next screen is the person picker (LoginPage's boot sees an open pod
   * and enters the machine), and the target member proves with their PIN/biometric.
   * No teardown of any kind; deliberately tiny.
   */
  function switchMember(): void {
    const settingsStore = useSettingsStore();
    emitSignoutTier({
      tier: 'switch-person',
      trusted: settingsStore.isTrustedDevice,
      tokensKept: true,
    });
    finalizeSession();
  }

  /**
   * Sign out: reset auth state and optionally delete IndexedDB cache.
   * File handle is preserved so next login auto-reconnects to the data file.
   *
   * Resilience: every awaited step is wrapped so that a hung Drive sync,
   * network failure, or IndexedDB error cannot block the sign-out itself.
   * If anything throws or times out, we still clear local auth state and
   * let the caller navigate. A user who can't sign out is much worse than
   * a missed final save.
   */
  /**
   * Drop every armed OS reminder on sign-out.
   *
   * Pending alarms carry activity titles and resolved member names, so leaving
   * them would put family content on the lock screen of a signed-out device.
   * This used to happen implicitly — a null `currentMember` emptied the desired
   * set and the reconcile cancelled the world — but the not-ready guard in
   * `useLocalNotifications` removed that side effect, so it is explicit now.
   *
   * DYNAMIC import, matching the syncStore pattern below: a static one would pull
   * `@capacitor/local-notifications` into authStore's graph for every consumer
   * and every test. Never throws — the callee reports internally.
   */
  async function cancelRemindersForSignOut(): Promise<void> {
    try {
      const { cancelAllScheduledReminders } = await import('@/composables/useLocalNotifications');
      await cancelAllScheduledReminders();
    } catch (e) {
      console.warn('[authStore] failed to cancel OS reminders during sign-out', e);
    }
  }

  /**
   * On a genuine FULL sign-out (untrusted device, or "sign out and clear data")
   * clear the departed account's `.beanpod` driveConnections mirror + the
   * last-account breadcrumb (#62 account-switch reset). Only ever called on a
   * full teardown — the trusted same-account preserve path keeps both so a later
   * different-account sign-in can still detect the change. Must run with `email`
   * captured BEFORE `clearGoogleSessionState` nulls it, and BEFORE
   * `docClient.reset()` (the mirror lives in the still-resident doc). Best-effort;
   * `clearDriveConnectionForAccount` is `isDocLoaded()`-guarded and never throws.
   */
  async function clearDepartedGoogleArtifacts(email: string | null): Promise<void> {
    if (email) {
      await clearDriveConnectionForAccount(email);
      logEvent({
        level: 'info',
        surface: 'account-switch-reset',
        message: 'full sign-out cleared the departed account mirror',
        context: { action: 'signout-cleared-mirror' },
      });
    }
    clearLastGoogleAccount();
  }

  /**
   * Shared session-clear tail (all three tiers + switchMember).
   */
  /**
   * End the session because it could not be trusted.
   *
   * THE one exit for every integrity rejection — restore-time, roster-time and
   * self-removal alike — so the clear/report pair exists once and every kind is
   * classified identically. Anything that wants to reject a session calls this; nothing
   * hand-rolls `clearSession()` + a report of its own. (#80)
   *
   * `warning`, never `critical`: a rejection is the system working as designed, and
   * paging Slack for one would be noise. The kinds OUTSIDE `INTEGRITY_REJECTIONS`
   * (`key-changed`, `roster-switched`, `self-removed`) are deliberately not `reportError`
   * at all — an evicted registry, a swapped pod file and a deliberate departure are all
   * expected churn, and folding them in would drown the one metric that means somebody
   * edited a session.
   */
  /**
   * The roster vouched for this session's member. Only now is a restored pre-#80 blob
   * worth sealing (#3): its contents have been checked against the pod, so sealing it
   * commits a fact rather than laundering an unverified claim into a permanent one.
   *
   * `vouched` carries what the POD says about that member, and those values — not the
   * stored blob's — are what get sealed. A bare legacy session is an unauthenticated
   * shape in every field, and `resolveSessionMember` only ever checked `memberId`, so
   * re-sealing the blob verbatim signed a hand-edited `role`/`email`/`familyId` with the
   * real device key and made it valid forever, including past `LEGACY_SESSION_SUNSET`
   * (#80 review). `familyId` is left as-is deliberately: the roster row does not carry
   * one, and `classifyRosterRejection` reads it, so overwriting it here would erase the
   * signal that tells a switched pod from a forged member.
   *
   * Idempotent — the flag is cleared before the write, so a second roster load is a no-op.
   */
  function confirmSessionMember(vouched: {
    memberId: string;
    email: string;
    role?: string;
    displayName?: string;
  }): void {
    if (!sessionIsLegacy.value || !currentUser.value) return;
    // Defensive: only the member the roster actually vouched for may be sealed.
    if (vouched.memberId !== currentUser.value.memberId) return;
    sessionIsLegacy.value = false;
    const confirmed: AuthUser = {
      ...currentUser.value,
      memberId: vouched.memberId,
      email: vouched.email,
      role: vouched.role,
      displayName: vouched.displayName,
    };
    currentUser.value = confirmed;
    // `keepStoredOnFailure`: this is an OPTIONAL upgrade of a payload already in storage,
    // not a change to it. persistSession's usual drop-on-failure exists to stop a stale
    // higher-privilege envelope outliving a downgrade; here the stored envelope IS this
    // payload, so a transient missing device key must not sign the user out (#80 review).
    void persistSession(confirmed, { keepStoredOnFailure: true });
    logEvent({
      level: 'info',
      surface: 'session-integrity',
      message: 'session_resealed',
      context: { action: 'session_resealed' },
    });
  }

  /**
   * Drop the device's standing permission to re-open this pod unattended.
   *
   * `finalizeSession` alone declares a session dead without ENDING anything: the trusted
   * auto-open wrap is keyed on `familyId` (device-scoped, not member-scoped), so it
   * survives, and the next launch silently decrypts the pod and takes familyStore's owner
   * fallback — `sessionRejected` being page-local, it is false again by then. Clearing the
   * wrap is what makes an invalidation outlive the tab. (#80)
   *
   * Best-effort and never throws: failing to clear a key must not block the rejection.
   */
  async function revokeUnattendedReopen(hintFamilyId?: string): Promise<void> {
    try {
      const { useFamilyContextStore } = await import('@/stores/familyContextStore');
      // `hintFamilyId` is captured from the session BEFORE it is torn down. Without it
      // this ran after `finalizeSession()` had already nulled `currentUser`, and at boot
      // `activeFamilyId` is null too — so `clearCachedFamilyKey(undefined)` took its
      // clear-ALL branch and wiped trusted auto-open for every unrelated family on the
      // device (#80 review). Narrow to the rejected session's own pod where we can.
      const familyId = hintFamilyId ?? useFamilyContextStore().activeFamilyId ?? undefined;
      if (!familyId) {
        // Still unidentifiable. Clearing everything is the fail-closed choice — an
        // over-broad revoke costs a re-prove, an under-broad one leaves the rejected
        // pod re-openable unattended — but it is collateral, so it is counted.
        logEvent({
          level: 'warn',
          surface: 'session-integrity',
          message: 'unattended_reopen_revoked_for_all_families',
          context: { action: 'session_rejected', kind: 'revoke-unscoped' },
        });
      }
      await useSettingsStore().clearCachedFamilyKey(familyId);
    } catch (e) {
      reportError({
        surface: 'session-integrity',
        message:
          'could not drop the trusted auto-open key after invalidating a session — this device may re-open the pod unattended until the next full sign-out',
        severity: 'warning',
        error: e,
        context: { action: 'session_rejected', kind: 'revoke-failed' },
      });
    }
  }

  function invalidateSession(kind: SessionRejectionKind): void {
    // Sticky until a real sign-in. Without it the NEXT loadMembers sees a null session,
    // takes the legitimate "no session member" branch, and hands out the owner's row —
    // restoring the exact escalation this rejection exists to stop, one sync tick later.
    sessionRejected.value = true;
    // Capture before `finalizeSession()` nulls it — the revoke below needs to know WHICH
    // pod is being invalidated, and afterwards nothing does.
    const rejectedFamilyId = currentUser.value?.familyId;
    if (!INTEGRITY_REJECTIONS.has(kind)) {
      logEvent({
        level: 'warn',
        surface: 'session-integrity',
        message: 'session_ended_expectedly',
        context: { action: 'session_rejected', kind },
      });
    } else {
      reportError({
        surface: 'session-integrity',
        message: 'persisted session rejected',
        severity: 'warning',
        context: { action: 'session_rejected', kind },
      });
    }
    finalizeSession();
    void revokeUnattendedReopen(rejectedFamilyId);
  }

  function finalizeSession(): void {
    currentUser.value = null;
    isAuthenticated.value = false;
    newsletterOptIn.value = null;
    sessionIsLegacy.value = false;
    clearSession();
  }

  /**
   * Step IMPLEMENTATIONS for the sign-out tiers (Phase 4: the ORDER lives as data in
   * `signOutSteps.ts`; the store owns the bodies because it holds the session refs and
   * bounded-timeout helpers). `ctx` is mutated by the capture/resolve steps so later
   * steps read what earlier ones established — the runner guarantees order.
   *
   * Rationale for the individual steps (force-save semantics, wrong-account teardown
   * invariant, F14 fallback chain, cross-family worker-doc reset, trusted-keeps rules)
   * is documented on the helpers they call and in `signOutSteps.ts`'s header.
   */
  function buildSignOutStepImpls(ctx: {
    departedEmail: string | null;
    familyId: string | undefined;
  }): SignOutStepImpls {
    const settingsStore = useSettingsStore();
    return {
      quietTeardownAndForceSave: async () => {
        // Deliberate teardown: in-flight doc ops failing against the reset worker are
        // the expected consequence of leaving — keep them off the toast layer.
        docClient.beginQuietTeardown();
        await forceSaveWithTimeout(3000);
      },
      cancelReminders: () => cancelRemindersForSignOut(),
      captureDepartingAccount: () => {
        // MUST run before the Google clear nulls the cached email (#62).
        ctx.departedEmail = getGoogleAccountEmail();
      },
      clearGoogleSessionKeepTokens: () =>
        clearGoogleSessionStateWithTimeout(3000, { clearLocalTokens: false }),
      clearGoogleSessionDropTokens: () =>
        clearGoogleSessionStateWithTimeout(3000, { clearLocalTokens: true }),
      clearAllRefreshTokens: async () => {
        // Clean-device promise, multi-family: every OTHER family's drive.file refresh
        // token is a live bearer secret for the next user of the machine (review F8).
        const { getAllFamilies } = await import('@/services/familyContext');
        const { clearGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
        const families = await getAllFamilies();
        await Promise.allSettled(families.map((f) => clearGoogleRefreshToken(f.id)));
      },
      resetSyncState: async () => {
        const { useSyncStore } = await import('./syncStore');
        useSyncStore().resetState();
      },
      clearDepartedArtifacts: () => clearDepartedGoogleArtifacts(ctx.departedEmail),
      resetDocClient: () => docClient.reset(),
      resolveFamilyId: () => {
        // Fallback chain (review F14): a legacy session may lack familyId, and the
        // security-critical clears must never be gated on an optional.
        ctx.familyId =
          currentUser.value?.familyId ??
          useFamilyContextStore().activeFamilyId ??
          getActiveFamilyIdFromDb() ??
          undefined;
      },
      deleteFamilyDb: async () => {
        if (ctx.familyId) await deleteFamilyDatabase(ctx.familyId);
      },
      clearKeyCacheFamily: async () => {
        if (ctx.familyId) await settingsStore.clearCachedFamilyKey(ctx.familyId);
      },
      clearKeyCacheAll: () => settingsStore.clearCachedFamilyKey(),
      removePinWrapsFamily: async () => {
        if (!ctx.familyId) return;
        const { removePinUnlocksForFamily } = await import('@/services/auth/deviceUnlock');
        await removePinUnlocksForFamily(ctx.familyId);
      },
      removePinWrapsAll: async () => {
        const { removeAllPinUnlocks } = await import('@/services/auth/deviceUnlock');
        await removeAllPinUnlocks();
      },
      removeRosterFamily: async () => {
        if (!ctx.familyId) return;
        const { deleteRosterCache } =
          await import('@/services/indexeddb/repositories/rosterCacheRepository');
        await deleteRosterCache(ctx.familyId);
      },
      removeRosterAll: async () => {
        const { clearAllRosterCache } =
          await import('@/services/indexeddb/repositories/rosterCacheRepository');
        await clearAllRosterCache();
      },
      reclaimAllPasskeys: async () => {
        // Native keystore blobs first (enumerated FROM the registry records), then the
        // records + the platform Signal (greg's local-test find: leftovers rendered a
        // ghost "Windows Hello · Chrome" person card after clear-data).
        const { getAllFamilies } = await import('@/services/familyContext');
        const { reclaimFamilyKeystore, signalCredentialsRemoved } =
          await import('@/services/auth/passkeyService');
        const { getPasskeysByFamily, removePasskeyRegistration } =
          await import('@/services/indexeddb/repositories/passkeyRepository');
        for (const family of await getAllFamilies()) {
          await reclaimFamilyKeystore(family.id);
          const passkeys = await getPasskeysByFamily(family.id);
          for (const pk of passkeys) await removePasskeyRegistration(pk.credentialId);
          if (passkeys.length > 0) {
            await signalCredentialsRemoved(passkeys.map((pk) => pk.credentialId));
          }
        }
      },
      untrustDevice: () => settingsStore.setTrustedDevice(false),
      reArmTrustPrompt: () => settingsStore.resetTrustedDevicePrompt(),
    };
  }

  /**
   * Tier 2 — Sign out (Phase 5 semantics, Phase 4 structure): force-save, close the
   * pod, clear the member session. NO tier revokes at Google. Trusted devices keep
   * tokens + caches + wraps (silent reconnect); untrusted devices get the full
   * family-scoped local teardown. The step ORDER is data in `signOutSteps.ts`.
   */
  async function signOut(): Promise<void> {
    const settingsStore = useSettingsStore();
    const trusted = settingsStore.isTrustedDevice;
    const ctx = { departedEmail: null as string | null, familyId: undefined as string | undefined };
    await runSignOutSteps(
      trusted ? SIGN_OUT_TRUSTED_STEPS : SIGN_OUT_UNTRUSTED_STEPS,
      buildSignOutStepImpls(ctx)
    );
    emitSignoutTier({ tier: 'sign-out', trusted, tokensKept: trusted });
    finalizeSession();
  }

  /**
   * Force a durable save of the current worker doc before sign-out tears the
   * local cache down — bounded so a hung Drive call cannot block sign-out.
   *
   * Uses `saveNow()` (not a flush-if-pending): the freshest edits may live only
   * in the worker cache with NO pending debounce timer — the auto-save already
   * fired-and-failed, or elapsed — so a flush-if-pending would no-op and those
   * edits would be lost when the cache is deleted (ADR-032 defect 3). `saveNow`
   * returns `false` when there's no family key/envelope (e.g. signing out
   * mid-create before the pod file is configured) → nothing is uploaded, so a
   * partial/empty doc can never be written. Resolves on timeout or error — a
   * missed final save is acceptable; a user trapped on the page is not.
   */
  async function forceSaveWithTimeout(timeoutMs: number): Promise<void> {
    try {
      const saved = await Promise.race([
        saveNow(),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            console.warn('[authStore] force-save timed out — proceeding with sign-out');
            resolve(false);
          }, timeoutMs);
        }),
      ]);
      if (!saved) {
        // Not an error — no key/envelope yet (mid-create), nothing dirty, or the
        // timeout won the race. Logged (never silent) so a lost-last-edit repro
        // can confirm whether the final save reached Drive.
        console.warn('[authStore] force-save on sign-out saved nothing (no durable state to save)');
      }
    } catch (e) {
      console.warn('[authStore] force-save failed — proceeding with sign-out', e);
    }
    // Cancel any debounced save still pending so it doesn't fire after
    // sign-out clears auth state. Idempotent if no timer is set.
    cancelPendingSave();
  }

  /**
   * Wrap Google session cleanup so a stuck IndexedDB delete or hung
   * fetch cannot block sign-out. Resolves on timeout or error — leaving
   * a stale token cached is far better than trapping the user on the
   * page mid-sign-out.
   */
  async function clearGoogleSessionStateWithTimeout(
    timeoutMs: number,
    options: { clearLocalTokens?: boolean } = {}
  ): Promise<void> {
    try {
      await Promise.race([
        Promise.all([clearGoogleSessionState(options), Promise.resolve(clearFolderCache())]),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn(
              '[authStore] clearGoogleSessionState timed out — proceeding with sign-out'
            );
            resolve();
          }, timeoutMs);
        }),
      ]);
    } catch (e) {
      console.warn('[authStore] clearGoogleSessionState failed — proceeding with sign-out', e);
    }
  }

  /**
   * E2E test helper: restore auth from sessionStorage (dev mode only).
   * When the e2e_auto_auth flag is set, auto-authenticate so the app
   * skips the login page and loads family data from IndexedDB cache.
   */
  function restoreE2EAuth(): boolean {
    if (!import.meta.env.DEV) return false;
    try {
      if (sessionStorage.getItem('e2e_auto_auth') !== 'true') return false;
      isAuthenticated.value = true;
      isInitialized.value = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Tier 3 — Sign out & clear data: the clean-device promise. Full LOCAL teardown
   * (every family's tokens, caches, wraps, passkeys, rosters) — and still NO revoke
   * at Google (device-local action; whole-grant revoke would kill every other device
   * on the account — the explicit Settings disconnect is the sole revoke site).
   * Step ORDER is data in `signOutSteps.ts`.
   */
  async function signOutAndClearData(): Promise<void> {
    const ctx = { departedEmail: null as string | null, familyId: undefined as string | undefined };
    await runSignOutSteps(SIGN_OUT_CLEAR_STEPS, buildSignOutStepImpls(ctx));
    emitSignoutTier({ tier: 'sign-out-clear', trusted: false, tokensKept: false });
    finalizeSession();
  }

  return {
    // State
    isInitialized,
    isAuthenticated,
    hasFamilies,
    currentUser,
    isLoading,
    error,
    freshSignIn,
    newsletterOptIn,
    podCreated,
    // Getters
    needsAuth,
    needsPodSetup,
    displayName,
    // Actions
    markPodCreated,
    rehydrateOwnerDoc,
    initializeAuth,
    signIn,
    signInPasswordless,
    signInWithPin,
    setMemberPin,
    verifyMemberPin,
    resetMemberPinViaRecovery,
    adminResetMemberPin,
    enrollDevicePinWrapForMember,
    createRecoveryKit,
    setRecoveryPassphrase,
    signInWithPasskey,
    sessionRejected,
    sessionIsLegacy,
    confirmSessionMember,
    invalidateSession,
    createSessionForVerifiedMember,
    updateSessionWithMemberData,
    updateCurrentUserRole,
    registerPasskeyForCurrentUser,
    resolveDeviceKeysForFamily,
    signUp,
    changePassword,
    resetMemberPassword,
    joinFamily,
    switchMember,
    signOut,
    signOutAndClearData,
    restoreE2EAuth,
  };
});
