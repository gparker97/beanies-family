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
import type { PasskeyRegistration, PasskeySecret } from '@/types/models';
import { getRegistryDatabase, isStorageBlockedError } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { saveNow, cancelPendingSave } from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { clearGoogleSessionState, getGoogleAccountEmail } from '@/services/google/googleAuth';
import { clearDriveConnectionForAccount } from '@/services/google/driveTokenRecovery';
import { clearLastGoogleAccount } from '@/services/sync/fileHandleStore';
import { clearFolderCache } from '@/services/google/driveService';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import type { WrappedMemberKey } from '@/types/syncFileV4';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from './translationStore';
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
 * an owner who can never authenticate (empty hash → `signIn` rejects it → the
 * encrypted pod is unrecoverable):
 *   1. `signUp({ deferPassword: true })` builds the owner with this sentinel
 *      and does NO hashing/key derivation.
 *   2. `rehydrateOwnerDoc` MUST NOT early-return when the owner still holds
 *      this sentinel — it applies the real hash (in place on desktop, via a
 *      rebuild on iOS). Early-returning only on a REAL hash is the guard.
 *   3. `syncStore.createNewFile`'s fail-closed precondition refuses to write a
 *      pod whose resolved owner still carries this sentinel.
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

function persistSession(user: AuthUser): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    // localStorage unavailable (e.g. private browsing) — silent fail
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(POD_CREATED_KEY);
  } catch {
    // silent fail
  }
}

function restoreSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
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

      if (families.length > 0) {
        // Try restoring a previous session (survives page refresh)
        const saved = restoreSession();
        if (saved) {
          currentUser.value = saved;
          isAuthenticated.value = true;
          podCreated.value = restorePodCreated();
        }
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
        const saved = restoreSession();
        if (saved) {
          currentUser.value = saved;
          isAuthenticated.value = true;
          hasFamilies.value = true;
          // Don't over-trust the (possibly-evicted) podCreated flag — the
          // authoritative value is established by the load attempt
          // (markPodCreated on success); the recovery flow handles a pod that
          // can't be loaded.
          podCreated.value = restorePodCreated();
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
      freshSignIn.value = true;
      persistSession(user);
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

  /**
   * Tap-through sign-in for a member with NO credential, on an already-open pod
   * (2026-08-28 login rethink — the prove engine's 'tap-through' method; today's
   * passwordless kids). Fail-closed guards: the member must exist in the LOADED doc and
   * must genuinely have no hash — a credentialed member can never enter this way, and a
   * closed pod has no roster to check against so it refuses too. Mirrors `signIn`'s
   * session tail exactly (one drift point fewer than a hand-rolled copy in a view).
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

      if (!member) {
        error.value = translationStore.t('auth.memberNotFound');
        return { success: false, error: error.value };
      }
      if (member.passwordHash) {
        // A credentialed member must prove — never tap through. Translated: this string
        // reaches ProveView's role=alert box (repo i18n rule for script-level strings).
        error.value = translationStore.t('auth.memberHasPassword');
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
      freshSignIn.value = true;
      persistSession(user);
      familyStore.setCurrentMember(member.id);

      const now = toISODateString(new Date());
      familyStore.updateMember(member.id, { lastLoginAt: now });
      track('login', { props: { method: 'tap-through' } });

      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : translationStore.t('auth.signInFailed');
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
    owner: { name: string; email: string; passwordHash: string },
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
   * Apply the real password to the owner on the create-finish surface (and
   * rebuild the owner after a full-page redirect destroyed the in-memory doc).
   * Re-uses the persisted session for the immutable bits (memberId/email) and
   * the caller-supplied name + password for the rest. Requires an active session.
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
   * No-op short-circuit when the owner already holds a REAL hash (a genuine
   * recovery re-entry on the same session) — never when it still carries the
   * `DEFERRED_PASSWORD_HASH` sentinel, or the fail-closed `createNewFile` guard
   * would block the create.
   */
  async function rehydrateOwnerDoc(
    name: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentUser.value) return { success: false, error: 'No active session to resume' };
    const familyStore = useFamilyStore();
    const existingOwner = familyStore.owner;
    if (existingOwner && existingOwner.passwordHash !== DEFERRED_PASSWORD_HASH) {
      return { success: true };
    }
    try {
      const passwordHashValue = await hashPassword(password);
      if (existingOwner) {
        // Desktop: owner present with the deferred sentinel — set the hash (and
        // any edited name) in place, preserving the rest of the step-1 doc.
        const updated = await familyStore.updateMember(existingOwner.id, {
          name,
          passwordHash: passwordHashValue,
        });
        if (!updated) return { success: false, error: 'Failed to set owner password' };
        return { success: true };
      }
      // iOS: the redirect reloaded the app — rebuild the owner from scratch.
      const member = await buildOwnerDoc(
        { name, email: currentUser.value.email, passwordHash: passwordHashValue },
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
   * `syncStore.createNewFile`, which always receives the real plaintext
   * password on the finish surface.
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
      freshSignIn.value = true;
      persistSession(user);
      // The session now exists but no `.beanpod` file does yet — that's
      // written later by `syncStore.createNewFile` (step 2 of the wizard).
      // Until then, the routing guard treats this as "resume setup", not
      // "ready for /nook".
      podCreated.value = false;
      persistPodCreated(false);
      track('signup');
      track('login', { props: { method: 'password' } });

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
  async function resetMemberPassword(
    targetMemberId: string,
    newPassword: string
  ): Promise<{ success: true } | { success: false; error: ResetError }> {
    if (!isAuthenticated.value || !currentUser.value) {
      return { success: false, error: 'notAuthenticated' };
    }
    if (targetMemberId === currentUser.value.memberId) {
      return { success: false, error: 'cannotResetSelf' };
    }
    const familyStore = useFamilyStore();
    const target = familyStore.members.find((m) => m.id === targetMemberId);
    if (!target) {
      return { success: false, error: 'memberNotFound' };
    }
    if (target.isPet) {
      return { success: false, error: 'isPet' };
    }
    if (target.role === 'owner') {
      return { success: false, error: 'cannotResetOwner' };
    }
    const me = familyStore.members.find((m) => m.id === currentUser.value!.memberId);
    if (!me?.canManagePod) {
      return { success: false, error: 'notAuthorized' };
    }

    const result = await rotateMemberPassword(targetMemberId, newPassword, 'reset-member-password');
    if (!result.success) {
      return { success: false, error: result.error };
    }
    track('admin_password_reset');
    return { success: true };
  }

  /**
   * Set password for an existing member (used during joiner onboarding).
   */
  async function setPassword(
    memberId: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const passwordHashValue = await hashPassword(password);
      const familyStore = useFamilyStore();
      await familyStore.updateMember(memberId, {
        passwordHash: passwordHashValue,
        requiresPassword: false,
      });

      const familyContextStore = useFamilyContextStore();
      const member = familyStore.members.find((m) => m.id === memberId);

      const user: AuthUser = {
        memberId,
        email: member?.email ?? '',
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member?.role,
      };
      currentUser.value = user;
      isAuthenticated.value = true;
      freshSignIn.value = true;
      persistSession(user);
      familyStore.setCurrentMember(memberId);

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to set password';
      return { success: false, error: message };
    }
  }

  /**
   * Join an existing family as a pre-created member.
   * Sets the member's password, creates a UserFamilyMapping, and marks onboarding complete.
   */
  async function joinFamily(params: {
    memberId: string;
    password: string;
    familyId: string;
  }): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      // Set password (this also auto-signs in and sets currentMember)
      const result = await setPassword(params.memberId, params.password);
      if (!result.success) return result;

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
      track('login', { props: { method: 'password' } });

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
      freshSignIn.value = true;
      persistSession(user);
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
    persistSession(user);
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
    persistSession(currentUser.value);
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
      persistSession(currentUser.value);
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

  async function signOut(): Promise<void> {
    // Force a durable save of the latest doc BEFORE the cache is torn down, so
    // the freshest edit (which may live only in the worker cache) reaches Drive.
    // Bounded timeout — Drive can hang indefinitely if its API key is rejected,
    // the file was deleted, or the network is offline. Don't let that block sign-out.
    await forceSaveWithTimeout(3000);

    await cancelRemindersForSignOut();

    // Wipe Google session state (in-memory tokens, refresh tokens in
    // IndexedDB+localStorage, folder cache). Without this, signing in
    // with a different Google account on the next session can silently
    // re-use the previous account's refresh token via a silent token
    // refresh, leaving the app stuck on the wrong Drive.
    //
    // On a TRUSTED device we preserve the active family's refresh token so the
    // same user's next sign-in reconnects to Drive silently instead of seeing a
    // reconnect prompt. This mirrors the IndexedDB cache below, which is also
    // kept on trusted devices — "this is my personal device, keep my session".
    // The pending-family slot is still cleared and the grant is not revoked, so
    // a *different* account signing in on a shared (untrusted) device still gets
    // the full teardown.
    const settingsStore = useSettingsStore();
    const trusted = settingsStore.isTrustedDevice;
    // Capture the departing account BEFORE clearGoogleSessionState nulls the
    // cached email — only needed on a full (untrusted) teardown (#62).
    const departedEmail = trusted ? null : getGoogleAccountEmail();
    await clearGoogleSessionStateWithTimeout(3000, { preserveRefreshToken: trusted });

    // Reset per-session sync state — banner flags, polling timer, encrypted
    // pending file, family key, file metadata. Without this, transient UI
    // state (e.g. `showGoogleReconnect = true` set by an earlier blip) bleeds
    // into the next session and the user sees a phantom "session expired"
    // toast immediately after a successful re-login.
    try {
      const { useSyncStore } = await import('./syncStore');
      useSyncStore().resetState();
    } catch (e) {
      console.warn('[authStore] syncStore.resetState failed during sign-out', e);
    }

    // Full (untrusted) teardown only: clear the departed account's .beanpod mirror
    // + last-account breadcrumb while the doc is still resident (before reset).
    // A trusted same-account sign-out keeps both (preservation). (#62)
    if (!trusted) {
      await clearDepartedGoogleArtifacts(departedEmail);
    }

    // Cross-family safety: drop the in-memory worker doc + family key + projection
    // on EVERY sign-out, INDEPENDENT of the trusted-device cache-retention gate
    // below. `docClient.reset()` keeps the cache DB (so a trusted device still gets
    // fast silent re-login), but without it a trusted-device sign-out leaves the
    // previous family's doc resident in the worker — and the next sign-in to a
    // family whose cache missed would CRDT-merge its remote into that stale doc,
    // producing an A∪B doc that gets persisted + uploaded to the new family's file
    // (durable cross-family corruption; see `replaceDocWithCacheRecovery`). On an
    // untrusted device `deleteFamilyDatabase` → `clearCache` resets again (idempotent).
    try {
      await docClient.reset();
    } catch (e) {
      console.warn('[authStore] docClient.reset failed during sign-out', e);
    }

    const familyId = currentUser.value?.familyId;

    // Delete the per-family IndexedDB cache unless this is a trusted device
    if (familyId && !trusted) {
      try {
        await deleteFamilyDatabase(familyId);
      } catch (e) {
        console.warn('Failed to delete family database on sign-out:', e);
      }
      // ...and the cached FAMILY KEY with it. Deleting the encrypted cache while
      // leaving the key that decrypts it behind is the wrong half: the key is stored
      // unencrypted in the registry DB, so on a shared device it let the next person
      // auto-decrypt the pod (`tryAutoDecrypt`) without proving anything at all.
      // Trusted devices keep it — that is exactly what "this is my own device" buys.
      try {
        await settingsStore.clearCachedFamilyKey(familyId);
      } catch (e) {
        reportError({
          surface: 'auth-signout',
          message: 'failed to clear the cached family key on an untrusted sign-out',
          error: e,
          severity: 'warning',
          context: { action: 'clear_cached_key' },
        });
      }
      // ...and the pre-decrypt roster cache. It is display data, not key material, but
      // on a shared device it names the family's members to whoever opens the app next —
      // same trust class as the cached key, so it follows the same rule: trusted keeps,
      // untrusted clears. Best-effort (a stale roster is harmless; the picker re-caches
      // on the next successful open).
      try {
        const { deleteRosterCache } =
          await import('@/services/indexeddb/repositories/rosterCacheRepository');
        await deleteRosterCache(familyId);
      } catch (e) {
        console.warn('Failed to clear roster cache on sign-out:', e);
      }
    }

    // Clear auth state
    currentUser.value = null;
    isAuthenticated.value = false;
    newsletterOptIn.value = null;
    clearSession();
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
    options: { preserveRefreshToken?: boolean } = {}
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
   * Sign out and always clear the per-family IndexedDB cache,
   * regardless of trusted device status. Also resets the trust flag.
   */
  async function signOutAndClearData(): Promise<void> {
    // Force a durable save of the latest doc before clearing the cache.
    // Bounded — see signOut() for rationale.
    await forceSaveWithTimeout(3000);

    // Doubly important here: this path promises the device is clean.
    await cancelRemindersForSignOut();

    // Capture the departing account BEFORE clearGoogleSessionState nulls the
    // cached email — this path is always a full teardown (#62).
    const departedEmail = getGoogleAccountEmail();

    // Wipe Google session state — same rationale as signOut().
    await clearGoogleSessionStateWithTimeout(3000);

    // Reset per-session sync state — same rationale as signOut().
    try {
      const { useSyncStore } = await import('./syncStore');
      useSyncStore().resetState();
    } catch (e) {
      console.warn('[authStore] syncStore.resetState failed during sign-out', e);
    }

    // Full teardown: clear the departed account's .beanpod mirror + last-account
    // breadcrumb while the doc is still resident (before the cache is deleted). (#62)
    await clearDepartedGoogleArtifacts(departedEmail);

    const familyId = currentUser.value?.familyId;

    // Always delete regardless of trust setting
    if (familyId) {
      try {
        await deleteFamilyDatabase(familyId);
      } catch (e) {
        console.warn('Failed to delete family database on sign-out:', e);
      }
    }

    // Clear trust flag and cached family key
    const settingsStore = useSettingsStore();
    await settingsStore.setTrustedDevice(false);
    await settingsStore.clearCachedFamilyKey();

    // This path promises a clean device: clear every family's pre-decrypt roster too
    // (display data, but it names the family's members to the next user of the machine).
    try {
      const { clearAllRosterCache } =
        await import('@/services/indexeddb/repositories/rosterCacheRepository');
      await clearAllRosterCache();
    } catch (e) {
      console.warn('Failed to clear roster caches on sign-out-and-clear:', e);
    }

    // Clear auth state
    currentUser.value = null;
    isAuthenticated.value = false;
    newsletterOptIn.value = null;
    clearSession();
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
    signInWithPasskey,
    createSessionForVerifiedMember,
    updateSessionWithMemberData,
    updateCurrentUserRole,
    registerPasskeyForCurrentUser,
    resolveDeviceKeysForFamily,
    signUp,
    setPassword,
    changePassword,
    resetMemberPassword,
    joinFamily,
    signOut,
    signOutAndClearData,
    restoreE2EAuth,
  };
});
