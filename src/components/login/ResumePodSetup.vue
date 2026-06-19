<script setup lang="ts">
/**
 * Resume-setup recovery screen.
 *
 * Reached at `/welcome?resume=setup` when an authenticated session exists
 * but the local IndexedDB state says the user has no pod yet
 * (`authStore.podCreated === '0'`). Two real-world scenarios produce this:
 *
 *  (a) The user genuinely never finished the create-pod wizard — left mid-
 *      flow, or the iOS OAuth redirect interrupted before `createNewFile`
 *      ran. There IS no `.beanpod` file on Drive yet; we must create one.
 *
 *  (b) The user finished setup, then iOS Safari evicted the IndexedDB
 *      `providerConfig-<familyId>` row (7-day partition, storage pressure,
 *      etc.). Their `.beanpod` file is still on Drive, but the app can't
 *      find it locally. The PREVIOUS recovery logic always called
 *      `createNewFile` here, which generated a fresh family key and wrote
 *      a new envelope over (or alongside) the real one — destroying the
 *      user's data (the Shaun-class incident on 2026-05-15).
 *
 * The fix: query the DynamoDB family registry first. The registry tracks
 * `fileId` per family (written atomically inside `createNewFile` since the
 * 2026-05-15 hotfix). If we find an existing `fileId`, we route through the
 * non-destructive auto-load path:
 *
 *    attemptResumeFromRegistry() → 'auto-loadable' ⇒ render password phase
 *      → completeAutoLoad(password) → success ⇒ markPodCreated, route /nook
 *
 * If the registry has nothing, we fall through to the previous (destructive)
 * create-pod flow, which is the correct behaviour for scenario (a).
 *
 * UI is a flat `switch` on the orchestrator's discriminated result kinds —
 * see `src/types/sync.ts`. The store layer owns all the recovery logic so
 * each branch in this file is one render path with one action.
 */
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { resolveDriveCollision } from '@/composables/useDriveCollisionRecovery';
import { canUseLocalFiles } from '@/services/sync/capabilities';
import { isTokenValid, isUserCancellation } from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';
import { confirm } from '@/composables/useConfirm';
import {
  consumeResumeReason,
  hasPendingCreate,
  loadPendingCreate,
  consumePendingCreatePassword,
  clearPendingCreate,
} from '@/components/login/resumePaths';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const fatalErrorStore = useFatalErrorStore();

const emit = defineEmits<{
  'signed-in': [destination: string];
  /** "Start over instead" — sign out + return to the welcome gate. */
  'start-over': [];
}>();

/**
 * Discriminated UI phases. `probing` is the initial registry-check;
 * `auto-load` is the non-destructive happy path; `identity` + `storage` are
 * the original destructive-recreate flow we fall back to when there is no
 * registered pod (genuinely-new families). `finishing` is the spinner shown
 * during a critical write — both auto-load decrypt and create-pod write.
 */
type Phase = 'probing' | 'auto-load' | 'identity' | 'storage' | 'finishing' | 'retry';
const phase = ref<Phase>('probing');

const ownerName = ref('');
const password = ref('');
const confirmPassword = ref('');
const formError = ref<string | null>(null);
const busy = ref(false);
const showLocalFileWarning = ref(false);
// Set once we've kicked off navigation to /nook — keeps the `finally` blocks
// from flashing the storage picker back on during the route transition.
const navigatedAway = ref(false);

// Auto-load phase metadata (populated when registry lookup says 'auto-loadable').
const autoLoadFamilyName = ref<string>('');
const autoLoadLastSaved = ref<string | null>(null);

const familyName = computed(() => familyContextStore.activeFamilyName || 'your family');

