<script setup lang="ts">
import { ref, onMounted, watch, watchEffect } from 'vue';
import { PayloadLoadError, payloadErrorMessageKey } from '@/types/sync';
import { reportPayloadFailure } from '@/utils/payloadFailureSurface';
import type { WatchStopHandle } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LoginBackground from '@/components/login/LoginBackground.vue';
import LoginSecurityFooter from '@/components/login/LoginSecurityFooter.vue';
import WelcomeGate from '@/components/login/WelcomeGate.vue';
// REVIEW-DEMO: access-code entry for store-review demo mode.
import ReviewDemoCodeModal from '@/components/login/ReviewDemoCodeModal.vue';
import FamilyPickerView from '@/components/login/FamilyPickerView.vue';
import LoadPodView from '@/components/login/LoadPodView.vue';
import PersonSelectView from '@/components/login/PersonSelectView.vue';
import ProveView from '@/components/login/ProveView.vue';
import OpenRecoveryPanel from '@/components/login/OpenRecoveryPanel.vue';
import CreatePodView from '@/components/login/CreatePodView.vue';
import ResumePodSetup from '@/components/login/ResumePodSetup.vue';
import JoinPodView from '@/components/login/JoinPodView.vue';
import InviteGateOverlay from '@/components/login/InviteGateOverlay.vue';
import CreatePodWelcome from '@/components/login/CreatePodWelcome.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { isNavigationCancelled } from '@/utils/appChrome';
import { features } from '@/config/features';
import { useSyncStore } from '@/stores/syncStore';
import { useLoginFlow } from '@/composables/useLoginFlow';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { getProviderConfig } from '@/services/sync/fileHandleStore';
import type { PersistedProviderConfig } from '@/services/sync/fileHandleStore';
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
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

type LoginView =
  | 'welcome'
  | 'loading'
  | 'load-pod'
  | 'flow'
  | 'create'
  | 'resume-setup'
  | 'join'
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
const forceNewGoogleAccount = ref(false);
/** The prove screen's "use a recovery kit" escape — opens LoadPodView in kit entry. */
const kitEntryRequested = ref(false);
/** Code carried by the kit QR deep link (fragment — never sent to a server). */
const kitPrefillCode = ref('');
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

// ── The login-flow machine (2026-08-28 rethink) ─────────────────────────────
// LoginPage is a thin renderer over it for the returning-user path: 'flow' view
// renders whatever state the machine is in; every routing decision lives in
// loginFlow.ts + useLoginFlow, not here.
const flow = useLoginFlow({
  onSignedIn: (destination) => handleSignedIn(destination),
  onExit: () => {
    // BACK out of the person picker / recovery — same destinations the old
    // pick-bean/biometric back handlers used.
    if (activeView.value === 'flow') {
      activeView.value = isSingleFamilyAutoSelect.value ? 'welcome' : 'family-picker';
    }
  },
});
const flowState = flow.state;
const flowError = flow.proveError;
const flowBusy = flow.isBusy;

/**
 * Enter the machine for a family; falls back to the legacy bootstrap surface when this
 * device has no person list at all (fresh device — load the file, decrypt, identity
 * inferred from the password).
 */
