<script setup lang="ts">
import { ref, onMounted, watch, watchEffect } from 'vue';
import type { WatchStopHandle } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LoginBackground from '@/components/login/LoginBackground.vue';
import LoginSecurityFooter from '@/components/login/LoginSecurityFooter.vue';
import WelcomeGate from '@/components/login/WelcomeGate.vue';
// REVIEW-DEMO: access-code entry for store-review demo mode.
import ReviewDemoCodeModal from '@/components/login/ReviewDemoCodeModal.vue';
import FamilyPickerView from '@/components/login/FamilyPickerView.vue';
import LoadPodView from '@/components/login/LoadPodView.vue';
import PickBeanView from '@/components/login/PickBeanView.vue';
import CreatePodView from '@/components/login/CreatePodView.vue';
import ResumePodSetup from '@/components/login/ResumePodSetup.vue';
import JoinPodView from '@/components/login/JoinPodView.vue';
import BiometricLoginView from '@/components/login/BiometricLoginView.vue';
import InviteGateOverlay from '@/components/login/InviteGateOverlay.vue';
import CreatePodWelcome from '@/components/login/CreatePodWelcome.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { isNavigationCancelled } from '@/utils/appChrome';
import { features } from '@/config/features';
import { useSyncStore } from '@/stores/syncStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { getProviderConfig } from '@/services/sync/fileHandleStore';
import type { PersistedProviderConfig } from '@/services/sync/fileHandleStore';
import type { PasskeyRegistration } from '@/types/models';
import { tryReconnectSilently } from '@/services/google/driveTokenRecovery';
import {
  RESUME_LOAD_DRIVE,
  isPodlessRecoveryQuery,
  RESUME_SETUP_PATH,
} from '@/components/login/resumePaths';
import { reportError } from '@/utils/errorReporter';

const router = useRouter();
const route = useRoute();
const { t } = useTranslation();
const syncStore = useSyncStore();
const settingsStore = useSettingsStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

type LoginView =
  | 'welcome'
  | 'loading'
  | 'load-pod'
  | 'pick-bean'
  | 'create'
  | 'resume-setup'
  | 'join'
  | 'biometric'
  | 'family-picker';

const props = withDefaults(defineProps<{ initialView?: LoginView }>(), {
  initialView: 'welcome',
});

const activeView = ref<LoginView>(props.initialView);

// REVIEW-DEMO: the demo code modal is an overlay over whatever view is active,
// so it gets its own visibility flag rather than a LoginView member.
const showReviewDemoModal = ref(false);
const needsPermissionGrant = ref(false);
const autoLoadPod = ref(false);
/**
 * Set by the resume dispatcher when returning from a Drive-LOAD OAuth redirect
 * (`?resume=load-drive`). Handed to `LoadPodView` to re-open the Google Drive
 * file picker with the now-cached token. See ADR-029.
 */
const autoOpenDrivePicker = ref(false);
const isInitializing = ref(true);
const biometricFamilyId = ref('');
const biometricFamilyName = ref<string | undefined>();
/**
 * The device keys for the family being signed into — resolved once at family selection
 * and handed to BiometricLoginView, so the registry is read once per selection rather
 * than again by every consumer.
 */
const biometricDeviceKeys = ref<PasskeyRegistration[]>([]);
const biometricDeclined = ref(false);
const crossDeviceContext = ref<{
  crossDevice: true;
  memberId: string;
  credentialId?: string;
} | null>(null);
const forceNewGoogleAccount = ref(false);
const loadError = ref<string | undefined>();
const loadErrorProviderHint = ref<'local' | 'google_drive' | undefined>();
/**
 * When set, hand `LoadPodView` a known Drive pod to reconnect-and-load directly
 * (token expired on a Drive family — see `handleFamilySelected`'s `'auth'` branch).
 * Always cleared via `resetLoadPodState()` so it can't leak across navigations.
 */
const reconnectDriveFile = ref<{ fileId: string; fileName: string; familyName?: string }>();
const isSingleFamilyAutoSelect = ref(false);
// Two mutually-exclusive create-path overlays over the always-mounted CreatePodView.
// Precedence is encoded by v-if/v-else-if order in the 'create' block below: the
// invite gate (only when flagged on) OUTRANKS the welcome intro. Two independent
// once-per-mount latches:
//  - inviteGateLocked: starts features.inviteGate; latched false on unlock.
//  - showCreateWelcome: starts true; latched false ONLY on proceed (✕/cancel leaves
//    it true so the intro re-shows on re-entry, since they haven't seen the wizard).
//
// Invite gate intentionally retained but switched off in prod — see
// docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md. NOT dead code: set the
// INVITE_GATE repo variable to "true" to re-gate (the token hashes secret stays populated
// but inert meanwhile; see features.ts for the two-condition interlock). To fully remove:
// delete this + the create block's InviteGateOverlay + InviteGateOverlay/InviteDiscordButton/
// inviteToken.ts + the inviteGate.* strings.
const inviteGateLocked = ref(features.inviteGate);
const showCreateWelcome = ref(true);

