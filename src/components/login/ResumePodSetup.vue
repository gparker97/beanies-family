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
 * collected ONCE in the `identity` phase, then the pod is written and the
 * post-write steps (kit, members, survey) run for every user before `/nook`.
 *
 * Phase reachability — the create and load sub-flows are disjoint:
 *
 *   create (genuinely-new family):
 *     no-registry-entry → identity → (storage |        ) → finishing
 *                                    (already-connected) → finalizePod
 *       → finalizePod SUCCESS → recovery-kit → members → survey
 *       → SetupProgressModal → syncStore.completePodSetup → signed-in /nook
 *
 *   #128: back from a web Drive redirect that said no (a stashed resume reason):
 *     no-registry-entry → drive-declined → (redirect to Google | token already valid → identity
 *                                           | local file → identity)
 *
 *   #128: the `survey` phase ("how did you hear about us?") is the LAST tap before
 *   the app, after the pod write, so it is off the critical path. Its answer rides
 *   `completePodSetup` (the registry write + the "Family pod created!" Slack). It is
 *   optional/skippable and MUST never block entry to the app (see `onErrorCaptured`).
 *
 *   load (existing pod — NEVER reaches `members`):
 *     auto-loadable → auto-load → completeAutoLoad success → signed-in /nook
 *     open-existing (adopt-confirm) → auto-load → … → signed-in /nook
 *     registry-error | load-failed → retry → (re-probe | start-new → identity)
 *
 * The post-write phases (`recovery-kit` → `members` → `survey`) are entered ONLY
 * from `finalizePod`'s create-success branch — never from any existing-pod load (`handleAutoLoadSubmit`,
 * `openExistingOnDrive`, `retry`), which emit `signed-in '/nook'` directly.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, onErrorCaptured } from 'vue';
import {
  type PayloadLoadError,
  DriveConsentDeniedError,
  OAuthRoundTripAbandonedError,
} from '@/types/sync';
import { surfacePayloadFatal, surfaceBlockerFatal } from '@/utils/payloadFailureSurface';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import CreateMembersStep from '@/components/login/CreateMembersStep.vue';
import PinInput from '@/components/ui/PinInput.vue';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import PhoneHandoffLine from '@/components/auth/PhoneHandoffLine.vue';
import { isDesktopBrowser } from '@/utils/platformLabel';
import { fillTemplate } from '@/utils/fillTemplate';
import { isValidPin } from '@/services/auth/deviceUnlock';
import CreatePodSurvey from '@/components/login/CreatePodSurvey.vue';
import SetupProgressModal from '@/components/login/SetupProgressModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { getProvider, providerBelongsToAnotherFamily } from '@/services/sync/syncService';
import { tryReconnectSilently, reconnectForWriteRetry } from '@/services/google/driveTokenRecovery';
import { resolveDriveCollision } from '@/composables/useDriveCollisionRecovery';
import { canUseLocalFiles } from '@/services/sync/capabilities';
import { isTokenValid, isUserCancellation } from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { trackOnboardingStep, type OnboardingStep } from '@/services/telemetry/onboardingAttempt';
import { confirm } from '@/composables/useConfirm';
import { consumeResumeReason, type ResumeSetupReason } from '@/components/login/resumePaths';
import type { HeardVia } from '@beanies/brand/heardVia';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const settingsStore = useSettingsStore();

/**
 * The family this create is for. ONE definition, used by the provider-identity gate, the Drive
 * connect and the pod write — these previously derived it separately and could disagree, which is
 * exactly the kind of gap the cross-family guard exists to catch.
 */
const createFamilyId = computed(
  () => familyContextStore.activeFamilyId ?? authStore.currentUser?.familyId ?? null
);

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
 * `recovery-kit`, `members` and `survey` are the create-only post-write steps,
 * reached ONLY after a successful pod write (see the phase-reachability table
 * above); `survey` is the optional "how did you hear about us?" step, last.
 * `drive-declined` is the web redirect's "Google needs a yes" return (#128): a stashed
 * resume reason on a `no-registry-entry` probe. It sits BEFORE `identity`, so nothing on it
 * may write a pod (no PIN yet): `finalizePod` routes to the PIN step until `ownerReady`, and
 * every storage fallback returns here rather than to `storage` (`storageFallbackPhase`).
 */
type Phase =
  | 'probing'
  | 'auto-load'
  | 'identity'
  | 'drive-declined'
  | 'survey'
  | 'storage'
  | 'finishing'
  | 'recovery-kit'
  | 'members'
  | 'retry';
const phase = ref<Phase>('probing');

/**
 * #128 funnel: the onboarding step each phase IS, for the `shown` events. Phases absent from
 * the map (`auto-load`, `retry`, `finishing`) are not create-funnel steps and emit nothing;
 * every create error fallback lands on `storage` or `drive-declined` (`storageFallbackPhase`),
 * both mapped, so the recorded step never sticks on a screen the person has left. `submitted`
 * is emitted explicitly on the success line of each step's handler, not here.
 */
const PHASE_STEP: Partial<Record<Phase, OnboardingStep>> = {
  probing: 'resume-probe',
  'drive-declined': 'drive-declined',
  identity: 'pin',
  storage: 'storage',
  'recovery-kit': 'kit',
  members: 'members',
  survey: 'survey',
};
// `immediate`: the first phase (`probing`) is set before the watcher exists. A no-op when no
// create attempt is open (a returning user's recovery visit emits nothing).
watch(
  phase,
  (next) => {
    const step = PHASE_STEP[next];
    if (step) trackOnboardingStep(step, 'shown');
  },
  { immediate: true }
);

/**
 * Has the PIN step run: the owner rebuilt with the chosen PIN (`handleIdentityNext`)? THE
 * precondition of a pod write, enforced at the one place a write starts (`finalizePod`), so no
 * route into it, however it got there, can write a pod with `pin === ''` and no rebuilt owner.
 * Before it is set, the only screen that can start a storage connect is `drive-declined`
 * (#128), which sits BEFORE the PIN step.
 */