async function enterFlow(familyId: string, familyName: string): Promise<boolean> {
  const ok = await flow.startForFamily(familyId, familyName);
  if (ok) activeView.value = 'flow';
  return ok;
}

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

    // Kit QR deep link: a phone camera pointed at the printed recovery kit lands here
    // with the code in the URL FRAGMENT (never sent to a server). Strip it immediately
    // (history hygiene) and open the bootstrap surface straight in kit entry, code
    // pre-filled.
    const kitHashMatch = window.location.hash.match(/beanies-kit=([^&]+)/);
    if (kitHashMatch?.[1]) {
      const { parseKitInput } = await import('@/services/auth/recoveryKit');
      kitPrefillCode.value = parseKitInput(decodeURIComponent(kitHashMatch[1]));
      history.replaceState(null, '', window.location.pathname + window.location.search);
      enterGenericLoadFallback(undefined, { autoLoad: true, withError: false });
      kitEntryRequested.value = true; // after the reset inside enterGenericLoadFallback
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
      // 2026-08-28 rethink (review F9): a device with a person list must get the machine
      // (and its biometric offer) even on the /open "Open with beanies.family" gesture —
      // the envelope names the family, and ensureStaged already handles the pending file.
      const envelope = syncStore.pendingEncryptedFile?.envelope;
      if (envelope?.familyId && (await enterFlow(envelope.familyId, envelope.familyName ?? ''))) {
        isInitializing.value = false;
        return;
      }
      autoLoadPod.value = true;
      activeView.value = 'load-pod';
      isInitializing.value = false;
      return;
    }

    // Single-family fast login: skip WelcomeGate + FamilyPicker
    const allFamilies = familyContextStore.allFamilies;
    const singleFamily = allFamilies.length === 1 ? allFamilies[0] : undefined;
    if (singleFamily) {
      const providerConfig = await getProviderConfig(singleFamily.id);
      isSingleFamilyAutoSelect.value = true;
      // Keep the spinner up until handleFamilySelected has chosen a view. Clearing it
      // first painted the full WelcomeGate for the whole duration of the Drive fetch,
      // then swapped it out — a flash of the exact screen this fast path exists to skip.
      await handleFamilySelected({
        id: singleFamily.id,
        name: singleFamily.name ?? 'My Family',
        providerConfig,
      });
      isInitializing.value = false;
      return;
    }
  } else {
    // Members already loaded (e.g. navigated back) — the machine renders the picker.
    await enterFlow(
      familyContextStore.activeFamilyId ?? '',
      familyContextStore.activeFamilyName ?? ''
    );
  }

  isInitializing.value = false;
});

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
 * navigation. Does NOT touch `forceNewGoogleAccount` — that's an orthogonal
 * "force the account chooser" flag the caller manages.
 */
function resetLoadPodFlags() {
  kitEntryRequested.value = false;
  autoLoadPod.value = false;
  needsPermissionGrant.value = false;
  loadError.value = undefined;
  loadErrorProviderHint.value = undefined;
  reconnectDriveFile.value = undefined;
}

/**
 * Show LoadPodView's generic provider+file picker with an error for `hint`.
 *
 * `opts` covers the two variants that were previously open-coded as near-identical
 * four-ref assignment blocks: `needsPermission` for a denied file-handle grant (which
 * shows the permission UI and has no error text), and `autoLoad` for the encrypted-file
 * decrypt modal. Routing all of them through here makes an inconsistent flag combination
 * structurally impossible — `resetLoadPodFlags` clears every flag first, so a caller can
 * only ever turn ON what it names.
 */
function enterGenericLoadFallback(
  hint: 'local' | 'google_drive' | undefined,
  opts: {
    needsPermission?: boolean;
    autoLoad?: boolean;
    withError?: boolean;
    /** An explicit message, when the generic provider copy would be a lie. */
    message?: string;
  } = {}
) {
  const { needsPermission = false, autoLoad = false, withError = true, message } = opts;
  resetLoadPodFlags();
  if (message) loadError.value = message;
  else if (withError) loadError.value = providerErrorMessage(hint);
  loadErrorProviderHint.value = hint;
  needsPermissionGrant.value = needsPermission;
  autoLoadPod.value = autoLoad;
  activeView.value = 'load-pod';
}

/**
 * Handle family selection from FamilyPickerView (and the single-family fast path).
 *
 * The 2026-08-28 rethink: this routes to the MACHINE first (`enterFlow` — person picker
 * from the roster/credential records, prove, open), and only falls back to the legacy
 * bootstrap load surface when this device has no person list at all (a genuinely fresh
 * device). All the "biometric or password?" routing that used to live here is gone —
 * `resolveProveMethods` is the single decision engine now.
 */