// Reactive resume-setup detection. Runs synchronously on setup and re-fires
// whenever auth state or `?resume=setup` changes, so we catch BOTH cases:
//
//   1. Initial page load already at `/welcome?resume=setup` (post-OAuth-
//      return — OAuthCallbackPage's `state.returnPath` lands us there).
//   2. Initial page load at `/welcome` (no query) while in the zombie state
//      (authenticated session, no pod file). App.vue's onMounted detects
//      this and `router.replace`s to `/welcome?resume=setup` AFTER our
//      onMounted has already decided activeView — without this reactive
//      watch the user would be stuck on whatever onMounted picked (the
//      WelcomeGate / family-picker / etc.) instead of ResumePodSetup.
//
// Stops itself once we've taken the resume-setup branch.
//
// TDZ guard (caught 2026-05-18 from Boeder Familienplan onboarding on
// Android — see #beanies-errors `vue-render` alert): `watchEffect` runs its
// callback synchronously on first invocation. When all conditions are
// already true at mount (e.g. router guard just redirected from /nook to
// /welcome?resume=setup with auth already initialized), the first run hits
// `stopResumeWatch()` before `const stopResumeWatch = watchEffect(...)` has
// finished assigning — ReferenceError: Cannot access 'stopResumeWatch'
// before initialization. Using `let` + no-op default lets the first run
// safely call the no-op, then assignment completes and any reactive re-run
// calls the real stop handle.
let stopResumeWatch: WatchStopHandle = () => {};
stopResumeWatch = watchEffect(() => {
  if (!authStore.isInitialized) return;

  // Returning from a Drive-LOAD OAuth redirect (`?resume=load-drive`). This can
  // fire DURING a fresh sign-in: with zero local families the user is NOT yet
  // authenticated (loading the pod is what produces the family/auth — see
  // authStore.ts), so it MUST be handled before the `isAuthenticated` gate that
  // `resume=setup` relies on. The picker lists Drive-wide (family-agnostic), so
  // it needs no restored family. See ADR-029.
  if (route.query.resume === RESUME_LOAD_DRIVE) {
    activeView.value = 'load-pod';
    autoOpenDrivePicker.value = true;
    isInitializing.value = false;
    stopResumeWatch();
    return;
  }

  if (!authStore.isAuthenticated) return;
  if (route.query.resume !== 'setup') return;
  activeView.value = 'resume-setup';
  isInitializing.value = false;
  stopResumeWatch();
});

/**
 * Hardened `router.replace` for the podless self-rescue below. App.vue's
 * `safeRouterReplace` is component-local (closes over its init/overlay state),
 * so we use a small local equivalent rather than couple to it. Mirrors App.vue's
 * numeric-`type` NavigationFailure convention: vue-router resolves (does not
 * reject) with a `NavigationFailure` when a guard cancels the nav. On a
 * cancel/throw we surface a warning (never a silent failure) and the `finally`
 * always clears the spinner so the user is never stranded — the reactive
 * `watchEffect` above still flips `activeView` once the URL settles.
 */
async function replaceOrSurface(target: string, callerTag: string): Promise<void> {
  try {
    const result = await router.replace(target);
    if (isNavigationCancelled(result)) {
      console.warn(
        `[LoginPage] router.replace('${target}') from ${callerTag} was cancelled by a guard (type=${result.type})`
      );
      reportError({
        surface: 'login.podlessRescue.replaceCancelled',
        message: `router.replace('${target}') was cancelled by a guard (caller=${callerTag}, type=${result.type})`,
        severity: 'warning',
        context: { route_path: route.fullPath },
      });
    }
  } catch (e) {
    // A THROW (vs a NavigationFailure) means the URL never changed, so the
    // reactive resume watchEffect can't rescue the view — the user would be
    // stuck on a chrome-less page. Escalate to a hard recovery: drop them on
    // the welcome gate (actionable) rather than a dead screen.
    console.error(`[LoginPage] router.replace('${target}') from ${callerTag} threw:`, e);
    reportError({
      surface: 'login.podlessRescue.replaceThrew',
      message: `router.replace('${target}') threw during podless self-rescue (caller=${callerTag})`,
      error: e,
      severity: 'warning',
      context: { route_path: route.fullPath },
    });
    activeView.value = 'welcome';
  } finally {
    // Never leave the user on a dead spinner — clear it regardless of outcome.
    isInitializing.value = false;
  }
}

