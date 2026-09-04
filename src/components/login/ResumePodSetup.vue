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
 *    attemptResumeFromRegistry() → 'auto-loadable' ⇒ render password phase (LEGACY families; kit-born route to recovery)
 *      → completeAutoLoad(password) → success ⇒ markPodCreated, route /nook
 *
 * If the registry has nothing, we fall through to the previous (destructive)
 * create-pod flow, which is the correct behaviour for scenario (a).
 *
 * UI is a flat `switch` on the orchestrator's discriminated result kinds —
 * see `src/types/sync.ts`. The store layer owns all the recovery logic so
 * each branch in this file is one render path with one action.
 *
 * ── Dual role (2026-06-26): recovery surface AND first-class create-finish ──
 *
 * Since the unified create flow, this is ALSO the single post-connect finish
 * surface for a brand-new family (desktop hands off here after the step-2
 * popup; iPhone resumes here after the Drive redirect). The owner's 6-digit PIN
 * (Phase 4 — families are born password-free) is
 * collected ONCE in the `identity` phase, then the pod is written and the new
 * terminal `members` phase runs for every user before `/nook`.
 *
 * Phase reachability — the create and load sub-flows are disjoint:
 *
 *   create (genuinely-new family):
 *     no-registry-entry → identity → survey → (storage |        ) → finishing
 *                                              (already-connected) → finalizePod
 *       → finalizePod SUCCESS → members → SetupProgressModal → signed-in /nook
 *
 *   The `survey` phase ("how did you hear about us?") sits between `identity`
 *   (the one universal pre-finalize node — the PIN is collected there) and the
 *   finalize dispatch, so its answer can ride the `createNewFile` Slack. It is
 *   optional/skippable and MUST never block finalize (see `proceedToFinalize`).
 *
 *   load (existing pod — NEVER reaches `members`):
 *     auto-loadable → auto-load → completeAutoLoad success → signed-in /nook
 *     open-existing (adopt-confirm) → auto-load → … → signed-in /nook
 *     registry-error | load-failed → retry → (re-probe | start-new → identity)
 *
 * The `members` phase is entered ONLY from `finalizePod`'s create-success
 * branch — never from any existing-pod load (`handleAutoLoadSubmit`,
 * `openExistingOnDrive`, `retry`), which emit `signed-in '/nook'` directly.
 */
import { ref, computed, onMounted, onBeforeUnmount, onErrorCaptured } from 'vue';
import { payloadErrorDetail, type PayloadLoadError } from '@/types/sync';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import CreateMembersStep from '@/components/login/CreateMembersStep.vue';
import PinInput from '@/components/ui/PinInput.vue';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import { isValidPin } from '@/services/auth/deviceUnlock';
import CreatePodSurvey from '@/components/login/CreatePodSurvey.vue';
import SetupProgressModal from '@/components/login/SetupProgressModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { getProvider } from '@/services/sync/syncService';
import { tryReconnectSilently, reconnectForWriteRetry } from '@/services/google/driveTokenRecovery';
import { resolveDriveCollision } from '@/composables/useDriveCollisionRecovery';
import { canUseLocalFiles } from '@/services/sync/capabilities';
import { isTokenValid, isUserCancellation } from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { confirm } from '@/composables/useConfirm';
import { consumeResumeReason } from '@/components/login/resumePaths';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const fatalErrorStore = useFatalErrorStore();
const settingsStore = useSettingsStore();

const emit = defineEmits<{
  'signed-in': [destination: string];
  /** "Start over instead" — sign out + return to the welcome gate. */
  'start-over': [];
  /** Phase 4: the fetched envelope is kit-born (no password wraps) — the host
   *  routes to the recovery-kit / passphrase bootstrap surface. */
  'use-recovery': [];
}>();

/**
 * Discriminated UI phases. `probing` is the initial registry-check;
 * `auto-load` is the non-destructive happy path; `identity` + `storage` are
 * the create flow (genuinely-new families). `finishing` is the spinner shown
 * during a critical write — both auto-load decrypt and create-pod write.
 * `survey` is the optional create-only "how did you hear about us?" step shown
 * after `identity` and before finalize (its answer rides the create Slack).
 * `members` is the terminal create-only add-family-members step, reached ONLY
 * after a successful pod write (see the phase-reachability table above).
 */
type Phase =
  | 'probing'
  | 'auto-load'
  | 'identity'
  | 'survey'
  | 'storage'
  | 'finishing'
  | 'recovery-kit'
  | 'members'
  | 'retry';