async function handleFamilySelected(payload: {
  id: string;
  name: string;
  providerConfig: PersistedProviderConfig | null;
}) {
  // Clear any stale LoadPodView intent (incl. reconnectDriveFile) before routing.
  resetLoadPodFlags();

  // Spinner up FIRST: startForFamily can do real work before it resolves (silent token
  // refresh + Drive fetch on the trusted-device auto-open path — 5-10s cold). Leaving
  // the family picker on screen for that window looked like a freeze.
  activeView.value = 'loading';

  // The machine path: any person list at all → person-select → prove → open.
  // (startForFamily also performs the family-context switch.)
  if (await enterFlow(payload.id, payload.name)) return;

  // Bootstrap: no roster, no credential records — a fresh device. Load the file;
  // identity is inferred from the password (tryUnwrapFamilyKey), as it always was.
  if (syncStore.isConfigured && !syncStore.needsPermission) {
    activeView.value = 'loading';
    try {
      const loadResult = await syncStore.loadFromFile();
      if (loadResult.success) {
        // Loaded (unencrypted or auto-decrypted) — the roster is live now.
        await handleFileLoaded();
      } else if (loadResult.needsPassword) {
        // Encrypted — try the trusted-device cached key first.
        if (await flow.tryCachedKeyDecrypt(payload.id)) {
          await handleFileLoaded();
        } else {
          // Can't auto-decrypt — LoadPodView's decrypt modal.
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
          // Silent reconnect BEFORE prompting (2026-06-19, cluster 2): the cold-start
          // silent refresh can fail/time out on the first try and surface a needless
          // reconnect prompt even though data wasn't cleared. Retry silently.
          const recovered = await tryReconnectSilently(syncStore.providerAccountEmail ?? undefined);
          if (recovered) {
            autoLoadPod.value = true;
            needsPermissionGrant.value = false;
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
    } catch (e) {
      // A payload failure must not be swallowed into a generic fallback: the
      // load-pod screen would then ask for a credential that cannot help. Let
      // `LoadPodView` classify it on the way in.
      if (e instanceof PayloadLoadError) {
        reportPayloadFailure(e, {
          source: 'boot',
          fileId: syncStore.driveFileId ?? null,
          familyId: payload.id,
        });
        enterGenericLoadFallback(toProviderHint(payload.providerConfig), {
          message: t(payloadErrorMessageKey(e)),
        });
        return;
      }
      // Unexpected throw (file moved/deleted/corrupt, etc.) — generic fallback.
      enterGenericLoadFallback(toProviderHint(payload.providerConfig));
    }
  } else if (syncStore.isConfigured && syncStore.needsPermission) {
    // File configured but needs permission — go to load-pod with permission grant UI
    enterGenericLoadFallback(toProviderHint(payload.providerConfig), {
      needsPermission: true,
      withError: false,
    });
  } else {
    // No file configured — go to load-pod for manual selection
    enterGenericLoadFallback(undefined, { withError: false });
  }
}

/**
 * Handle "Load a different file" from FamilyPickerView.
 * Forces Google account chooser when loading via Drive.
 */
function handleLoadDifferentFile() {
  resetLoadPodFlags();
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

  resetLoadPodFlags();
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

/**
 * The prove screen's recovery escape: leave the machine and open the bootstrap surface
 * straight in recovery-kit entry (stages the file, shows the kit-code form; password
 * stays one tap away).
 */
function handleUseRecoveryKit() {
  enterGenericLoadFallback(undefined, { autoLoad: true, withError: false });
  kitEntryRequested.value = true; // AFTER the reset (resetLoadPodFlags clears it)
  flow.dispatch({ type: 'EXIT' }); // activeView is already 'load-pod' -> onExit no-ops
}

/**
 * A bootstrap load finished (LoadPodView emitted `file-loaded`): the pod is open, the
 * roster is live — hand over to the machine, which renders the person picker from it.
 */
async function handleFileLoaded(source?: 'recovery') {
  // Same spinner rule: the flow hand-off can take a beat (roster build, live members).
  activeView.value = 'loading';
  const ok = await enterFlow(
    familyContextStore.activeFamilyId ?? '',
    familyContextStore.activeFamilyName ?? ''
  );
  if (!ok) {
    // A loaded pod with zero human members is a data problem, not a routing one —
    // surface the welcome gate rather than a blank flow screen.
    reportError({
      surface: 'login-flow',
      message: 'file loaded but no person list could be built',
      severity: 'warning',
      context: { action: 'post_load_no_people' },
    });
    activeView.value = 'welcome';
    return;
  }
  // Armed AFTER the flow entered: a family-level recovery secret opened the pod, so the
  // prove screen offers set-a-new-PIN instead of demanding forgotten credentials.
  flow.recoveryMode.value = source === 'recovery';
}

/**
 * Phase 4 device link redeemed: the linked family's pod is open in memory — enter the
 * standard machine (person picker; the member proves with their doc-synced PIN or
 * taps through). Falls back to the welcome gate if the machine can't start.
 */
async function handleLinkReady(familyId: string, familyName: string) {
  activeView.value = 'loading';
  if (await enterFlow(familyId, familyName)) return;
  activeView.value = 'welcome';
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

      <!-- The login-flow machine renderer: state.kind → view (2026-08-28 rethink) -->
      <template v-else-if="activeView === 'flow'">
        <PersonSelectView
          v-if="flowState.kind === 'person-select'"
          :family-name="flowState.familyName"
          :people="flowState.people"
          @pick="flow.onPickPerson"
          @back="flow.dispatch({ type: 'BACK' })"
        />
        <ProveView
          v-else-if="flowState.kind === 'prove'"
          :family-name="flowState.familyName"
          :person="flowState.person"
          :methods="flowState.methods"
          :error="flowError"
          :is-busy="flowBusy"
          :pod-open="familyStore.members.length > 0"
          :recovery-mode="flow.recoveryMode.value"
          :has-passphrase="!!syncStore.pendingEncryptedFile?.envelope?.recoveryPassphrase"
          @biometric="flow.onBiometric"
          @tap-through="flow.onTapThrough"
          @pin="flow.onPinSubmit"
          @password="flow.onPasswordSubmit"
          @fell-back="flow.onFellBack"
          @use-recovery="handleUseRecoveryKit"
          @reset-pin="flow.onResetPin"
          @back="flow.dispatch({ type: 'BACK' })"
        />
        <OpenRecoveryPanel
          v-else-if="flowState.kind === 'open-recovery'"
          :reason="flowState.reason"
          :family-name="flowState.resume.familyName"
          :proven="flowState.grant !== null"
          :error="flowError"
          :is-busy="flowBusy"
          @reconnect="flow.onRecoveryReconnect"
          @grant-permission="flow.onRecoveryGrantPermission"
          @retry="flow.onRecoveryRetry"
          @use-bootstrap="enterGenericLoadFallback(undefined, { withError: false })"
          @back="flow.dispatch({ type: 'BACK' })"
        />
        <!-- prove-loading / opening / done: brief transitions — branded spinner -->
        <div
          v-else
          class="dark:bg-surface-raised mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl"
        >
          <div class="py-12 text-center">
            <div
              class="border-t-primary-500 mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300"
            ></div>
            <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('auth.loadingFile') }}</p>
          </div>
        </div>
      </template>

      <WelcomeGate v-else-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <!-- REVIEW-DEMO: overlay, not a view. -->
      <ReviewDemoCodeModal v-if="showReviewDemoModal" @close="showReviewDemoModal = false" />

      <!-- Branded loading spinner during auto-load -->
      <div
        v-else-if="activeView === 'loading'"
        class="dark:bg-surface-raised mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl"
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
          <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('auth.loadingFile') }}</p>
        </div>
      </div>

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        :auto-open-drive-picker="autoOpenDrivePicker"
        :force-new-google-account="forceNewGoogleAccount"
        :load-error="loadError"
        :provider-hint="loadErrorProviderHint"
        :reconnect-drive-file="reconnectDriveFile"
        :start-in-kit-entry="kitEntryRequested"
        :prefill-kit-code="kitPrefillCode"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
        @file-loaded="handleFileLoaded"
        @signed-in="handleSignedIn"
        @request-create="handleRequestCreate"
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
        @use-recovery="handleUseRecoveryKit"
      />

      <JoinPodView
        v-else-if="activeView === 'join'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
        @navigate="handleNavigate"
        @link-ready="handleLinkReady"
      />
    </template>

    <template #below-card>
      <LoginSecurityFooter />
    </template>
  </LoginBackground>
</template>