onMounted(async () => {
  // Surface an OAuth-redirect storage failure (iOS Private Browsing lost the
  // PKCE state during the round-trip — OAuthCallbackPage routes here with
  // ?authError=storage rather than silently dropping the code).
  if (route.query.authError === 'storage') {
    showToast('error', t('oauth.storageErrorTitle'), t('oauth.storageErrorBody'), { silent: true });
  }

  // Wait for App.vue's `authStore.initializeAuth()` to finish before
  // reading auth state. Vue fires children's onMounted BEFORE the parent
  // (App.vue), so our hooks race the parent's async init — without this
  // wait, every check below sees the pre-init values. The specific case
  // this broke (caught 2026-05-13 from greg's iPhone 14 Safari on the
  // Drive-OAuth-return load): the session had been persisted to localStorage
  // by signUp but `authStore.isAuthenticated` was still its default `false`
  // when we evaluated `?resume=setup && isAuthenticated`, so the resume-
  // setup branch was silently skipped and the user got dropped on the
  // WelcomeGate while `app.onboardingZombieState` correctly fired in Slack.
  if (!authStore.isInitialized) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => authStore.isInitialized,
        (v) => {
          if (v) {
            stop();
            resolve();
          }
        },
        { immediate: true }
      );
    });
  }

  // Resume-setup recovery screen: an authenticated session exists but no
  // `.beanpod` file was ever written (a half-finished onboarding, or an iOS
  // Drive OAuth redirect mid-flight). The router guard / App.vue route us
  // here with `?resume=setup`. ResumePodSetup owns its own family-context
  // setup, so skip the rest of the welcome-gate / family-picker logic. The
  // watchEffect above also catches this reactively; this synchronous check
  // wins the common case (URL already on `?resume=setup` at first paint)
  // without a brief flicker of the welcome gate while the watch fires.
  if (route.query.resume === 'setup' && authStore.isAuthenticated) {
    activeView.value = 'resume-setup';
    isInitializing.value = false;
    return;
  }

  // Zombie state (authenticated, no pod). Bail out of the family-init /
  // single-family-auto-select logic — pressing on would call
  // `handleFamilySelected(singleFamily)` on a pod that doesn't exist.
  if (authStore.needsPodSetup) {
    // Already on a deliberate recovery surface (resume-setup, or the Drive-load
    // picker re-open, ADR-029)? The reactive watchEffect above flips activeView
    // and clears isInitializing — just bail.
    if (isPodlessRecoveryQuery(route.query.resume)) return;
    // Otherwise we were (re)mounted podless without recovery context — e.g. the
    // create-pod remount race, or a direct deep-link to /create after signup.
    // App.vue's boot redirect does NOT re-run on a remount, so SELF-RESCUE to
    // resume-setup rather than leaving the spinner up forever. `replaceOrSurface`
    // clears isInitializing in all outcomes (no silent failure, no dead spinner).
    await replaceOrSurface(RESUME_SETUP_PATH, 'LoginPage.onMounted.podlessRescue');
    return;
  }

  if (familyStore.members.length === 0) {
    // Guarded: every await below can throw (IndexedDB blocked in a private window, a
    // Drive call rejecting), and `isInitializing` is only cleared on the success paths —
    // so an unhandled throw left a bare, textless spinner up forever with no way out.
    try {
      await familyContextStore.initialize();
      await syncStore.initialize();
    } catch (e) {
      reportError({
        surface: 'login-page',
        message: 'login initialisation failed — falling back to the welcome gate',
        error: e,
        severity: 'warning',
        context: { action: 'init_failed' },
      });
      activeView.value = 'welcome';
      isInitializing.value = false;
      return;
    }

    // Pre-loaded pending file (e.g. user arrived via /open from Drive's
    // "Open with beanies.family" gesture): skip the welcome gate + family
    // picker and jump straight to LoadPodView's auto-decrypt UI. The
    // pending envelope is already in the store from OpenFromDrivePage's
    // call to `loadFromGoogleDrive`, so LoadPodView's autoLoadFile() will
    // see `hasPendingEncryptedFile === true` and show the password modal
    // immediately — no file picker, no second OAuth.
    if (syncStore.hasPendingEncryptedFile) {
      autoLoadPod.value = true;
      activeView.value = 'load-pod';
      isInitializing.value = false;
      return;
    }

    // Single-family fast login: skip WelcomeGate + FamilyPicker
    const allFamilies = familyContextStore.allFamilies;
    const singleFamily = allFamilies.length === 1 ? allFamilies[0] : undefined;
    if (singleFamily) {
      const [deviceKeys, providerConfig] = await Promise.all([
        authStore.resolveDeviceKeysForFamily(singleFamily.id),
        getProviderConfig(singleFamily.id),
      ]);
      isSingleFamilyAutoSelect.value = true;
      // Keep the spinner up until handleFamilySelected has chosen a view. Clearing it
      // first painted the full WelcomeGate for the whole duration of the Drive fetch,
      // then swapped it out — a flash of the exact screen this fast path exists to skip.
      await handleFamilySelected({
        id: singleFamily.id,
        name: singleFamily.name ?? 'My Family',
        deviceKeys,
        providerConfig,
      });
      isInitializing.value = false;
      return;
    }
  } else {
    // Members already loaded (e.g. navigated back) — go to pick-bean
    activeView.value = 'pick-bean';
  }

  isInitializing.value = false;
});