const phase = ref<Phase>('probing');

const ownerName = ref('');
// Phase 4: the create-flow credential is the owner's 6-digit PIN. `password`
// survives ONLY for the auto-load phase (decrypting a LEGACY family's pod).
const pin = ref('');
const confirmPin = ref('');
const password = ref('');
// One-time recovery kit from `createNewFile` — the mandatory `recovery-kit`
// phase displays it; the code leaves memory on confirmation.
const kitCode = ref('');
const kitId = ref('');
// "How did you hear about us?" answer (a stable English Slack label or free text;
// null = skipped). Captured in the `survey` phase, threaded into createNewFile.
const heardVia = ref<string | null>(null);
const formError = ref<string | null>(null);
const busy = ref(false);
const showLocalFileWarning = ref(false);
// Drives the SetupProgressModal opened from the terminal `members` phase
// (sync the just-added members + register), mirroring CreatePodView's old
// handleFinish → SetupProgressModal → /nook tail.
const showSetupModal = ref(false);
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

  // No secret is stashed across the iOS Drive redirect (the round-2 stash was
  // removed 2026-06-20 — WebKit bounce-tracking cleared it anyway). The generic
  // `runProbe()` flow IS the clean single-credential resume: on a fresh-token
  // return for a genuinely-new family, the registry probe yields
  // `no-registry-entry` → the `identity` phase asks for the PIN ONCE →
  // `handleIdentityNext` finishes on Drive. See
  // docs/plans/2026-06-20-ios-oauth-bounce-state-param.md.
  await runProbe();

  // Surface a specific hint if we arrived here because Google file access was
  // denied on the consent screen (2026-06-19, finding 3). Set after runProbe so
  // it isn't cleared by the probe's `formError = null`. The reconnect CTA is the
  // storage step's "Connect Google Drive" button.
  if (consumeResumeReason() === 'drive-consent') {
    formError.value = t('resumeSetup.driveConsentDenied');
  }
});