const ownerReady = ref(false);

/**
 * Where a storage attempt that did not reach the write returns to: the storage step once the
 * PIN is set, the `drive-declined` screen it started from before that. ONE rule for every
 * fallback arm (Drive, local file, the catches and `finally`s), so no arm can drop someone who
 * has not chosen a PIN onto a storage step whose buttons assume they have.
 */
function storageFallbackPhase(): Phase {
  return ownerReady.value ? 'storage' : 'drive-declined';
}

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
// "How did you hear about us?" answer (`{ id, label }`; null = skipped). Captured in the
// `survey` phase, handed to `syncStore.completePodSetup` at the end.
const heardVia = ref<HeardVia | null>(null);
const formError = ref<string | null>(null);
const busy = ref(false);
const showLocalFileWarning = ref(false);
// Drives the SetupProgressModal opened from the terminal `survey` phase
// (sync the just-added members + register), mirroring CreatePodView's old
// handleFinish → SetupProgressModal → /nook tail.
const showSetupModal = ref(false);
// Set once we've kicked off navigation to /nook — keeps the `finally` blocks
// from flashing the storage picker back on during the route transition.
const navigatedAway = ref(false);

// Auto-load phase metadata (populated when registry lookup says 'auto-loadable').
const autoLoadFamilyName = ref<string>('');

/**
 * Why the `drive-declined` phase is showing (#128), for its notice copy: `drive-declined`
 * (Cancel/Back at Google) or `drive-consent` (the file-access box left unticked).
 */
const declineReason = ref<ResumeSetupReason | null>(null);
const autoLoadLastSaved = ref<string | null>(null);

const familyName = computed(() => familyContextStore.activeFamilyName || 'your family');

/**
 * The name the session already knows (#128), from step 1's `signUp`. ⚠️ `currentUser.displayName`,
 * NEVER the `authStore.displayName` getter: that falls back to the email, which must not be
 * greeted as a name. Non-empty → the PIN step says it and does not ask for it again.
 */
const knownOwnerName = computed(() => authStore.currentUser?.displayName?.trim() ?? '');
/** The greeting uses the first name only ("Choose your PIN, Greg"), per the approved mockup. */
const knownOwnerFirstName = computed(() => knownOwnerName.value.split(/\s+/)[0] ?? '');

/**
 * The page header, one variant per phase (#128). `null` hides it: the survey and the members
 * step carry their own heading. The subtitle says why the person is on this screen; the
 * default is phase-neutral because it also renders on probing, retry, storage and kit.
 */
const header = computed<{ title: string; subtitle: string | null } | null>(() => {
  switch (phase.value) {
    case 'survey':
    case 'members':
      return null;
    case 'identity':
      return {
        title: knownOwnerName.value
          ? fillTemplate(t('resumeSetup.choosePinFor'), { name: knownOwnerFirstName.value })
          : t('resumeSetup.title'),
        subtitle: t('resumeSetup.subtitlePin'),
      };
    case 'auto-load':
      return { title: t('resumeSetup.title'), subtitle: t('resumeSetup.subtitleRecovery') };
    // No subtitle: the orange notice under the title is the explanation (mockup Focus 2).
    case 'drive-declined':
      return { title: t('resumeSetup.driveDeclinedTitle'), subtitle: null };
    default:
      return { title: t('resumeSetup.title'), subtitle: t('resumeSetup.subtitle') };
  }
});

/** Phases with no "Start over": a critical write, and every post-write step. */
const HIDE_START_OVER: ReadonlySet<Phase> = new Set<Phase>([
  'finishing',
  'recovery-kit',
  'members',
  'survey',
]);

/** Desktop browsers only (#128): the kit step's "Use beanies on your phone too" line. */
const onDesktopBrowser = isDesktopBrowser();

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
  // `currentUser.displayName` (set by signUp) when the doc isn't loaded yet. The known
  // name backs it up: when it is set the field is hidden, so it must never stay empty.
  ownerName.value = authStore.displayName || knownOwnerName.value;

  // No secret is stashed across the iOS Drive redirect (the round-2 stash was
  // removed 2026-06-20 — WebKit bounce-tracking cleared it anyway). The generic
  // `runProbe()` flow IS the clean single-credential resume: on a fresh-token
  // return for a genuinely-new family, the registry probe yields
  // `no-registry-entry` → the `identity` phase asks for the PIN ONCE →
  // `handleIdentityNext` finishes on Drive. See
  // docs/plans/2026-06-20-ios-oauth-bounce-state-param.md.
  //
  // #128: a web Drive redirect that came back with a "no" (declined at Google, or the file-access
  // box unticked) stashed a reason. It is consumed here, once, either way, so it cannot resurface
  // on a later mount, and handed to the probe, which honours it ONLY on its `no-registry-entry`
  // arm (the genuinely-new family that was about to pick a PIN). Every other probe outcome keeps
  // its own arm: a known pod, a retry or a redirect is a newer, more specific fact than the hint.
  // ⚠️ Decided INSIDE the probe rather than by re-routing `identity` afterwards: the phase
  // watcher would otherwise flush `identity` first and log a false `pin shown`.
  await runProbe(consumeResumeReason());
});