/**
 * Activate a family and prepare for biometric login.
 * Pre-loads the encrypted file so BiometricLoginView can decrypt it with a passkey.
 * Falls back to load-pod if file loading fails or file turns out to be unencrypted.
 */
/**
 * Prepare a family for a biometric sign-in and route to the right view.
 *
 * Takes one options object rather than positionals: this change adds a fourth argument,
 * two of which are optional, and `f(a, b, undefined, d)` at a call site is unreadable.
 */
async function activateFamilyForBiometric(opts: {
  familyId: string;
  familyName: string;
  providerConfig?: PersistedProviderConfig | null;
  deviceKeys: PasskeyRegistration[];
}) {
  const { familyId, familyName, providerConfig, deviceKeys } = opts;
  // Switch to the selected family
  if (familyContextStore.activeFamilyId !== familyId) {
    await familyContextStore.switchFamily(familyId);
    syncStore.resetState();
    await syncStore.initialize();
  }

  // Pre-load the encrypted file so biometric login can decrypt it
  if (syncStore.isConfigured) {
    try {
      if (syncStore.needsPermission) {
        // After PWA restart, local file handle permissions are revoked by the browser.
        // Request permission first (safe — this runs during a user gesture).
        const granted = await syncStore.requestPermission();
        if (!granted) {
          // Permission denied — fall back to load-pod with the permission grant UI.
          enterGenericLoadFallback(toProviderHint(providerConfig ?? null), {
            needsPermission: true,
            withError: false,
          });
          return;
        }
        // Permission granted — requestPermission() internally loaded the file.
        // If file was unencrypted, it auto-decrypted (no pending file).
      } else {
        const loadResult = await syncStore.loadFromFile();
        if (!loadResult.success && !loadResult.needsPassword) {
          // Load failed for non-password reasons — fall back with error
          enterGenericLoadFallback(toProviderHint(providerConfig ?? null));
          return;
        }
        // success: true → file loaded (unencrypted, auto-decrypted)
        // needsPassword: true → file encrypted, pending for biometric decrypt
      }
    } catch (err) {
      // File moved/deleted/network error. This used to be a bare `catch {}`, so the pod
      // failing to pre-load was indistinguishable from any other provider problem — the
      // user saw a generic message and we saw nothing at all.
      logEvent({
        level: 'warn',
        surface: 'native-biometric',
        message: 'login_routing',
        context: {
          action: 'preload_failed',
          // The ERROR NAME only. A raw message here is unbounded third-party text
          // (filenames, account hints), and `detail` goes to the firehose.
          error_code: err instanceof Error ? err.name : 'unknown',
        },
      });
      enterGenericLoadFallback(toProviderHint(providerConfig ?? null));
      return;
    }
  }

  // No pending encrypted file: the pod is already open (unencrypted, auto-decrypted, or
  // decrypted earlier in this session).
  //
  // THIS IS THE #76 DEFECT. It used to send every such case to pick-bean, on the
  // reasoning that "biometric decrypt would fail" — true, but decryption is only HALF of
  // what a key does. It also identifies the member. So on the most common path of all —
  // sign out, come back, pod still cached — a device holding a perfectly good key was
  // never offered it, and asked for a member password biometric was never designed to
  // satisfy. Telemetry showed unlock_result:ok and a password prompt in the same session.
  if (syncStore.isConfigured && !syncStore.hasPendingEncryptedFile) {
    // Last resort: try auto-decrypt with cached passwords in case pending file was set
    // but hasPendingEncryptedFile is somehow false (defensive)
    const autoDecrypted = await tryAutoDecrypt(familyId);

    if (deviceKeys.length > 0) {
      // Already decrypted AND this device can identify a member — sign them in.
      logBiometricRouting('biometric', 'decrypted_with_key', deviceKeys.length);
      enterBiometricView(familyId, familyName, deviceKeys);
      return;
    }

    logBiometricRouting('pick_bean', autoDecrypted ? 'auto_decrypted' : 'no_pending_file');
    activeView.value = 'pick-bean';
    return;
  }

  // Happy path: encrypted file is pending, show biometric login
  logBiometricRouting('biometric', 'pending_encrypted', deviceKeys.length);
  enterBiometricView(familyId, familyName, deviceKeys);
}