onBeforeUnmount(() => {
  // Safety: never leave the members-step guard flag stranded if this surface is
  // torn down by any path other than handleSetupComplete (start-over, an error
  // route, a hard navigation). A stuck flag would suppress the ALREADY_AUTH
  // redirect for the rest of the session.
  syncStore.membersStepActive = false;
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

/**
 * The ONE place a payload failure becomes a fatal overlay.
 *
 * Both failure classes want the identical diagnostic blob and the identical
 * overlay; only the copy and whether to report differ. Cloning the ~25-line
 * body per class is what a third class would triple.
 *
 * `report` is load-bearing, not decoration: an out-of-memory failure has
 * ALREADY been reported once by `docClient.surface()`, and reporting again here
 * would use a different surface that the errorReporter's (surface, message)
 * dedup cannot collapse.
 */
function surfacePayloadFailure(
  err: PayloadLoadError,
  fileId: string,
  familyId: string,
  opts: { copyKey: 'resumeSetup.podCorrupted' | 'resumeSetup.podTooLarge'; report: boolean }
): void {
  if (opts.report) {
    reportError({
      surface: 'resumeSetup.podCorrupted',
      message: `Pod payload failed Automerge ${err.step} during resume`,
      error: err,
      severity: 'critical',
      context: { file_id: fileId, family_id: familyId, corruption_step: err.step },
    });
  }
  fatalErrorStore.setFatal(t(opts.copyKey), payloadErrorDetail(err, fileId, familyId));
}

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
      case 'needs-recovery':
        // Kit-born family: no password can ever open this envelope. Route to
        // the recovery-kit / passphrase bootstrap surface instead.
        emit('use-recovery');
        return;
      case 'corrupted':
        // The decrypted bytes aren't a valid Automerge doc. Do NOT call
        // createNewFile — that's the exact bug that produced the original
        // data-loss incident. Surface the canonical fatal-error modal with
        // diagnostics so the user can contact support with a fileId.
        surfacePayloadFailure(result.error, result.fileId, result.familyId, {
          copyKey: 'resumeSetup.podCorrupted',
          report: true,
        });
        return;
      case 'too-large':
        // The file is FINE — this device could not allocate enough memory to
        // inflate it. Same overlay, honest copy, and its existing Reload button
        // is the action: a reload reclaims the doc realm's wasm memory in both
        // worker and inline mode (a grown wasm heap never shrinks in place).
        //
        // `report: false` — `docClient.surface()` has ALREADY emitted the single
        // `pod-load-memory` event by the time this result exists. A second
        // report here would land on a DIFFERENT surface, which the
        // (surface, message) dedup cannot collapse, so it would double-count
        // every occurrence in the rate.
        surfacePayloadFailure(result.error, result.fileId, result.familyId, {
          copyKey: 'resumeSetup.podTooLarge',
          report: false,
        });
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
  if (!ownerName.value || !pin.value || !confirmPin.value) {
    formError.value = t('auth.fillAllFields');
    return false;
  }
  if (!isValidPin(pin.value)) {
    formError.value = t('pin.invalidFormat');
    return false;
  }
  if (pin.value !== confirmPin.value) {
    formError.value = t('pin.mismatch');
    return false;
  }
  return true;
}

async function handleIdentityNext() {
  if (busy.value) return;
  if (!validateIdentity()) return;
  busy.value = true;
  try {
    const r = await authStore.rehydrateOwnerDoc(ownerName.value, pin.value);
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
    // PIN is set + owner rehydrated. Show the optional "how did you hear
    // about us?" survey before finalize — the `identity` phase is the one node
    // every create path passes through, so the answer can ride createNewFile's
    // Slack. The survey drives `proceedToFinalize()` on complete/skip.
    phase.value = 'survey';
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

/**
 * The finalize dispatch that writes the pod, extracted so BOTH the desktop
 * already-connected path (via the survey's @complete) and error-degradation
 * reach it with the SAME safety envelope — a peer of `handleConnectDrive` /
 * `handleConnectLocal`. The survey's callback fires on a LATER tick after an
 * indefinite user pause, so this MUST re-arm the busy latch + try/catch + finally
 * rather than run the point-of-no-return bare.
 */
async function proceedToFinalize() {
  if (busy.value) return;
  busy.value = true;
  try {
    // Desktop create hand-off: storage was ALREADY connected on this same page
    // (CreatePodView's step-2 popup / local picker installed the provider and,
    // for Drive, wrote the stub `.beanpod`). Write straight into it — do NOT
    // re-run `connectDriveStorage`, which would call `createNew` a second time
    // and collide with that stub (and re-prompt for a local file). iOS never
    // takes this branch: its full-page Drive redirect reloads the app, so the
    // in-memory provider is gone (`getProvider()` is null) on return.
    if (getProvider()) {
      phase.value = 'finishing';
      await finalizePod();
    } else if (isTokenValid()) {
      // iOS returned from the Drive redirect with a fresh token but no live
      // provider yet — connect Drive here, exactly once.
      phase.value = 'finishing';
      await finishOnDrive();
    } else {
      // iOS edge: no live provider AND no valid token at the finish surface
      // (e.g. the token lapsed while the user was on the password form). Before
      // forcing a SECOND full-page Drive redirect — which reloads the app and
      // makes the user re-enter the password — try a silent reconnect via the
      // beanpod-mirrored refresh token. If it restores a token, finish on Drive
      // with no redirect; only fall back to the storage step when it genuinely
      // can't recover.
      phase.value = 'finishing';
      let recovered = false;
      try {
        recovered = await tryReconnectSilently(authStore.currentUser?.email);
      } catch (e) {
        reportError({
          surface: 'resumeSetup.silentReconnect',
          message: `silent reconnect threw at finish: ${e instanceof Error ? e.message : String(e)}`,
          error: e,
          severity: 'warning',
        });
      }
      if (recovered && isTokenValid()) {
        await finishOnDrive();
      } else {
        phase.value = 'storage';
      }
    }
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error finalizing pod', e);
    reportError({
      surface: 'resumeSetup.finalizeDispatch',
      message: `Unexpected error finalizing pod: ${e instanceof Error ? e.message : String(e)}`,
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

/**
 * Survey complete/skip — record the answer (may be null) and proceed to finalize.
 * A survey failure must NEVER block pod creation (see `onErrorCaptured` below).
 */
function handleSurveyComplete(heard: string | null) {
  heardVia.value = heard;
  void proceedToFinalize();
}

// Belt-and-braces: if the survey subtree throws, degrade to skip and still
// create the pod (a cosmetic survey must never block family creation). Scoped to
// the survey phase so non-survey errors keep propagating normally.
onErrorCaptured((err) => {
  if (phase.value !== 'survey') return undefined;
  reportError({
    surface: 'resumeSetup.survey',
    message: `survey step errored — skipping: ${err instanceof Error ? err.message : String(err)}`,
    error: err,
    severity: 'warning',
  });
  heardVia.value = null;
  void proceedToFinalize();
  return false; // handled — stop propagation
});

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
  const createPod = () =>
    syncStore.createNewFile(
      podFileName,
      user.memberId,
      familyContextStore.activeFamilyId ?? user.familyId ?? '',
      familyContextStore.activeFamilyName ?? 'My Family',
      heardVia.value
    );
  let result = await createPod();
  let retriedWrite = false;

  // Transient Drive failure on the FIRST write right after the full-page OAuth
  // redirect: the freshly-returned access token can momentarily fail the write
  // because WebKit bounce-tracking clears the refresh cookie across the
  // cross-origin redirect — even though the `.beanpod` stub was already created on
  // Drive. Re-acquire a token silently and retry the write ONCE before surfacing a
  // critical error and dumping the user back to the storage picker (the false "we
  // couldn't save your pod" the user saw on iPhone, where the file had in fact
  // been created). Safe to retry ONLY on the 'write' reason: the write threw
  // before `partialFileId` was captured, so createNewFile persisted/registered
  // nothing, ran no cleanup, and left the connected provider + stub intact — a
  // re-run simply re-writes into them. We deliberately do NOT retry 'verify'
  // (there `partialFileId` is set, so cleanup renames the stub to
  // `<name>.corrupt-<ts>` and a retry would write a valid pod under that bad name)
  // — and createNewFile now clears the offline queue on any create failure, so the
  // discarded first-attempt envelope can never flush over the retried pod.
  if (!result.ok && result.reason === 'write') {
    const canRetry = await reconnectForWriteRetry(user.email);
    logEvent({
      level: 'info',
      surface: 'resumeSetup',
      message: 'pod write failed on redirect return — attempting silent retry',
      context: {
        action: `create-write-retry:${canRetry ? 'reconnected' : 'no-token'}`,
        provider_type: syncStore.storageProviderType ?? null,
      },
    });
    if (canRetry) {
      retriedWrite = true;
      result = await createPod();
    }
  }

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
    // Map each failure reason to its specific, recovery-oriented message
    // (restored from the old CreatePodView.handleStep2Next, which created pods
    // before the unified-flow refactor). `existing-pod` is handled above;
    // unmapped reasons fall back to the generic message defensively.
    // `existing-pod` is handled in the branch above, so it's narrowed out here.
    const reasonKey: Record<typeof result.reason, Parameters<typeof t>[0]> = {
      write: 'createPod.failedReasonWrite',
      verify: 'createPod.failedReasonVerify',
      persist: 'createPod.failedReasonPersist',
      register: 'createPod.failedReasonRegister',
      precondition: 'createPod.failedReasonPrecondition',
      'concurrent-write': 'createPod.failedReasonConcurrent',
    };
    formError.value = t(reasonKey[result.reason] ?? 'setup.fileCreateFailed');
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
  // Pod written. Unlike the load paths, a create does NOT route to /nook yet:
  // advance to the terminal `members` phase so every user (iPhone included)
  // gets the add-family-members step before entering the app. `/nook` is
  // emitted later, after SetupProgressModal completes (handleSetupComplete).
  // Flag the members step so the router's ALREADY_AUTH guard does not bounce
  // /welcome?resume=setup → /nook now that podCreated is true (iOS skip guard).
  logEvent({
    level: 'info',
    surface: 'resumeSetup',
    message: 'pod created',
    context: {
      // Distinguish a clean first-try create from one that only succeeded after
      // the silent write-retry, so the recovery's success RATE is measurable in
      // CloudWatch (not collapsed into a generic success).
      action: retriedWrite ? 'create-ok:after-write-retry' : 'create-ok',
      provider_type: syncStore.storageProviderType ?? null,
    },
  });
  // Phase 4: mandatory recovery-kit step BEFORE members — the kit generated
  // inside createNewFile is the envelope's only wrap; someone must store it.
  // `membersStepActive` is set NOW (the pod exists) so the router's ALREADY_AUTH
  // guard doesn't bounce /welcome → /nook out of the kit step.
  kitCode.value = result.kit.code;
  kitId.value = result.kit.kitId;
  // The owner's PIN device wrap (review R2-F8): the doc hash was set back in the
  // identity phase, but the pod/key only exist NOW — enrol this device's unlock
  // wrap so the owner's own PIN can open their pod cold. Degraded, not fatal, on
  // failure (the store reports internally; the trusted auto-open cache still
  // covers the common path).
  await authStore.enrollDevicePinWrapForMember(user.memberId, pin.value);
  syncStore.membersStepActive = true;
  phase.value = 'recovery-kit';
  return true;
}

/** The kit-step confirmation: stamp the doc-side signal, drop the code, advance. */
async function handleKitStepStored() {
  kitCode.value = '';
  try {
    await settingsStore.markRecoveryKitConfirmed();
  } catch (e) {
    // Non-fatal: the envelope wrap exists; the nag re-offers if the stamp is
    // missing. Never block the create tail on this write.
    console.warn('[ResumePodSetup] markRecoveryKitConfirmed failed', e);
  }
  phase.value = 'members';
}

/**
 * `members` phase: the user is done adding family — open SetupProgressModal,
 * which syncs the just-added members + registers the pod, then routes to /nook.
 */
function handleMembersFinish() {
  showSetupModal.value = true;
}

async function handleSetupComplete() {
  // The "🎉 pod created" Slack ping already fired inside createNewFile when the
  // pod was written; this just closes the wizard and enters the app.
  showSetupModal.value = false;
  // Refresh the reactive settings projection from the just-written doc BEFORE
  // routing. `buildOwnerDoc` set `onboardingCompleted:false`, but the snapshot
  // in `settingsStore.settings` can lag the doc — and `/nook`'s onboarding
  // wizard reads `onboardingCompleted ?? true`, so a stale snapshot hides the
  // wizard until the user navigates (which triggers a later loadSettings). One
  // explicit load here closes that window for every create transport.
  try {
    await settingsStore.loadSettings();
  } catch (e) {
    // Non-fatal: the doc still has the flag; worst case the wizard appears on
    // the next navigation (the prior behaviour). Don't block entry to the app.
    console.warn('[ResumePodSetup] settings refresh before /nook failed', e);
  }
  // Members step is finished and we're leaving for /nook — release the guard
  // flag. NOT cleared in handleSetupBack: that only closes SetupProgressModal
  // and returns to the still-active members phase (CreateMembersStep re-renders),
  // so clearing there would reopen the /welcome → /nook skip window.
  syncStore.membersStepActive = false;
  navigatedAway.value = true;
  emit('signed-in', '/nook');
}

function handleSetupBack() {
  showSetupModal.value = false;
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
    class="dark:bg-surface-raised dark:from-surface-raised dark:to-surface-raised mx-auto max-w-[480px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl"
  >
    <!-- The survey phase carries its own hero (eyebrow/title/subtitle), so the
         generic ResumeSetup header is hidden while it shows. -->
    <div v-if="phase !== 'survey'" class="mb-2 text-center">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mx-auto h-[80px] w-[80px]"
      />
    </div>

    <h2
      v-if="phase !== 'survey'"
      class="font-outfit dark:text-ink mb-1 text-center text-xl font-bold text-gray-900"
    >
      {{ t('resumeSetup.title') }}
    </h2>
    <p v-if="phase !== 'survey'" class="dark:text-ink-soft mb-6 text-center text-sm text-gray-500">
      {{ phase === 'auto-load' ? t('resumeSetup.subtitleRecovery') : t('resumeSetup.subtitle') }}
    </p>

    <div
      v-if="formError"
      class="dark:text-danger-lift mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
    >
      {{ formError }}
    </div>

    <!-- Initial probe — short, only visible while the registry lookup runs. -->
    <div v-if="phase === 'probing'" class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('resumeSetup.checking') }}</p>
    </div>

    <!-- Auto-load (non-destructive): registry knew this family had a pod. -->
    <form
      v-else-if="phase === 'auto-load'"
      class="space-y-4"
      @submit.prevent="handleAutoLoadSubmit"
    >
      <div
        class="dark:bg-surface-overlay/50 dark:text-ink-soft rounded-xl bg-gray-50 p-3 text-sm text-gray-600"
      >
        🫘 {{ autoLoadFamilyName || familyName }}
        <span v-if="lastSavedDisplay" class="dark:text-ink-soft block text-xs text-gray-500">
          {{ t('resumeSetup.lastSaved') }} {{ lastSavedDisplay }}
        </span>
      </div>
      <p class="dark:text-ink-soft text-center text-sm text-gray-600">
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
        class="dark:bg-surface-overlay/50 dark:text-ink-soft rounded-xl bg-gray-50 p-3 text-sm text-gray-600"
      >
        🫘 {{ familyName }}
      </div>
      <p class="dark:text-ink-soft text-center text-sm text-gray-600">
        {{ t('resumeSetup.retryBody') }}
      </p>
      <BaseButton class="w-full" :disabled="busy" :loading="busy" @click="handleRetry">
        {{ t('resumeSetup.retryCta') }}
      </BaseButton>
      <button
        type="button"
        class="dark:text-ink-soft dark:hover:text-ink w-full text-center text-xs text-gray-500 underline decoration-1 underline-offset-4 transition-colors hover:text-gray-700 disabled:opacity-60"
        :disabled="busy"
        @click="handleStartNewPodFromRetry"
      >
        {{ t('resumeSetup.startNewCta') }}
      </button>
    </div>

    <!-- Identity (fallback for scenario (a)) -->
    <form v-else-if="phase === 'identity'" class="space-y-4" @submit.prevent="handleIdentityNext">
      <div
        class="dark:bg-surface-overlay/50 dark:text-ink-soft rounded-xl bg-gray-50 p-3 text-sm text-gray-600"
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
      <div>
        <p class="dark:text-ink-soft mb-1 text-sm font-medium text-gray-700">
          {{ t('setup.choosePinLabel') }}
        </p>
        <p class="dark:text-ink-soft mb-2 text-xs text-gray-500">
          {{ t('setup.choosePinHint') }}
        </p>
        <PinInput
          v-model="pin"
          :label="t('setup.choosePinLabel')"
          autofocus
          @update:model-value="formError = null"
        />
      </div>
      <div>
        <p class="dark:text-ink-soft mb-2 text-sm font-medium text-gray-700">
          {{ t('pin.confirmPin') }}
        </p>
        <PinInput
          v-model="confirmPin"
          :label="t('pin.confirmPin')"
          @update:model-value="formError = null"
        />
      </div>
      <BaseButton type="submit" class="w-full" :disabled="busy" :loading="busy">
        {{ t('action.continue') }}
      </BaseButton>
    </form>

    <!-- Recovery kit (Phase 4): mandatory post-write step — the kit generated inside
         createNewFile is the envelope's ONLY wrap; confirm-stored gates progress. -->
    <div v-else-if="phase === 'recovery-kit'" class="space-y-4">
      <p class="dark:text-ink-soft text-center text-sm text-gray-600">
        {{ t('setup.kitStepIntro') }}
      </p>
      <RecoveryKitDisplay
        :open="phase === 'recovery-kit'"
        :kit-id="kitId"
        :code="kitCode"
        @stored="handleKitStepStored"
      />
    </div>

    <!-- Storage (fallback for scenario (a)) -->
    <div v-else-if="phase === 'storage'" class="space-y-3">
      <p class="font-outfit dark:text-ink-soft text-center text-sm font-semibold text-gray-700">
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
        class="dark:text-ink-soft text-center text-xs text-gray-500"
      >
        {{ t('selfHost.localUnsupported') }}
      </p>
    </div>

    <!-- Survey (create-only): "how did you hear about us?" before finalize. -->
    <CreatePodSurvey v-else-if="phase === 'survey'" @complete="handleSurveyComplete" />

    <!-- Members (create-finish only): add family members after the pod write. -->
    <CreateMembersStep v-else-if="phase === 'members'" @finish="handleMembersFinish" />

    <!-- Finishing (in-flight critical write — auto-load decrypt or create-pod) -->
    <div v-else class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('resumeSetup.finishing') }}</p>
    </div>

    <!-- Start over — hidden during a critical write, on the members step (the pod
         already exists; the user should finish, not sign back out), and on the
         survey (which has its own skip affordance). -->
    <div
      v-if="phase !== 'finishing' && phase !== 'members' && phase !== 'survey'"
      class="mt-6 text-center"
    >
      <button
        type="button"
        class="dark:hover:text-ink-soft text-sm text-gray-400 hover:text-gray-600"
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

    <!-- Setup progress modal — opened from the members step; syncs the added
         members + registers the pod, then routes into the app. -->
    <SetupProgressModal
      :open="showSetupModal"
      @complete="handleSetupComplete"
      @back="handleSetupBack"
    />
  </div>
</template>