/**
 * Safari's swipe-back from Google restores this page from the back/forward cache (#128): the
 * JS heap comes back exactly as it left, with `navigatedAway` still set by the redirect that
 * left it, so no `finally` or probe arm will ever move the spinner. Two redirects can leave it:
 *   - `finishOnDrive`'s (`phase` `finishing`, no Start over): back to the screen they left from
 *     (`storageFallbackPhase`). The attempt's step leaves `drive-consent` with a `back`
 *     (`returned`) and the restored screen logs its own `shown` through the phase watcher, so a
 *     later tab close is an honest abandon at the screen they are actually on;
 *   - the registry probe's (`phase` `probing`): to `retry`, whose Try again re-probes on the
 *     person's own tap and whose Start over is the way out. No funnel step: the probe never
 *     recorded `drive-consent`.
 * Every redirect arm runs inside a `finally` that has already released `busy`; a restore with
 * `busy` still raised is some other action in flight, which settles its own phase.
 */
function handlePageShow(e: PageTransitionEvent) {
  if (!e.persisted || !navigatedAway.value || busy.value) return;
  if (phase.value === 'finishing') {
    navigatedAway.value = false;
    trackOnboardingStep('drive-consent', 'back', { error_code: 'returned' });
    phase.value = storageFallbackPhase();
  } else if (phase.value === 'probing') {
    navigatedAway.value = false;
    phase.value = 'retry';
  } else {
    return;
  }
  logEvent({
    level: 'info',
    surface: 'resumeSetup',
    message: 'restored from the back/forward cache mid-redirect',
    context: { action: `bfcache-restore:${phase.value}` },
  });
}
onMounted(() => window.addEventListener('pageshow', handlePageShow));