const lastSavedDisplay = computed(() => {
  if (!autoLoadLastSaved.value) return null;
  try {
    const d = new Date(autoLoadLastSaved.value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
});

onMounted(async () => {
  // The family itself still exists in IndexedDB even if the in-memory context
  // wasn't initialized (App.vue short-circuits before that for !podCreated).
  // Caught at warning severity — degraded, not fatal: we fall back to a
  // generic family name and `attemptResumeFromRegistry` falls back to the
  // user.familyId from authStore.currentUser.
  if (!familyContextStore.activeFamilyId && authStore.currentUser?.familyId) {
    try {
      await familyContextStore.switchFamily(authStore.currentUser.familyId);
    } catch (e) {
      console.warn('[ResumePodSetup] could not load family context for resume', e);
      reportError({
        surface: 'resumeSetup.loadFamilyContext',
        message: `Could not load family context during resume: ${e instanceof Error ? e.message : String(e)}`,
        error: e,
        severity: 'warning',
      });
    }
  }

  // Pre-fill the name field. `authStore.displayName` resolves to the cached
  // `currentUser.displayName` (set by signUp) when the doc isn't loaded yet.
  ownerName.value = authStore.displayName;

  // ── Create-resume fast-path (2026-06-19) ──────────────────────────────────
  // If we just returned from the iOS/native Drive redirect MID-create-wizard,
  // finish the create directly instead of dropping into the generic recovery
  // flow (which would re-ask for the password). Only when we hold a fresh token
  // (a successful consent return). Restore the owner name + the atomically-
  // consumed password (and mirror confirmPassword so the existing
  // `validateIdentity()` inside handleIdentityNext passes), then reuse the
  // EXISTING handleIdentityNext() chain (rehydrateOwnerDoc → finishOnDrive →
  // finalizePod → createNewFile, incl. adopt-existing collision recovery). A
  // single try/finally clears the pending blob on EVERY resolution so no
  // password is ever left at rest.
  if (hasPendingCreate()) {
    if (isTokenValid()) {
      const pending = loadPendingCreate();
      const pw = consumePendingCreatePassword(); // atomic read-and-delete
      if (pw) {
        if (pending?.ownerName) ownerName.value = pending.ownerName;
        password.value = pw;
        confirmPassword.value = pw;
        try {
          await handleIdentityNext();
        } finally {
          clearPendingCreate();
        }
        return; // create-resume handled — skip the generic probe
      }
    }
    // No valid token (consent denied / token lapsed) or no stored password:
    // abandon the silent resume and fall through to the generic flow (which
    // surfaces any consent hint + lets the user reconnect). Never leave the
    // password at rest.
    clearPendingCreate();
  }

  await runProbe();

  // Surface a specific hint if we arrived here because Google file access was
  // denied on the consent screen (2026-06-19, finding 3). Set after runProbe so
  // it isn't cleared by the probe's `formError = null`. The reconnect CTA is the
  // storage step's "Connect Google Drive" button.
  if (consumeResumeReason() === 'drive-consent') {
    formError.value = t('resumeSetup.driveConsentDenied');
  }
});

/**
 * Registry probe + phase routing. Extracted from onMounted so the `retry`
 * screen's "Try again" can re-run it.
 *
 * `no-registry-entry` → `identity` (genuinely-new family — create is correct).
 * `registry-error` / `load-failed` → `retry` (a pod fileId is/was known but we
 * couldn't reach it). We deliberately do NOT fall through to the destructive
 * create path here — re-creating would orphan the real pod (the 2026-05-15
 * incident). The retry screen offers a non-destructive re-probe, and an
 * explicit confirm-gated "start a new pod" for the rare genuine give-up.
 */
async function runProbe() {
  formError.value = null;
  phase.value = 'probing';
  const probeResult = await syncStore.attemptResumeFromRegistry();
  switch (probeResult.kind) {
    case 'auto-loadable':
      autoLoadFamilyName.value = probeResult.familyName;
      autoLoadLastSaved.value = probeResult.lastSaved;
      phase.value = 'auto-load';
      return;
    case 'no-registry-entry':
      // Scenario (a) — genuinely new family; fall through to the create flow.
      phase.value = 'identity';
      return;
    case 'redirecting':
      // The probe kicked off a full-page OAuth redirect (iOS/PWA, no valid
      // token) — the page is navigating to Google. Do nothing; we resume on
      // return (2026-06-19, finding 2). Leave the spinner up.
      return;
    case 'registry-error':
      reportError({
        surface: 'resumeSetup.registryLookupFailed',
        message: `Registry lookup failed during resume: ${probeResult.error.message}`,
        error: probeResult.error,
        severity: 'warning',
      });
      formError.value = t('resumeSetup.registryError');
      phase.value = 'retry';
      return;
    case 'load-failed':
      // Registry had a fileId but the Drive load failed (token denied, 404,
      // network). A real pod exists — offer a non-destructive retry, NOT the
      // create path.
      reportError({
        surface: 'resumeSetup.autoLoadFetchFailed',
        message: `Auto-load envelope fetch failed during resume: ${probeResult.error.message}`,
        error: probeResult.error,
        severity: 'error',
      });
      formError.value = t('resumeSetup.couldNotFindPod');
      phase.value = 'retry';
      return;
  }
}

/** "Try again" on the retry screen — re-run the registry probe. */
async function handleRetry() {
  if (busy.value) return;
  await runProbe();
}

/**
 * "Set up my family" on the retry screen — a non-destructive escape when the
 * registry is persistently unreachable (2026-06-19, finding 4). Previously this
 * was a danger-gated "start a new pod" trap: a genuinely-new user (no pod) could
 * only proceed through a scary destructive confirm. It is now SAFE because the
 * adopt-existing recovery protects the create path — if a real same-name pod
 * exists on Drive, `finishOnDrive` adopts/opens it instead of overwriting. So
 * this routes to the identity/create flow behind a reassuring INFO confirm
 * rather than a destructive one.
 */
async function handleStartNewPodFromRetry() {
  const ok = await confirm({
    title: 'resumeSetup.startNewConfirmTitle',
    message: 'resumeSetup.startNewConfirmMessage',
    variant: 'info',
    confirmLabel: 'resumeSetup.startNewConfirmCta',
  });
  if (!ok) return;
  formError.value = null;
  phase.value = 'identity';
}

// ─── Non-destructive auto-load path ─────────────────────────────────────────

async function handleAutoLoadSubmit() {
  formError.value = null;
  if (!password.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';

  try {
    const result = await syncStore.completeAutoLoad(password.value);
    switch (result.kind) {
      case 'success':
        navigatedAway.value = true;
        emit('signed-in', '/nook');
        return;
      case 'wrong-password':
        formError.value = t('auth.passwordIncorrect');
        phase.value = 'auto-load';
        return;
      case 'corrupted':
        // The decrypted bytes aren't a valid Automerge doc. Do NOT call
        // createNewFile — that's the exact bug that produced the original
        // data-loss incident. Surface the canonical fatal-error modal with
        // diagnostics so the user can contact support with a fileId.
        reportError({
          surface: 'resumeSetup.podCorrupted',
          message: `Pod payload failed Automerge ${result.error.step} during resume`,
          error: result.error,
          severity: 'critical',
          context: {
            file_id: result.fileId,
            family_id: result.familyId,
            corruption_step: result.error.step,
          },
        });
        fatalErrorStore.setFatal(
          t('resumeSetup.podCorrupted'),
          JSON.stringify(
            {
              fileId: result.fileId,
              familyId: result.familyId,
              corruptionStep: result.error.step,
              message: result.error.message,
            },
            null,
            2
          )
        );
        return;
      case 'network-error':
        reportError({
          surface: 'resumeSetup.autoLoadNetworkError',
          message: `Auto-load decrypt step failed during resume: ${result.error.message}`,
          error: result.error,
          severity: 'error',
        });
        formError.value = result.error.message || t('setup.fileCreateFailed');
        phase.value = 'auto-load';
        return;
    }
  } finally {
    busy.value = false;
    // If we didn't navigate away (every non-success branch), restore the
    // phase the user can act from. The phase switch in each branch above
    // already does this for non-success cases, so this is a safety net.
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'auto-load';
  }
}

// ─── Original destructive-recreate path (scenario (a) fallback) ─────────────

function validateIdentity(): boolean {
  formError.value = null;
  if (!ownerName.value || !password.value || !confirmPassword.value) {
    formError.value = t('auth.fillAllFields');
    return false;
  }
  if (password.value.length < 8) {
    formError.value = t('auth.passwordMinLength');
    return false;
  }
  if (password.value !== confirmPassword.value) {
    formError.value = t('auth.passwordsDoNotMatch');
    return false;
  }
  return true;
}

async function handleIdentityNext() {
  if (busy.value) return;
  if (!validateIdentity()) return;
  busy.value = true;
  try {
    const r = await authStore.rehydrateOwnerDoc(ownerName.value, password.value);
    if (!r.success) {
      formError.value = t('setup.fileCreateFailed');
      console.error('[ResumePodSetup] rehydrateOwnerDoc failed:', r.error);
      reportError({
        surface: 'resumeSetup.rehydrateOwner',
        message: r.error || 'Failed to rebuild owner member during resume',
        severity: 'error',
      });
      return;
    }
    // If we already hold a fresh Google token (just returned from a Drive
    // redirect), finish on Drive without bothering the user with a chooser.
    if (isTokenValid()) {
      phase.value = 'finishing';
      await finishOnDrive();
    } else {
      phase.value = 'storage';
    }
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error resuming setup', e);
    reportError({
      surface: 'resumeSetup.rehydrateOwner',
      message: `Unexpected error resuming setup: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('setup.fileCreateFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}

/** Step 2: write the pod file with the now-connected provider, then route to /nook. */
async function finalizePod(): Promise<boolean> {
  const user = authStore.currentUser;
  if (!user) {
    formError.value = t('setup.fileCreateFailed');
    reportError({
      surface: 'resumeSetup.finalize',
      message: 'finalizePod reached with no authenticated session',
      severity: 'critical',
    });
    return false;
  }
  const podFileName = `${familyContextStore.activeFamilyName || 'my-family'}.beanpod`;
  const result = await syncStore.createNewFile(
    podFileName,
    password.value,
    user.memberId,
    familyContextStore.activeFamilyId ?? user.familyId ?? '',
    familyContextStore.activeFamilyName ?? 'My Family'
  );
  if (!result.ok) {
    if (result.reason === 'existing-pod') {
      // The registry has a real pod after all — the create guard refused to
      // overwrite it. Route back to the non-destructive retry screen (re-probe
      // will now find the fileId and offer auto-load) rather than showing a
      // generic create-failure. Not a critical page — this is the guard working.
      console.warn('[ResumePodSetup] createNewFile refused (existing-pod) — routing to retry');
      reportError({
        surface: 'resumeSetup.existingPodRefused',
        message: `createNewFile refused during resume — existing pod present: ${result.error.message}`,
        error: result.error,
        severity: 'warning',
        context: { provider_type: syncStore.storageProviderType ?? null },
      });
      formError.value = t('resumeSetup.couldNotFindPod');
      phase.value = 'retry';
      return false;
    }
    formError.value = t('setup.fileCreateFailed');
    console.error(`[ResumePodSetup] createNewFile failed (reason=${result.reason}):`, result.error);
    reportError({
      surface: `resumeSetup.${result.reason}`,
      message: `createNewFile failed during resume at step '${result.reason}': ${result.error.message}`,
      error: result.error,
      severity: 'critical',
      context: { provider_type: syncStore.storageProviderType ?? null },
    });
    return false;
  }
  // setupAutoSync + ensureRegistered happen in LoginPage.handleSignedIn.
  navigatedAway.value = true;
  emit('signed-in', '/nook');
  return true;
}

async function finishOnDrive() {
  formError.value = null;
  const r = await connectDriveStorage(familyName.value, {
    googleEmail: authStore.currentUser?.email,
    activeFamilyId: familyContextStore.activeFamilyId,
  });
  if (r.status === 'redirecting') return; // page navigating to Google — nothing more to do
  if (r.status === 'failed') {
    // Adopt-existing recovery — the fix for the iOS dead-end loop (2026-06-19).
    // This is exactly where the orphaned-pod collision lands on iPhone.
    if (r.errorKind === 'name-collision' && r.collision) {
      const action = await resolveDriveCollision(r.collision, {
        familyName: familyContextStore.activeFamilyName || 'my-family',
        activeFamilyId: familyContextStore.activeFamilyId,
      });
      switch (action.kind) {
        case 'adopted-stub':
          await finalizePod(); // write the real pod into the adopted orphan
          return;
        case 'open-existing':
          await openExistingOnDrive(action.fileId);
          return;
        case 'declined':
          formError.value = t('createPod.duplicateFile');
          phase.value = 'storage';
          return;
        case 'reject-different-account':
          formError.value = t('createPod.duplicateFile');
          reportError({
            surface: 'resumeSetup.nameCollision',
            message: r.error,
            severity: 'warning',
            context: { provider_type: 'google_drive', collision_file_id: r.collision.fileId },
          });
          phase.value = 'storage';
          return;
        case 'failed':
          formError.value = action.error || t('googleDrive.authFailed');
          reportError({
            surface: 'resumeSetup.adoptExisting',
            message: action.error || 'adopt-existing recovery failed during resume',
            severity: 'critical',
            context: { provider_type: 'google_drive' },
          });
          phase.value = 'storage';
          return;
      }
    }
    if (r.errorKind === 'collision-check-unavailable') {
      formError.value = t('createPod.driveCheckUnavailable');
      phase.value = 'storage';
      return;
    }
    const cancelled = r.cancelled || isUserCancellation(r.error);
    if (cancelled) console.warn('[ResumePodSetup] Drive connect cancelled:', r.error);
    else console.error('[ResumePodSetup] Drive connect failed:', r.error);
    reportError({
      surface: 'resumeSetup.connectDrive',
      message: r.error || 'Google Drive connect failed during resume',
      severity: cancelled ? 'warning' : 'error',
      context: { provider_type: 'google_drive' },
    });
    // Translated copy only (finding 13): never assign the raw Drive message —
    // it's English-only and a name-collision message leaks an internal fileId.
    formError.value = t('googleDrive.authFailed');
    phase.value = 'storage';
    return;
  }
  await finalizePod();
}

/**
 * Open the account's own existing populated pod (the adopt-confirm "Open it"
 * path). Loads the file and routes to the password (`auto-load`) phase, reusing
 * the same machinery as the registry auto-load — never creates over the file.
 */
async function openExistingOnDrive(fileId: string): Promise<void> {
  const podFileName = `${familyContextStore.activeFamilyName || 'my-family'}.beanpod`;
  const result = await syncStore.loadFromGoogleDrive(fileId, podFileName);
  if (result.needsPassword) {
    autoLoadFamilyName.value = familyContextStore.activeFamilyName || familyName.value;
    phase.value = 'auto-load';
    return;
  }
  console.error('[ResumePodSetup] open-existing load did not reach password step:', result);
  reportError({
    surface: 'resumeSetup.openExisting',
    message: `open-existing load failed: ${result.reason ?? syncStore.error ?? 'unknown'}`,
    severity: 'error',
    context: { provider_type: 'google_drive' },
  });
  formError.value = t('setup.fileCreateFailed');
  phase.value = 'storage';
}

async function handleConnectDrive() {
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';
  try {
    await finishOnDrive();
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error connecting Drive', e);
    reportError({
      surface: 'resumeSetup.connectDrive',
      message: `Unexpected error connecting Drive during resume: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('googleDrive.authFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}

function handleLocalFileClick() {
  showLocalFileWarning.value = true;
}

async function handleConnectLocal() {
  showLocalFileWarning.value = false;
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';
  try {
    const r = await connectLocalStorage();
    if (r.status === 'failed') {
      if (r.errorKind === 'unsupported-browser') {
        // Firefox/Safari lack the File System Access API — retrying is futile.
        // Show an actionable message (use Drive, or Chrome/Edge); no report.
        console.warn('[ResumePodSetup] local file unsupported in this browser:', r.error);
        formError.value = t('setup.localFileUnsupported');
      } else if (!r.cancelled) {
        console.error('[ResumePodSetup] local file selection failed:', r.error);
        reportError({
          surface: 'resumeSetup.selectLocalFile',
          message: r.error || 'Local file selection failed during resume',
          severity: 'error',
          context: { provider_type: 'local' },
        });
        formError.value = t('setup.fileCreateFailed');
      }
      phase.value = 'storage';
      return;
    }
    await finalizePod();
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error with local file', e);
    reportError({
      surface: 'resumeSetup.selectLocalFile',
      message: `Unexpected error selecting a local file during resume: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('setup.fileCreateFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}
</script>

<template>
  <div
    class="mx-auto max-w-[480px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl dark:bg-slate-800 dark:from-slate-800 dark:to-slate-800"
  >
    <div class="mb-2 text-center">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mx-auto h-[80px] w-[80px]"
      />
    </div>

    <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
      {{ t('resumeSetup.title') }}
    </h2>
    <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('resumeSetup.subtitle') }}
    </p>

    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Initial probe — short, only visible while the registry lookup runs. -->
    <div v-if="phase === 'probing'" class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('resumeSetup.checking') }}</p>
    </div>

    <!-- Auto-load (non-destructive): registry knew this family had a pod. -->
    <form
      v-else-if="phase === 'auto-load'"
      class="space-y-4"
      @submit.prevent="handleAutoLoadSubmit"
    >
      <div
        class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-slate-700/50 dark:text-gray-300"
      >
        🫘 {{ autoLoadFamilyName || familyName }}
        <span v-if="lastSavedDisplay" class="block text-xs text-gray-500 dark:text-gray-400">
          {{ t('resumeSetup.lastSaved') }} {{ lastSavedDisplay }}
        </span>
      </div>
      <p class="text-center text-sm text-gray-600 dark:text-gray-300">
        {{ t('resumeSetup.foundPod') }}
      </p>
      <BaseInput
        v-model="password"
        :label="t('loginV6.signInPasswordLabel')"
        type="password"
        :placeholder="t('auth.passwordPlaceholder')"
        required
        @input="formError = null"
      />
      <BaseButton type="submit" class="w-full" :disabled="busy" :loading="busy">
        {{ t('resumeSetup.unlockPod') }}
      </BaseButton>
    </form>

    <!-- Retry: a real pod fileId is/was known but we couldn't reach it. Offer a
         non-destructive re-probe; "start a new pod" is confirm-gated + secondary. -->
    <div v-else-if="phase === 'retry'" class="space-y-4">
      <div
        class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-slate-700/50 dark:text-gray-300"
      >
        🫘 {{ familyName }}
      </div>
      <p class="text-center text-sm text-gray-600 dark:text-gray-300">
        {{ t('resumeSetup.retryBody') }}
      </p>
      <BaseButton class="w-full" :disabled="busy" :loading="busy" @click="handleRetry">
        {{ t('resumeSetup.retryCta') }}
      </BaseButton>
      <button
        type="button"
        class="w-full text-center text-xs text-gray-500 underline decoration-1 underline-offset-4 transition-colors hover:text-gray-700 disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-200"
        :disabled="busy"
        @click="handleStartNewPodFromRetry"
      >
        {{ t('resumeSetup.startNewCta') }}
      </button>
    </div>

    <!-- Identity (fallback for scenario (a)) -->
    <form v-else-if="phase === 'identity'" class="space-y-4" @submit.prevent="handleIdentityNext">
      <div
        class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-slate-700/50 dark:text-gray-300"
      >
        🫘 {{ familyName }}
      </div>
      <BaseInput
        v-model="ownerName"
        :label="t('setup.yourName')"
        :placeholder="t('family.enterName')"
        required
        @input="formError = null"
      />
      <BaseInput
        v-model="password"
        :label="t('loginV6.signInPasswordLabel')"
        type="password"
        :placeholder="t('auth.passwordPlaceholder')"
        required
        @input="formError = null"
      />
      <BaseInput
        v-model="confirmPassword"
        :label="t('auth.confirmPassword')"
        type="password"
        :placeholder="t('auth.confirmPasswordPlaceholder')"
        required
        @input="formError = null"
      />
      <BaseButton type="submit" class="w-full" :disabled="busy" :loading="busy">
        {{ t('action.continue') }}
      </BaseButton>
    </form>

    <!-- Storage (fallback for scenario (a)) -->
    <div v-else-if="phase === 'storage'" class="space-y-3">
      <p class="font-outfit text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ t('resumeSetup.storagePrompt') }}
      </p>
      <BaseButton
        v-if="syncStore.isGoogleDriveAvailable"
        class="w-full"
        :disabled="busy"
        @click="handleConnectDrive"
      >
        {{ t('storage.connectGoogleDrive') }}
      </BaseButton>
      <!-- Local file only where the File System Access API exists (Chromium
           desktop / native). On iOS WebKit + Firefox it dead-ends; hide it when
           Drive is available, or show a clear message in the self-host case. -->
      <BaseButton
        v-if="canUseLocalFiles()"
        variant="outline"
        class="w-full"
        :disabled="busy"
        @click="handleLocalFileClick"
      >
        {{
          syncStore.isGoogleDriveAvailable ? t('storage.useLocalInstead') : t('storage.localFile')
        }}
      </BaseButton>
      <p
        v-else-if="!syncStore.isGoogleDriveAvailable"
        class="text-center text-xs text-gray-500 dark:text-gray-400"
      >
        {{ t('selfHost.localUnsupported') }}
      </p>
    </div>

    <!-- Finishing (in-flight critical write — auto-load decrypt or create-pod) -->
    <div v-else class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('resumeSetup.finishing') }}</p>
    </div>

    <!-- Start over (always available except during a critical write) -->
    <div v-if="phase !== 'finishing'" class="mt-6 text-center">
      <button
        type="button"
        class="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        :disabled="busy"
        @click="emit('start-over')"
      >
        {{ t('resumeSetup.startOver') }}
      </button>
    </div>

    <LocalFileSyncWarning
      :open="showLocalFileWarning"
      :google-drive-available="syncStore.isGoogleDriveAvailable"
      @close="showLocalFileWarning = false"
      @proceed="handleConnectLocal"
      @use-google-drive="handleConnectDrive"
    />
  </div>
</template>
