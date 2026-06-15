import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { hashPassword, verifyPassword } from '@/services/auth/passwordService';
import {
  registerPasskeyForMember,
  authenticateWithPasskey,
  hasRegisteredPasskeys,
  type RegisterPasskeyResult,
} from '@/services/auth/passkeyService';
import type { PasskeySecret } from '@/types/models';
import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { flushPendingSave, cancelPendingSave } from '@/services/sync/syncService';
import { initDoc } from '@/services/automerge/docService';
import { clearGoogleSessionState } from '@/services/google/googleAuth';
import { clearFolderCache } from '@/services/google/driveService';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from './translationStore';

// ─── Password-rotation shared helper ─────────────────────────────────────
// `rotateMemberPassword` is the single source of truth for the four-step
// "re-wrap envelope, hash, updateMember, sync" sequence. All three flows
// (changePassword, resetMemberPassword, signIn self-heal) delegate to it.
// The discriminated-union return type forces each caller to check `success`
// before reading any other field.
// ─────────────────────────────────────────────────────────────────────────

export type RotateError = 'familyKeyMissing' | 'wrapFailed' | 'updateFailed';
export type RotateResult =
  | { success: true; syncDeferred: boolean }
  | { success: false; error: RotateError };

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

async function rotateMemberPassword(
  memberId: string,
  newPassword: string,
  surface: RotateSurface
): Promise<RotateResult> {
  // Lazy import to avoid the syncStore ↔ authStore circular dependency
  // (established pattern — see other lazy imports below).
  const { useSyncStore } = await import('@/stores/syncStore');
  const syncStore = useSyncStore();
  if (!syncStore.familyKey) {
    reportError({
      surface,
      message: 'familyKey not loaded — cannot wrap',
      severity: 'warning',
      context: { member_id_tail: memberId.slice(-8) },
    });
    return { success: false, error: 'familyKeyMissing' };
  }

  try {
    await syncStore.wrapFamilyKeyForMember(memberId, newPassword);
  } catch (e) {
    reportError({
      surface,
      message: 'wrapFamilyKeyForMember threw',
      error: e,
      context: { member_id_tail: memberId.slice(-8) },
    });
    return { success: false, error: 'wrapFailed' };
  }

  const newHash = await hashPassword(newPassword);
  const familyStore = useFamilyStore();
  const updated = await familyStore.updateMember(memberId, {
    passwordHash: newHash,
    requiresPassword: false,
  });
  if (!updated) {
    // Inconsistent local state: wrappedKey rotated but passwordHash unchanged.
    // Retry is idempotent — both writes overwrite. Surface explicitly.
    reportError({
      surface,
      message:
        'updateMember returned null after wrap succeeded — passwordHash stale; retry is idempotent',
      severity: 'error',
      context: { member_id_tail: memberId.slice(-8) },
    });
    return { success: false, error: 'updateFailed' };
  }

  const synced = await syncStore.syncNow(true);
  // syncNow failure already raises SaveFailureBanner. We expose syncDeferred
  // so callers can include "will sync when online" in their success toast.
  return { success: true, syncDeferred: !synced };
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

      // No family exists — user needs to create or join one
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
      window.plausible?.('login', { props: { method: 'password' } });

      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Sign in failed';
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
  async function buildOwnerDoc(
    owner: { name: string; email: string; passwordHash: string },
    id?: string
  ) {
    // Must run before any changeDoc() call (createMember writes to the doc).
    initDoc();
    const familyStore = useFamilyStore();
    // Clear stale state from any previous cancelled setup attempt.
    familyStore.resetState();
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
   * Rebuild the owner member after a full-page redirect during onboarding
   * (the iOS Drive flow) destroyed the in-memory Automerge doc, so the
   * resume-setup screen can go on to call `syncStore.createNewFile`. Re-uses
   * the persisted session for the immutable bits (memberId/email) and the
   * caller-supplied name + password for the rest. No-op if the doc already
   * has the owner (re-entered on the same session without an intervening
   * reload). Requires an active session.
   */
  async function rehydrateOwnerDoc(
    name: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentUser.value) return { success: false, error: 'No active session to resume' };
    const familyStore = useFamilyStore();
    if (familyStore.owner) return { success: true };
    try {
      const passwordHashValue = await hashPassword(password);
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
   * Sign up: create a new family + owner member with password.
   * This is the owner-only "Create Pod" flow.
   */
  async function signUp(params: {
    email: string;
    password: string;
    familyName: string;
    memberName: string;
    subscribeNewsletter?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
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

      // Hash the password + build the owner doc.
      const passwordHashValue = await hashPassword(params.password);
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
      window.plausible?.('signup');
      window.plausible?.('login', { props: { method: 'password' } });

      return { success: true };
    } catch (e) {
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
      const errorMessages: Record<RotateError, string> = {
        familyKeyMissing: 'Could not load family key — please sign out and back in, then try again',
        wrapFailed: 'Failed to re-wrap your account key. Please try again.',
        updateFailed:
          "Saved the new key locally but couldn't update your password record. Please try again.",
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
  ): Promise<{ success: true; syncDeferred: boolean } | { success: false; error: ResetError }> {
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
    window.plausible?.('admin_password_reset');
    return { success: true, syncDeferred: result.syncDeferred };
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
      window.plausible?.('member_joined');
      window.plausible?.('login', { props: { method: 'password' } });

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
  async function signInWithPasskey(
    familyId: string,
    passkeySecrets?: PasskeySecret[]
  ): Promise<{
    success: boolean;
    cancelled?: boolean;
    memberId?: string;
    familyKey?: CryptoKey;
    credentialId?: string;
    error?: string;
  }> {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await authenticateWithPasskey({ familyId, passkeySecrets });
      if (!result.success || !result.memberId) {
        // Don't pollute `error.value` with a user-cancellation — keeps
        // any reactive UI bound to authStore.error from rendering an
        // error state for a deliberate dismiss gesture.
        if (!result.cancelled) {
          error.value = result.error ?? 'Passkey authentication failed';
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
      window.plausible?.('login', { props: { method: 'passkey' } });

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
    window.plausible?.('login', { props: { method: 'cross_device' } });
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
   * Check if any passkeys are registered for a given family.
   */
  async function checkHasRegisteredPasskeys(familyId: string): Promise<boolean> {
    return hasRegisteredPasskeys(familyId);
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
  async function signOut(): Promise<void> {
    // Flush any pending debounced save so recent changes persist to file.
    // Bounded timeout — Drive can hang indefinitely if its API key is
    // rejected, the file was deleted, or the network is offline. Don't
    // let that block sign-out.
    await flushPendingSaveWithTimeout(3000);

    // Wipe Google session state (in-memory tokens, refresh tokens in
    // IndexedDB+localStorage, folder cache). Without this, signing in
    // with a different Google account on the next session can silently
    // re-use the previous account's refresh token via a silent token
    // refresh, leaving the app stuck on the wrong Drive.
    await clearGoogleSessionStateWithTimeout(3000);

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

    const familyId = currentUser.value?.familyId;

    // Delete the per-family IndexedDB cache unless this is a trusted device
    const settingsStore = useSettingsStore();
    if (familyId && !settingsStore.isTrustedDevice) {
      try {
        await deleteFamilyDatabase(familyId);
      } catch (e) {
        console.warn('Failed to delete family database on sign-out:', e);
      }
    }

    // Clear auth state
    currentUser.value = null;
    isAuthenticated.value = false;
    newsletterOptIn.value = null;
    clearSession();
  }

  /**
   * Wrap flushPendingSave so a hung Drive call cannot block sign-out.
   * Resolves on timeout or error — a missed final save is acceptable;
   * a user trapped on the page is not.
   */
  async function flushPendingSaveWithTimeout(timeoutMs: number): Promise<void> {
    try {
      await Promise.race([
        flushPendingSave(),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('[authStore] flushPendingSave timed out — proceeding with sign-out');
            resolve();
          }, timeoutMs);
        }),
      ]);
    } catch (e) {
      console.warn('[authStore] flushPendingSave failed — proceeding with sign-out', e);
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
  async function clearGoogleSessionStateWithTimeout(timeoutMs: number): Promise<void> {
    try {
      await Promise.race([
        Promise.all([clearGoogleSessionState(), Promise.resolve(clearFolderCache())]),
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
    // Flush any pending debounced save so recent changes persist to file.
    // Bounded — see signOut() for rationale.
    await flushPendingSaveWithTimeout(3000);

    // Wipe Google session state — same rationale as signOut().
    await clearGoogleSessionStateWithTimeout(3000);

    // Reset per-session sync state — same rationale as signOut().
    try {
      const { useSyncStore } = await import('./syncStore');
      useSyncStore().resetState();
    } catch (e) {
      console.warn('[authStore] syncStore.resetState failed during sign-out', e);
    }

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
    signInWithPasskey,
    createSessionForVerifiedMember,
    updateSessionWithMemberData,
    updateCurrentUserRole,
    registerPasskeyForCurrentUser,
    checkHasRegisteredPasskeys,
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