onBeforeUnmount(() => {
  window.removeEventListener('pageshow', handlePageShow);
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
 * `no-registry-entry` → `identity` (genuinely-new family — create is correct), or
 * `drive-declined` when `stashedReason` says a web Drive redirect just came back with a "no"
 * (#128; only the mount passes one, so a retry re-probe never re-shows the decline).
 * `registry-error` / `load-failed` → `retry` (a pod fileId is/was known but we
 * couldn't reach it). We deliberately do NOT fall through to the destructive
 * create path here — re-creating would orphan the real pod (the 2026-05-15
 * incident). The retry screen offers a non-destructive re-probe, and an
 * explicit confirm-gated "start a new pod" for the rare genuine give-up.
 */
async function runProbe(stashedReason: ResumeSetupReason | null = null) {
  formError.value = null;
  phase.value = 'probing';
  let probeResult: Awaited<ReturnType<typeof syncStore.attemptResumeFromRegistry>>;
  try {
    probeResult = await syncStore.attemptResumeFromRegistry();
  } catch (e) {
    // ⚠️ THIS ENVELOPE IS NOT OPTIONAL, and it became load-bearing when the probe started
    // AWAITING the native round trip: this one `await` now spans a whole system-browser consent
    // plus the dismissal grace. `onErrorCaptured` below early-returns unless `phase === 'survey'`,
    // so without this a throw leaves "counting beans…" up for good and the only way out is
    // "Start over", which signs the person out.
    reportError({
      surface: 'resumeSetup.probe',
      message: `the registry probe threw: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('resumeSetup.registryError');
    phase.value = 'retry';
    return;
  }
  switch (probeResult.kind) {
    case 'auto-loadable':
      autoLoadFamilyName.value = probeResult.familyName;
      autoLoadLastSaved.value = probeResult.lastSaved;
      phase.value = 'auto-load';
      return;
    case 'no-registry-entry':
      // Scenario (a) — genuinely new family; fall through to the create flow. Back from a
      // declined web Drive redirect (#128): say so first, in orange, and offer the retry.
      if (stashedReason) {
        declineReason.value = stashedReason;
        phase.value = 'drive-declined';
        return;
      }
      phase.value = 'identity';
      return;
    case 'redirecting':
      // WEB ONLY: the page is unloading; keep the probing spinner up. On native
      // `gateCreateDriveAuth` awaits the round trip, so this arm is never taken there.
      // `navigatedAway` lets a back/forward-cache restore find its way off the spinner
      // (`handlePageShow`).
      navigatedAway.value = true;
      return;
    case 'drive-auth-failed': {
      // NATIVE (or a start failure on either transport): the gesture-less probe opened the sheet
      // and it came back without a grant. The pod IS known — the probe only redirects when the
      // registry holds a fileId — so `retry` copy is honest and its button re-runs the probe,
      // now behind a real tap.
      const abandoned = probeResult.error instanceof OAuthRoundTripAbandonedError;
      const consentDenied = probeResult.error instanceof DriveConsentDeniedError;
      if (!abandoned) {
        reportError({
          surface: 'resumeSetup.probeDriveAuth',
          message: `Drive sign-in failed during the registry probe: ${probeResult.error.message}`,
          error: probeResult.error,
          severity: consentDenied ? 'warning' : 'error',
          context: { provider_type: 'google_drive' },
        });
      }
      formError.value = driveAuthMessage(
        abandoned ? 'cancelled' : consentDenied ? 'consent-denied' : 'failed'
      );
      phase.value = 'retry';
      return;
    }
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
  // ⚠️ DELIBERATELY DOES NOT RAISE `busy`, and a previous round's attempt to was reverted.
  // Raising it bought nothing and cost the only way out: `runProbe` flips `phase` to 'probing'
  // synchronously, which swaps this whole retry block out of the DOM, so a second tap was
  // already impossible — while `busy` ALSO disables the "Start over" link, which is the last
  // escape if a native trip ever fails to settle. Leave the escape live.
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
 * Resume-flow adapter over the shared payload-failure surface.
 *
 * The report + overlay body used to live here AND in `App.vue`, and the two had
 * already drifted (different `surface` names; only one carried
 * `perf_doc_bytes`). Both now go through `@/utils/payloadFailureSurface`, which
 * also owns the "only the corrupt half is reported here, `docClient.surface()`
 * already emitted the too-large one" rule.
 */
function surfacePayloadFailure(err: PayloadLoadError, fileId: string, familyId: string): void {
  surfacePayloadFatal(err, { fileId, familyId, source: 'resume' });
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
        surfacePayloadFailure(result.error, result.fileId, result.familyId);
        return;
      case 'too-large':
        // The file is FINE — this device could not allocate enough memory to
        // inflate it. Same overlay, honest copy, and its existing Reload button
        // is the action: a reload reclaims the doc realm's wasm memory in both
        // worker and inline mode (a grown wasm heap never shrinks in place).
        // The shared surface picks the copy and skips the duplicate report.
        surfacePayloadFailure(result.error, result.fileId, result.familyId);
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
      case 'lineage-blocked':
        // ⚠️ THE OVERLAY, like its two neighbours above — not `formError`.
        //
        // This surface cannot fall back on the banner: `LineageBanner` lives
        // inside App.vue's `showLayout` branch and `shouldShowAppLayout` is false
        // while `needsPodSetup` is true, which is exactly this screen. A missing
        // case here was the password form coming back with NOTHING on it.
        //
        // But `inlineMessageKey` is the SYNC-BAR copy, and it prescribes two
        // things that do not exist here — "export from Settings" and "choose Use
        // the family file" both need the app shell. `surfaceLineageFatal` renders
        // `resumeSetup.podLineageBlocked`, whose own comment says it is "the
        // overlay variant, for a lineage block raised at OPEN where there is no
        // sync bar on screen", and it carries the copyable diagnostic and the
        // telemetry too. Writing a message that names unreachable actions is the
        // same defect this whole review round kept finding.
        // ⚠️ THE `instanceof` NARROWING AND ITS `else` ARM ARE BOTH GONE, and
        // removing the `else` is the more important half. `error` is typed
        // `RemoteBlocker`, and this arm now receives more than `PodLineageError`
        // — `completeAutoLoad` routes EVERY non-`PayloadLoadError` blocker here,
        // which since this change includes `LocalDocUnreadableError`. The old
        // fallback wrote `t(result.error.inlineMessageKey)` into `formError`,
        // i.e. the sync-bar copy, onto a screen with no sync bar: for the new
        // blocker that would have printed "choose Use the family file below"
        // beside a button that is not there.
        //
        // `surfaceBlockerFatal` resolves the OVERLAY copy through a table that
        // is exhaustive over `PodBlockMessageKey`, so every blocker reaching
        // this screen has copy written for a surface with no app shell — and a
        // new blocker class cannot compile until someone writes it.
        surfaceBlockerFatal(result.error, {
          fileId: null,
          familyId: useFamilyContextStore().activeFamilyId ?? null,
          source: 'resume',
        });
        return;
    }
    // ⚠️ EXHAUSTIVENESS. Every arm above `return`s and the function is
    // `Promise<void>`, so TypeScript cannot see a fall-through — which is how
    // `lineage-blocked` was added to `CompleteAutoLoadResult`, wired into every
    // other login surface, and silently missed here. This line makes the next
    // variant a compile error instead of a blank form.
    const unhandled: never = result;
    void unhandled;
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
  let rehydrated = false;
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
    rehydrated = true;
    ownerReady.value = true;
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error resuming setup', e);
    reportError({
      surface: 'resumeSetup.rehydrateOwner',
      message: `Unexpected error resuming setup: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    // Stays on the PIN step, like the `!r.success` arm above: the owner was NOT rebuilt, so the
    // storage step (which used to be set here) would lead straight to a write with no owner.
    formError.value = t('setup.fileCreateFailed');
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = storageFallbackPhase();
  }
  if (!rehydrated) return;
  // PIN is set + owner rehydrated: straight to the write. #128 moved the survey AFTER it
  // (kit → members → survey), off the critical path. Called after the `finally` above has
  // released `busy`, which `proceedToFinalize` re-arms for itself.
  trackOnboardingStep('pin', 'submitted');
  await proceedToFinalize();
}

/**
 * Do we hold a usable Drive token, trying one silent recovery first?
 *
 * Extracted from `proceedToFinalize`'s else-branch rather than re-written, so the create path and
 * the redirect-resume path cannot drift on what "connected" means. Before forcing a SECOND Drive
 * redirect (which on web reloads the app and makes the person start over), try the
 * beanpod-mirrored refresh token.
 *
 * ⚠️ NEVER THROWS — its one `await` is wrapped.
 */
async function ensureDriveToken(): Promise<boolean> {
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
  return recovered && isTokenValid();
}

/**
 * The one place the create flow's Drive-auth copy is chosen, shared by the probe arm and
 * `finishOnDrive`.
 *
 * ⚠️ THREE OUTCOMES, NOT TWO, AND THE THIRD IS THE ONE THAT WAS WRONG. A consent denial has
 * something specific to tell them ("allow file access"). A CANCELLATION — declined at Google, or
 * the sheet closed — must not say "sign-in failed": that frames the person's own decision as a
 * code error and tells them to retry something that did exactly what they asked. Only a genuine
 * fault gets the failure copy.
 */
function driveAuthMessage(kind: 'consent-denied' | 'cancelled' | 'failed'): string {
  if (kind === 'consent-denied') return t('resumeSetup.driveConsentDenied');
  if (kind === 'cancelled') return t('googleDrive.authCancelled');
  return t('googleDrive.authFailed');
}

/**
 * The finalize dispatch that writes the pod, extracted so the PIN step and the storage
 * fallbacks reach it with the SAME safety envelope — a peer of `handleConnectDrive` /
 * `handleConnectLocal`. It re-arms the busy latch + try/catch + finally rather than run
 * the point-of-no-return bare.
 */
async function proceedToFinalize() {
  if (busy.value) return;
  busy.value = true;
  try {
    // Storage was ALREADY connected on this same page (CreatePodView's step-2 popup / local
    // picker installed the provider and, for Drive, wrote the stub `.beanpod`) AND it belongs to
    // THIS family: write straight into it — do NOT re-run `connectDriveStorage`, which would call
    // `createNew` a second time and collide with that stub (and re-prompt for a local file).
    //
    // ⚠️ THE FAMILY CHECK IS THE POINT, AND ITS ABSENCE WAS A NEAR DATA LOSS. The old docblock
    // said "iOS never takes this branch: its full-page Drive redirect reloads the app, so the
    // in-memory provider is gone on return." That is true on iOS WEB/PWA and FALSE on native
    // Capacitor, where OAuth is `Browser.open()` + a deep link resolving to a router navigation —
    // the WebView never unloads and the provider survives. On 2026-09-21 a provider bound to a
    // previous family reached this branch on a production iPhone and `createNewFile` wrote into
    // that family's Drive file; only a `drive.file` 404 (different Google account) stopped it
    // overwriting their pod with a new envelope under a new family key.
    //
    // A foreign provider now falls through to the reconnect branch, where `connectDriveStorage`
    // REPLACES it with one bound to this family — so in the common case nothing is refused and the
    // person sees no error at all. `createNewFile` carries the same check as a backstop.
    // ⚠️ THE FALL-THROUGH IS DRIVE-ONLY, so only a DRIVE provider may be refused here. A foreign
    // LOCAL provider would otherwise be silently replaced by a `.beanpod` created in Google Drive
    // — the person explicitly chose a local file and would never be asked or told. `createNewFile`
    // still refuses a cross-family write for EVERY provider type, so the data-loss guard is intact
    // either way; this branch only decides whether we can recover automatically.
    //
    // ⚠️ AND ONLY WHEN THE FAMILY IS ACTUALLY KNOWN. `?? ''` would hand an empty id to a predicate
    // whose contract makes every bound provider foreign, so a momentarily-null family would reject
    // a perfectly good provider and re-run `connectDriveStorage` against the stub it already wrote
    // — the collision this branch exists to avoid.
    const activeProvider = getProvider();
    const foreignDriveProvider =
      !!activeProvider &&
      activeProvider.type === 'google_drive' &&
      !!createFamilyId.value &&
      providerBelongsToAnotherFamily(createFamilyId.value);

    phase.value = 'finishing'; // before ANY await: the silent reconnect below can take seconds
    if (activeProvider && !foreignDriveProvider) {
      await finalizePod();
    } else if (isTokenValid()) {
      // Returned from the Drive redirect with a fresh token but no usable provider — connect
      // Drive here, exactly once.
      await finishOnDrive();
    } else {
      // iOS edge: no live provider AND no valid token at the finish surface
      // (e.g. the token lapsed while the user was on the password form). Before
      // forcing a SECOND full-page Drive redirect — which reloads the app and
      // makes the user re-enter the password — try a silent reconnect via the
      // beanpod-mirrored refresh token. If it restores a token, finish on Drive
      // with no redirect; only fall back to the storage step when it genuinely
      // can't recover.
      if (await ensureDriveToken()) {
        await finishOnDrive();
      } else {
        // ⚠️ NO ERROR MESSAGE HERE, AND THAT IS NOT AN OVERSIGHT — a previous round added one and
        // it was wrong. This `else` is the ORDINARY route to the storage step for a brand-new
        // family: the phase table above reads `no-registry-entry → identity → storage`,
        // and on that path there is no provider yet and no Google token (accounts are born from
        // email + PIN, not OAuth), so every first-time creator lands here. Saying "Google
        // sign-in failed" above "Where should we keep your family's file?" tells someone their
        // sign-in failed before they have attempted one.
        //
        // The "never bounce back with no message" rule is about returning someone to a screen
        // they just ACTED on. Nobody has acted yet; the storage screen's own prompt is the
        // message. The genuine failures all set `formError` at the point they occur.
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
    phase.value = storageFallbackPhase();
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = storageFallbackPhase();
  }
}

/**
 * Survey complete/skip — the last step (#128): record the answer (may be null) and open
 * SetupProgressModal, whose completion hands the answer to `syncStore.completePodSetup`.
 * A survey failure must NEVER block entry to the app (see `onErrorCaptured` below).
 */
function handleSurveyComplete(heard: HeardVia | null) {
  heardVia.value = heard;
  trackOnboardingStep('survey', 'submitted');
  openSetupModal();
}

/**
 * Leave the survey for the setup modal. ⚠️ `finishing` UNMOUNTS THE SURVEY, and that is the
 * point: left mounted behind the modal, a survey that threw once could throw again, and with
 * the modal open the error guard below no longer owned it, so the second throw escaped to the
 * global handler and the completion never ran. `finishing` also keeps Start over hidden (the
 * pod exists) and records no funnel step. `handleSetupBack` returns to `survey`.
 */
function openSetupModal() {
  phase.value = 'finishing';
  showSetupModal.value = true;
}

// Belt-and-braces: if the survey subtree throws, degrade to skip and still
// finish setup (a cosmetic survey must never block entry to the app). Scoped to
// the survey phase, which `openSetupModal` leaves, so non-survey errors (the
// modal's own included) keep propagating normally.
onErrorCaptured((err) => {
  if (phase.value !== 'survey') return undefined;
  reportError({
    surface: 'resumeSetup.survey',
    message: `survey step errored — skipping: ${err instanceof Error ? err.message : String(err)}`,
    error: err,
    severity: 'warning',
  });
  heardVia.value = null;
  openSetupModal();
  return false; // handled — stop propagation
});

/** Step 2: write the pod file with the now-connected provider, then route to /nook. */
async function finalizePod(): Promise<boolean> {
  // ⚠️ NO WRITE BEFORE THE PIN STEP (see `ownerReady`). A storage connect started on the
  // `drive-declined` screen (a local file, or a Drive connect that came back connected in place)
  // reaches here with `pin === ''` and no rebuilt owner. The provider it installed stays live,
  // so the PIN step's submit writes into it (`proceedToFinalize` → the live-provider arm).
  if (!ownerReady.value) {
    logEvent({
      level: 'info',
      surface: 'resumeSetup',
      message: 'pod write deferred to the PIN step',
      context: {
        action: 'finalize-deferred:no-pin',
        provider_type: syncStore.storageProviderType ?? null,
      },
    });
    // The connect that got here succeeded: a message left from an earlier try on the declined
    // screen (`handleConnectLocal` does not clear it) must not sit above the PIN form.
    formError.value = null;
    phase.value = 'identity';
    return false;
  }
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
  // ⚠️ REFUSE RATHER THAN PASS `''` TO THE CROSS-FAMILY GUARD. An empty id is a caller bug, not
  // a family: `providerBelongsToAnotherFamily('')` treats every bound provider as foreign, so the
  // create would be refused with a message about the wrong thing.
  const familyId = createFamilyId.value;
  if (!familyId) {
    formError.value = t('setup.fileCreateFailed');
    reportError({
      surface: 'resumeSetup.finalize',
      message:
        'finalizePod reached with no resolvable family id — refusing rather than passing "" to the cross-family guard',
      severity: 'critical',
    });
    return false;
  }
  const podFileName = `${familyContextStore.activeFamilyName || 'my-family'}.beanpod`;
  const createPod = () =>
    syncStore.createNewFile(
      podFileName,
      user.memberId,
      familyId,
      familyContextStore.activeFamilyName ?? 'My Family'
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
      // Recovery is the storage step (connect again → a provider bound to THIS family), which the
      // caller's `finally` already lands on for any unmapped failure. No extra phase routing here:
      // that would be a second copy of the same rule.
      //
      // ⚠️ Severity is handled below: this is the GUARD WORKING, not an incident — nothing was
      // written and recovery is one tap. Same reasoning as `existing-pod` above.
      'provider-mismatch': 'createPod.failedReasonProviderMismatch',
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
      // ⚠️ `provider-mismatch` IS NOT CRITICAL, for the same reason `existing-pod` above is not:
      // it is the guard REFUSING SAFELY. Nothing was written, nothing is at risk, and recovery is
      // one tap on the storage step. `critical` pages #beanies-errors and force-flushes; reserving
      // it for "a user action failed or data is at risk" (CLAUDE.md) keeps that channel worth
      // reading. The keep-data-sign-out-then-create-another-family path is common enough that
      // paging on it would bury real create failures in the same bucket.
      severity: result.reason === 'provider-mismatch' ? 'warning' : 'critical',
      context: { provider_type: syncStore.storageProviderType ?? null },
    });
    return false;
  }
  // Pod written. Unlike the load paths, a create does NOT route to /nook yet:
  // advance to the post-write steps (kit → members → survey) so every user
  // (iPhone included) gets them before entering the app. `/nook` is emitted
  // later, after SetupProgressModal completes (handleSetupComplete). Flag them so
  // the router's ALREADY_AUTH guard does not bounce /welcome?resume=setup → /nook
  // now that podCreated is true (iOS skip guard).
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
  // ⚠️ NO MAGIC-LINK MINT HERE ANY MORE, AND THAT IS THE POINT.
  //
  // Setup used to hand the new owner a 7-day magic link alongside the recovery kit, as a second
  // thing to save. greg's call, 2026-09-20: that is backwards. The kit is the ROOT OF TRUST and
  // cannot be regenerated — lose it and every device and the data is gone permanently. A magic
  // link takes fifteen seconds to mint from Settings whenever it is wanted. Presenting them side
  // by side said they were equally important and drained the urgency from the one that is.
  //
  // What the link was actually for at this moment ("I am on the desktop, I want the app on my
  // phone") is now a one-line OFFER under the kit's confirm button (`PhoneHandoffLine`, desktop
  // browsers only, #128), minting on demand at fifteen minutes. Nothing to save, nothing
  // expiring in a week in someone's notes app.
  //
  // ⚠️ AND IT CLOSES A HOLE: the 7-day link wrote `memberLinkKeys`, and the Settings card that
  // was the only UI able to read or replace that dict is gone. A link issued here would have
  // lived its full week with nothing able to revoke it.
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

/**
 * The kit-step confirmation: stamp the doc-side signal (and HOW the kit was confirmed, which
 * the sign-out kit guard keys on), drop the code, advance. No sync here: SetupProgressModal's
 * sync carries the stamp, and the create tail must never block on a push.
 * `markRecoveryKitConfirmed` never throws and reports a failed stamp itself.
 */
async function handleKitStepStored(via: 'saved' | 'acknowledged') {
  kitCode.value = '';
  // The magic link is no longer minted here, so there is nothing of its to clear: the phone
  // line under the kit mints on demand and owns its own state.
  await settingsStore.markRecoveryKitConfirmed(via);
  trackOnboardingStep('kit', 'submitted');
  phase.value = 'members';
}

/**
 * `members` phase: the user is done adding family (or chose "later") — on to the
 * optional survey, the last step before the app (#128).
 */
function handleMembersFinish() {
  trackOnboardingStep('members', 'submitted');
  phase.value = 'survey';
}

async function handleSetupComplete() {
  showSetupModal.value = false;
  // #128: the completion write (registry heardVia + memberCount), the "🎉 Family pod
  // created!" Slack post, Plausible `pod_created` and the end of the create attempt. Never
  // throws and bounded, so entry to the app is never blocked by it; a second call for the
  // same family is a logged no-op.
  await syncStore.completePodSetup({ heardVia: heardVia.value });
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
  // Setup is finished and we're leaving for /nook — release the guard flag. NOT
  // cleared in handleSetupBack: that only closes SetupProgressModal and returns to
  // the survey phase (CreatePodSurvey re-mounts), so clearing there would reopen
  // the /welcome → /nook skip window.
  syncStore.membersStepActive = false;
  navigatedAway.value = true;
  emit('signed-in', '/nook');
}

function handleSetupBack() {
  showSetupModal.value = false;
  // The watcher then logs `survey shown` for the return, so the step pair reads back → shown.
  trackOnboardingStep('survey', 'back');
  phase.value = 'survey';
}

async function finishOnDrive() {
  formError.value = null;
  const r = await connectDriveStorage(familyName.value, {
    googleEmail: authStore.currentUser?.email,
    activeFamilyId: createFamilyId.value,
  });
  // WEB ONLY: the page is unloading. On native `connectDriveStorage` awaited the round trip and
  // this arm is never taken — the arms below run in place, inside `handleConnectDrive`'s envelope.
  // ⚠️ `navigatedAway` keeps the callers' `finally` from flipping `finishing` back to `storage`
  // while Google loads (#128): that flashed the storage picker, and its `storage shown` made the
  // unload log as an `abandon` at `storage`, the false abandon `drive-consent` exists to prevent.
  if (r.status === 'redirecting') {
    navigatedAway.value = true;
    return;
  }
  if (r.status === 'failed') {
    // Adopt-existing recovery — the fix for the iOS dead-end loop (2026-06-19).
    // This is exactly where the orphaned-pod collision lands on iPhone.
    if (r.errorKind === 'name-collision' && r.collision) {
      const action = await resolveDriveCollision(r.collision, {
        familyName: familyContextStore.activeFamilyName || 'my-family',
        // Same single source as the connect and the write above — this path was missed when
        // `createFamilyId` was introduced, so an `onMounted` switchFamily failure left it null
        // here while the others resolved to `currentUser.familyId`. `adoptDriveStub` then skipped
        // its `provider.persist(activeFamilyId)`, and the next cold boot could not find the pod.
        activeFamilyId: createFamilyId.value,
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
          phase.value = storageFallbackPhase();
          return;
        case 'reject-different-account':
          formError.value = t('createPod.duplicateFile');
          reportError({
            surface: 'resumeSetup.nameCollision',
            message: r.error,
            severity: 'warning',
            context: { provider_type: 'google_drive', collision_file_id: r.collision.fileId },
          });
          phase.value = storageFallbackPhase();
          return;
        case 'failed':
          // Translated copy only; the raw (English, possibly id-bearing) error goes to the report.
          formError.value = t('googleDrive.authFailed');
          reportError({
            surface: 'resumeSetup.adoptExisting',
            message: action.error || 'adopt-existing recovery failed during resume',
            severity: 'critical',
            context: { provider_type: 'google_drive' },
          });
          phase.value = storageFallbackPhase();
          return;
      }
    }
    if (r.errorKind === 'collision-check-unavailable') {
      formError.value = t('createPod.driveCheckUnavailable');
      phase.value = storageFallbackPhase();
      return;
    }
    // A consent denial is a user DECISION, so it is classified with the aborts
    // rather than the faults — and it carries its own guidance, because unlike a
    // plain cancel there is something specific to tell them to do.
    const consentDenied = r.errorKind === 'consent-denied';
    const abandoned = r.errorKind === 'cancelled';
    const cancelled = consentDenied || r.cancelled || isUserCancellation(r.error);
    if (cancelled) console.warn('[ResumePodSetup] Drive connect declined:', r.error);
    else console.error('[ResumePodSetup] Drive connect failed:', r.error);
    reportError({
      surface: 'resumeSetup.connectDrive',
      message: r.error || 'Google Drive connect failed during resume',
      severity: cancelled ? 'warning' : 'error',
      context: { provider_type: 'google_drive' },
    });
    // Translated copy only (finding 13): never assign the raw Drive message —
    // it's English-only and a name-collision message leaks an internal fileId.
    formError.value = driveAuthMessage(
      consentDenied ? 'consent-denied' : abandoned ? 'cancelled' : 'failed'
    );
    phase.value = storageFallbackPhase();
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
  phase.value = storageFallbackPhase();
}

async function handleConnectDrive() {
  // ⚠️ CLOSE THE LOCAL-FILE WARNING FIRST — ABOVE the busy guard, exactly as `handleConnectLocal`
  // does. This handler is also the modal's own "use Google Drive instead" action and the modal
  // does not self-close, so returning early with it still open leaves a dead button on a modal
  // nothing can dismiss. And now that the native connect CONTINUES IN PLACE rather than returning
  // `'redirecting'`, everything after it — including the one-time, non-regenerable recovery kit —
  // would otherwise paint BEHIND a modal about local-file sync.
  showLocalFileWarning.value = false;
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';
  try {
    // #128: Drive connect started. Recorded HERE so the redirect `finishOnDrive` may start is
    // never logged as an abandon at `storage`; the consent outcome is `connectStorage`'s.
    trackOnboardingStep('drive-consent', 'shown');
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
    phase.value = storageFallbackPhase();
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = storageFallbackPhase();
  }
}

/**
 * "Try again with Google" on the `drive-declined` screen (#128).
 *
 * This screen comes BEFORE the PIN step, and `handleConnectDrive` → `finishOnDrive` only
 * redirects when no valid token exists; with one it would connect in place and reach
 * `finalizePod`, whose `ownerReady` guard would send it to the PIN step anyway. A token already
 * in hand means Google said yes after all, so this goes to the PIN step directly, whose submit
 * finishes on Drive as usual, without a Drive connect first.
 * (`ensureDriveToken` only tries a silent reconnect and never redirects, so it is not the retry;
 * `gateCreateDriveAuth` stays the one place the create redirect starts.)
 */
async function handleDriveDeclinedRetry() {
  showLocalFileWarning.value = false;
  trackOnboardingStep('drive-declined', 'submitted');
  if (isTokenValid()) {
    phase.value = 'identity';
    return;
  }
  await handleConnectDrive();
}

/** The local-file warning's "use Google Drive instead": the declined screen keeps its guard. */
function handleWarningUseDrive() {
  if (phase.value === 'drive-declined') void handleDriveDeclinedRetry();
  else void handleConnectDrive();
}

function handleLocalFileClick() {
  showLocalFileWarning.value = true;
}

async function handleConnectLocal() {
  showLocalFileWarning.value = false;
  if (busy.value) return;
  // #128: from the `drive-declined` screen no PIN has been chosen yet, so a connected local file
  // goes to the PIN step (`finalizePod`'s guard; the PIN submit writes into the live local
  // provider), and a failure returns to the declined screen rather than to `storage`.
  const fallbackPhase = storageFallbackPhase();
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
      phase.value = fallbackPhase;
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
    phase.value = fallbackPhase;
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = fallbackPhase;
  }
}
</script>

<template>
  <div
    class="dark:bg-surface-raised dark:from-surface-raised dark:to-surface-raised mx-auto max-w-[480px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl"
  >
    <!-- One header, one variant per phase (`header`); null on the survey, which
         carries its own hero (eyebrow/title/subtitle). -->
    <template v-if="header">
      <div class="mb-2 text-center">
        <img
          src="/brand/beanies_impact_bullet_transparent_192x192.png"
          alt=""
          class="mx-auto h-[80px] w-[80px]"
        />
      </div>
      <h2
        class="font-outfit dark:text-ink text-center text-xl font-bold text-gray-900"
        :class="header.subtitle ? 'mb-1' : 'mb-5'"
      >
        {{ header.title }}
      </h2>
      <p v-if="header.subtitle" class="dark:text-ink-soft mb-6 text-center text-sm text-gray-500">
        {{ header.subtitle }}
      </p>
    </template>

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

    <!-- Drive declined (#128): back from a web Drive redirect that said no. A decision,
         not a fault, so a Heritage Orange notice (never the red form-error box), one
         primary retry, and the quiet local-file fallback only where it exists. -->
    <div v-else-if="phase === 'drive-declined'" class="space-y-4">
      <p
        class="dark:border-accent-lift border-primary-500 dark:bg-surface-raised dark:text-ink-soft rounded-xl border-l-4 bg-[var(--tint-orange-8)] p-3 text-sm text-gray-700"
      >
        {{
          declineReason === 'drive-consent'
            ? t('resumeSetup.driveConsentDenied')
            : t('resumeSetup.driveDeclinedBody')
        }}
      </p>
      <BaseButton class="w-full" :disabled="busy" :loading="busy" @click="handleDriveDeclinedRetry">
        {{ t('resumeSetup.tryAgainWithGoogle') }}
      </BaseButton>
      <div v-if="canUseLocalFiles()" class="text-center">
        <button
          type="button"
          class="font-outfit text-secondary-500 hover:text-secondary-600 dark:text-ink-faint dark:hover:text-ink cursor-pointer text-sm underline decoration-1 underline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="busy"
          @click="handleLocalFileClick"
        >
          {{ t('storage.useLocalInstead') }}
        </button>
        <p class="dark:text-ink-faint mt-1 text-xs text-gray-500">
          {{ t('storage.localFileWarning') }}
        </p>
      </div>
      <p v-else class="dark:text-ink-faint text-center text-xs text-gray-500">
        {{ t('storage.driveOnlyHere') }}
      </p>
    </div>

    <!-- Identity (fallback for scenario (a)) -->
    <form v-else-if="phase === 'identity'" class="space-y-4" @submit.prevent="handleIdentityNext">
      <div
        class="dark:bg-surface-overlay/50 dark:text-ink-soft rounded-xl bg-gray-50 p-3 text-sm text-gray-600"
      >
        🫘 {{ familyName }}
      </div>
      <!-- Asked only when the session does not already know it (#128): the header
           greets a known name instead. -->
      <BaseInput
        v-if="!knownOwnerName"
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
         createNewFile is the envelope's ONLY wrap; confirm-stored gates progress. The
         modal is unclosable, so everything for this step lives INSIDE it (#128): the
         "your pod is ready" title + "Open my pod" (`creation`), and, on desktop browsers
         only, the one-tap phone hand-off under the confirm button. The slot sits in the
         modal footer, outside the kit card, so it never lands in the exported PDF. -->
    <RecoveryKitDisplay
      v-else-if="phase === 'recovery-kit'"
      open
      :kit-id="kitId"
      :code="kitCode"
      creation
      @stored="handleKitStepStored"
    >
      <template #after-confirm>
        <PhoneHandoffLine
          v-if="onDesktopBrowser && authStore.currentUser?.memberId"
          :owner-member-id="authStore.currentUser.memberId"
        />
      </template>
    </RecoveryKitDisplay>

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

    <!-- Survey (create-only): "how did you hear about us?", the last step (#128). -->
    <CreatePodSurvey v-else-if="phase === 'survey'" @complete="handleSurveyComplete" />

    <!-- Members (create-finish only): add family members after the kit step. -->
    <CreateMembersStep v-else-if="phase === 'members'" @finish="handleMembersFinish" />

    <!-- Finishing (in-flight critical write — auto-load decrypt or create-pod) -->
    <div v-else class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="dark:text-ink-soft text-sm text-gray-500">{{ t('resumeSetup.finishing') }}</p>
    </div>

    <!-- Start over — hidden during a critical write and on every post-write step
         (kit, members, survey): the pod already exists, so the user should finish,
         not sign back out. -->
    <div v-if="!HIDE_START_OVER.has(phase)" class="mt-6 text-center">
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
      @use-google-drive="handleWarningUseDrive"
    />

    <!-- Setup progress modal — opened from the survey step; syncs the added
         members + registers the pod, then routes into the app. -->
    <SetupProgressModal
      :open="showSetupModal"
      @complete="handleSetupComplete"
      @back="handleSetupBack"
    />
  </div>
</template>
