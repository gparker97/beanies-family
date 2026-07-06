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
import { getRegistryDatabase, isStorageBlockedError } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { saveNow, cancelPendingSave } from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { clearGoogleSessionState } from '@/services/google/googleAuth';
import { clearFolderCache } from '@/services/google/driveService';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from './translationStore';

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

export type RotateError = 'familyKeyMissing' | 'wrapFailed' | 'updateFailed';
export type RotateResult =
  { success: true; syncDeferred: boolean } | { success: false; error: RotateError };

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
      window.plausible?.('signup');
      window.plausible?.('login', { props: { method: 'password' } });

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
    // Force a durable save of the latest doc BEFORE the cache is torn down, so
    // the freshest edit (which may live only in the worker cache) reaches Drive.
    // Bounded timeout — Drive can hang indefinitely if its API key is rejected,
    // the file was deleted, or the network is offline. Don't let that block sign-out.
    await forceSaveWithTimeout(3000);

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