/**
 * Record WHICH WAY login routed, and on what evidence.
 *
 * This decision — offer biometric, or go straight to the bean picker — is consequential
 * and was previously silent, so "why was I not offered Face ID?" could only be answered by
 * reading the source and guessing at the runtime state. It cost a round of exactly that.
 *
 * `hasPendingEncryptedFile` is the whole gate: biometric unlock returns the FAMILY KEY, so
 * it has nothing to do when the pod is already decrypted. Logging the inputs alongside the
 * branch is what makes that legible from CloudWatch instead of inferable from code.
 *
 * Reuses `action` / `detail` / `kind`, all already allowlisted and already declared — no
 * new context key, so no store-declaration change.
 */
function logBiometricRouting(
  branch: 'biometric' | 'pick_bean',
  reason: string,
  deviceKeyCount = 0
): void {
  logEvent({
    level: 'info',
    surface: 'native-biometric',
    message: 'login_routing',
    context: {
      action: branch,
      // The key count rides INSIDE `detail`: `count` is not in ALLOWED_CONTEXT_KEYS, so
      // passing it as its own field would be silently stripped by redactContext — which
      // is precisely the blindness this event exists to remove.
      detail: deviceKeyCount > 0 ? `${reason}:keys=${deviceKeyCount}` : reason,
      kind: syncStore.isConfigured ? 'configured' : 'unconfigured',
      stage: syncStore.hasPendingEncryptedFile ? 'pending_file' : 'no_pending_file',
    },
  });
}

/**
 * Try to auto-decrypt using cached family key.
 * Returns true if decryption succeeded.
 */
async function tryAutoDecrypt(familyId: string): Promise<boolean> {
  const cachedKeyB64 = settingsStore.getCachedFamilyKey(familyId);
  if (!cachedKeyB64) return false;

  try {
    const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
    const { base64ToBuffer } = await import('@/utils/encoding');
    const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
    const result = await syncStore.decryptPendingFileWithKey(fk);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Derive a provider hint from a PersistedProviderConfig for LoadPodView.
 */
function toProviderHint(
  config: PersistedProviderConfig | null
): 'local' | 'google_drive' | undefined {
  if (!config) return undefined;
  return config.type === 'google_drive' ? 'google_drive' : 'local';
}

function providerErrorMessage(hint: 'local' | 'google_drive' | undefined): string {
  if (hint === 'local') return t('fastLogin.loadErrorLocal');
  if (hint === 'google_drive') return t('fastLogin.loadErrorDrive');
  return t('familyPicker.loadError');
}

/**
 * Clear the whole LoadPodView intent group so no stale mode leaks across a
 * navigation. The single reset site for `reconnectDriveFile` (the rest are
 * historically hand-set; routing the new ref through here keeps it honest).
 * Does NOT touch `forceNewGoogleAccount` — that's an orthogonal "force the
 * account chooser" flag the caller manages.
 */
function resetLoadPodState() {
  autoLoadPod.value = false;
  needsPermissionGrant.value = false;
  biometricDeclined.value = false;
  loadError.value = undefined;
  loadErrorProviderHint.value = undefined;
  reconnectDriveFile.value = undefined;
  // Belongs to the family we were routing to — leaving it set renders one family's beans
  // under another family's name, and every button on it fails as a member mismatch.
  biometricDeviceKeys.value = [];
  // Likewise scoped to one attempt: left set, it makes a LATER password load pop an
  // unexplained biometric-enrolment prompt (LoadPodView consumes it after decrypt).
  crossDeviceContext.value = null;
}

/**
 * Show LoadPodView's generic provider+file picker with an error for `hint`.
 *
 * `opts` covers the two variants that were previously open-coded as near-identical
 * four-ref assignment blocks: `needsPermission` for a denied file-handle grant (which
 * shows the permission UI and has no error text), and `autoLoad` for the encrypted-file
 * decrypt modal. Routing all of them through here makes an inconsistent flag combination
 * structurally impossible — `resetLoadPodState` clears every flag first, so a caller can
 * only ever turn ON what it names.
 */
function enterGenericLoadFallback(
  hint: 'local' | 'google_drive' | undefined,
  opts: { needsPermission?: boolean; autoLoad?: boolean; withError?: boolean } = {}
) {
  const { needsPermission = false, autoLoad = false, withError = true } = opts;
  resetLoadPodState();
  if (withError) loadError.value = providerErrorMessage(hint);
  loadErrorProviderHint.value = hint;
  needsPermissionGrant.value = needsPermission;
  autoLoadPod.value = autoLoad;
  activeView.value = 'load-pod';
}

/**
 * Handle family selection from FamilyPickerView.
 * Routes to biometric (if passkeys), attempts auto-load, or falls back to load-pod.
 */
async function handleFamilySelected(payload: {
  id: string;
  name: string;
  /** Resolved by the picker (or the single-family fast path) — see `biometricDeviceKeys`. */
  deviceKeys: PasskeyRegistration[];
  providerConfig: PersistedProviderConfig | null;
}) {
  // Switch to selected family
  if (familyContextStore.activeFamilyId !== payload.id) {
    await familyContextStore.switchFamily(payload.id);
    syncStore.resetState();
    await syncStore.initialize();
  }

  // Clear any stale LoadPodView intent (incl. reconnectDriveFile) before routing.
  resetLoadPodState();

  if (payload.deviceKeys.length > 0) {
    // Go to biometric login (pre-load file)
    await activateFamilyForBiometric({
      familyId: payload.id,
      familyName: payload.name,
      providerConfig: payload.providerConfig,
      deviceKeys: payload.deviceKeys,
    });
  } else if (syncStore.isConfigured && !syncStore.needsPermission) {
    // No key on this device — the single commonest answer to "why wasn't I offered
    // biometric?", and it used to log nothing at all, so the question was unanswerable
    // from CloudWatch precisely when it was asked.
    logBiometricRouting('pick_bean', 'no_device_keys');
    // File configured and accessible — try auto-load
    activeView.value = 'loading';
    try {
      const loadResult = await syncStore.loadFromFile();
      if (loadResult.success) {
        // Loaded successfully — go to pick-bean

        activeView.value = 'pick-bean';
      } else if (loadResult.needsPassword) {
        // Encrypted — try auto-decrypt
        if (await tryAutoDecrypt(payload.id)) {
          activeView.value = 'pick-bean';
        } else {
          // Can't auto-decrypt — fall back to LoadPodView with decrypt modal
          enterGenericLoadFallback(toProviderHint(payload.providerConfig), {
            autoLoad: true,
            withError: false,
          });
        }
      } else {
        // Auto-load failed. If the token is gone on a Drive family, offer a
        // focused reconnect that loads the known file directly (no provider
        // cards, no file picker); otherwise the generic provider+file picker.
        const cfg = payload.providerConfig;
        if (loadResult.reason === 'auth' && cfg?.type === 'google_drive' && cfg.driveFileId) {
          // Silent reconnect BEFORE prompting (2026-06-19, cluster 2):
          // syncStore.initialize() already restored the refresh token, but the
          // cold-start silent refresh can fail/time out on the first try and
          // surface a needless reconnect prompt even though data wasn't cleared.
          // Retry silently; on success route into the normal auto-load path
          // (which reads the file + prompts for password/biometric as usual).
          const recovered = await tryReconnectSilently(syncStore.providerAccountEmail ?? undefined);
          if (recovered) {
            autoLoadPod.value = true;
            needsPermissionGrant.value = false;
            biometricDeclined.value = false;
            loadErrorProviderHint.value = toProviderHint(cfg);
            activeView.value = 'load-pod';
          } else {
            console.warn(
              '[LoginPage] welcome-back: silent reconnect failed — showing focused reconnect'
            );
            reconnectDriveFile.value = {
              fileId: cfg.driveFileId,
              fileName: cfg.driveFileName ?? `${payload.name}.beanpod`,
              familyName: payload.name,
            };
            activeView.value = 'load-pod';
          }
        } else {
          enterGenericLoadFallback(toProviderHint(cfg));
        }
      }
    } catch {
      // Unexpected throw (file moved/deleted/corrupt, etc.) — generic fallback.
      enterGenericLoadFallback(toProviderHint(payload.providerConfig));
    }
  } else if (syncStore.isConfigured && syncStore.needsPermission) {
    // File configured but needs permission — go to load-pod with permission grant UI
    autoLoadPod.value = false;
    needsPermissionGrant.value = true;
    biometricDeclined.value = false;
    activeView.value = 'load-pod';
  } else {
    // No file configured — go to load-pod for manual selection
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
    biometricDeclined.value = false;
    activeView.value = 'load-pod';
  }
}

/**
 * Handle "Load a different file" from FamilyPickerView.
 * Forces Google account chooser when loading via Drive.
 */
function handleLoadDifferentFile() {
  resetLoadPodState();
  forceNewGoogleAccount.value = true;
  activeView.value = 'load-pod';
}

function handleNavigate(view: 'load-pod' | 'create' | 'join' | 'review-demo') {
  // REVIEW-DEMO: a modal, NOT a view — it must return before the tail
  // `activeView.value = view` below, which only accepts real views. Keeping this
  // first also lets TypeScript narrow `view` back to the three real views for
  // that assignment, so no cast is needed. Note 'review-demo' is deliberately
  // NOT added to the `LoginView` union.
  if (view === 'review-demo') {
    showReviewDemoModal.value = true;
    return;
  }

  resetLoadPodState();
  forceNewGoogleAccount.value = false;

  if (view === 'load-pod') {
    // "Sign In" from welcome → go to family picker if families exist
    const hasFamilies = familyContextStore.allFamilies.length > 0;
    if (hasFamilies) {
      activeView.value = 'family-picker';
      return;
    }
    // No families — fall through to load-pod with account chooser
    forceNewGoogleAccount.value = true;
  }

  activeView.value = view;
}

/**
 * Enter the biometric view. THE only way in — every one of the three routes here needs
 * all three pieces of state, and setting two of them yields a screen whose button does
 * nothing at all (no prompt, no error, no telemetry), because the view drives itself off
 * `deviceKeys`. Keeping the assignment in one place is what stops that recurring.
 */
function enterBiometricView(
  familyId: string,
  familyName: string | undefined,
  deviceKeys: PasskeyRegistration[]
) {
  biometricFamilyId.value = familyId;
  biometricFamilyName.value = familyName;
  biometricDeviceKeys.value = deviceKeys;
  activeView.value = 'biometric';
}

async function handleBiometricAvailable(payload: { familyId: string; familyName?: string }) {
  // LoadPodView tells us biometric is possible for this family, but not WHICH members —
  // it only knows the boolean. Resolve the keys here so the view is never handed an
  // empty list.
  const deviceKeys = await authStore.resolveDeviceKeysForFamily(payload.familyId);
  if (deviceKeys.length === 0) {
    // Raced with a revocation/invalidation between LoadPodView's check and now. Falling
    // into the biometric view would strand the user on a dead button.
    logBiometricRouting('pick_bean', 'keys_vanished');
    activeView.value = 'pick-bean';
    return;
  }
  enterBiometricView(payload.familyId, payload.familyName, deviceKeys);
}

/**
 * Triggered from LoadPodView's NoPodEmptyState panel when a Drive lookup
 * returned zero pods. The user picked "Create a new pod" instead — route
 * them into the create flow without going back through WelcomeGate.
 */
function handleRequestCreate() {
  activeView.value = 'create';
}

/**
 * Desktop create hand-off: CreatePodView connected storage (popup / local file)
 * and is done. Flip to the shared finish surface (ResumePodSetup) where the
 * password is entered once and members are added. A direct `activeView` flip —
 * NOT a `router.replace` — so the freshly-installed `syncStore` provider/token
 * stay live in the store and the finish surface writes straight into them
 * without re-connecting. (iOS reaches the same surface via the Drive redirect
 * return + the `?resume=setup` watchEffect, not this handler.)
 */
function handleFinishStorage() {
  activeView.value = 'resume-setup';
}

function handleFileLoaded() {
  activeView.value = 'pick-bean';
}

function handleBiometricFallback(context?: {
  crossDevice: true;
  memberId: string;
  credentialId?: string;
}) {
  biometricDeclined.value = true;
  crossDeviceContext.value = context ?? null;

  // WHERE "use my password instead" goes depends on whether the pod is still locked.
  // Since #76 this view is also reached with the pod ALREADY DECRYPTED (biometric is
  // offered there to identify the member, not to decrypt). Sending that case to
  // LoadPodView would ask the user to load and decrypt a pod that is already open —
  // the wrong surface entirely. The member picker is where they belong: pick a bean,
  // type that bean's password. That IS requirement 4's path.
  if (!syncStore.hasPendingEncryptedFile) {
    activeView.value = 'pick-bean';
    return;
  }

  autoLoadPod.value = syncStore.isConfigured && !syncStore.needsPermission;
  needsPermissionGrant.value = syncStore.isConfigured && syncStore.needsPermission;
  activeView.value = 'load-pod';
}

/**
 * "Not you?" — the escape hatch from an auto-entered account. Same destination logic as
 * the password fallback (an already-open pod goes back to the bean picker, not to a load
 * surface), plus the metric that tells us how often auto-enter picked the wrong member.
 *
 * That rate is what says whether the always-auto-enter policy was the right call on
 * shared devices, so it has to exist from day one rather than be added after a complaint.
 */
function handleBiometricBack() {
  logEvent({
    level: 'info',
    surface: 'native-biometric',
    message: 'not_you_used',
    context: {
      action: 'not_you',
      detail: isSingleFamilyAutoSelect.value ? 'auto_select' : 'family_picker',
    },
  });

  if (!syncStore.hasPendingEncryptedFile) {
    activeView.value = 'pick-bean';
    return;
  }
  activeView.value = isSingleFamilyAutoSelect.value ? 'welcome' : 'family-picker';
}

function handleSignedIn(destination: string) {
  // Single canonical arm-and-register point for EVERY entry path — create,
  // load, join, reconnect. SetupProgressModal no longer calls these (it used to,
  // causing a duplicate registry write on every create); they live here so the
  // de-dup holds for all flows. `setupAutoSync` is idempotent; `ensureRegistered`
  // is a no-op when the pod is already registered (createNewFile registers it).
  syncStore.setupAutoSync();
  // Sole genuine login/resume registration site → stamp lastLoginAt (see
  // ensureRegistered). The country watcher's ensureRegistered() stays login-false.
  syncStore.ensureRegistered(true);
  router.replace(destination);
}

/** "Start over instead" from the resume-setup screen — abandon the half-finished onboarding. */
async function handleStartOver() {
  await authStore.signOut();
  activeView.value = 'welcome';
  await router.replace('/welcome');
}
</script>

<template>
  <LoginBackground>
    <!-- Loading state during initialization -->
    <div v-if="isInitializing" class="py-12 text-center">
      <div
        class="border-t-primary-500 mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300"
      ></div>
    </div>

    <template v-else>
      <FamilyPickerView
        v-if="activeView === 'family-picker'"
        @back="activeView = 'welcome'"
        @family-selected="handleFamilySelected"
        @load-different-file="handleLoadDifferentFile"
      />

      <BiometricLoginView
        v-else-if="activeView === 'biometric'"
        :family-id="biometricFamilyId"
        :family-name="biometricFamilyName"
        :device-keys="biometricDeviceKeys"
        @signed-in="handleSignedIn"
        @use-password="handleBiometricFallback"
        @back="handleBiometricBack"
      />

      <WelcomeGate v-else-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <!-- REVIEW-DEMO: overlay, not a view. -->
      <ReviewDemoCodeModal v-if="showReviewDemoModal" @close="showReviewDemoModal = false" />

      <!-- Branded loading spinner during auto-load -->
      <div
        v-else-if="activeView === 'loading'"
        class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800"
      >
        <div class="py-12 text-center">
          <img
            src="/brand/beanies_family_icon_transparent_384x384.png"
            alt=""
            class="mx-auto mb-4 h-16 w-16"
          />
          <div
            class="border-t-primary-500 mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300"
          ></div>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('auth.loadingFile') }}</p>
        </div>
      </div>

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        :auto-open-drive-picker="autoOpenDrivePicker"
        :skip-biometric="biometricDeclined"
        :force-new-google-account="forceNewGoogleAccount"
        :load-error="loadError"
        :provider-hint="loadErrorProviderHint"
        :reconnect-drive-file="reconnectDriveFile"
        :cross-device-context="crossDeviceContext"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
        @file-loaded="handleFileLoaded"
        @signed-in="handleSignedIn"
        @biometric-available="handleBiometricAvailable"
        @request-create="handleRequestCreate"
      />

      <PickBeanView
        v-else-if="activeView === 'pick-bean'"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
        @signed-in="handleSignedIn"
      />

      <div v-else-if="activeView === 'create'" class="relative">
        <div :class="{ 'pointer-events-none blur-[0.1px]': inviteGateLocked }">
          <CreatePodView
            @back="activeView = 'welcome'"
            @signed-in="handleSignedIn"
            @navigate="handleNavigate"
            @finish-storage="handleFinishStorage"
          />
        </div>
        <!-- Optional invite gate: retained, flag-gated (off in prod). Outranks the welcome intro. -->
        <InviteGateOverlay
          v-if="inviteGateLocked"
          @unlocked="inviteGateLocked = false"
          @cancel="activeView = 'welcome'"
        />
        <!-- Welcome intro: shown once the gate (if any) is passed. -->
        <CreatePodWelcome
          v-else-if="showCreateWelcome"
          @dismiss="showCreateWelcome = false"
          @cancel="activeView = 'welcome'"
        />
      </div>

      <ResumePodSetup
        v-else-if="activeView === 'resume-setup'"
        @signed-in="handleSignedIn"
        @start-over="handleStartOver"
      />

      <JoinPodView
        v-else-if="activeView === 'join'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
        @navigate="handleNavigate"
      />
    </template>

    <template #below-card>
      <LoginSecurityFooter />
    </template>
  </LoginBackground>
</template>
