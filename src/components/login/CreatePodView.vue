<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { resolveDriveCollision } from '@/composables/useDriveCollisionRecovery';
import { canUseLocalFiles } from '@/services/sync/capabilities';
import { isUserCancellation } from '@/services/google/googleAuth';
import { slackNotify } from '@/utils/slackNotify';
import { getPlatformLabel, getDeviceLabel } from '@/utils/platformLabel';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();

type LoginView = 'load-pod';

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
  navigate: [view: LoginView];
  /**
   * Storage connected (desktop popup / local file) — hand off to the shared
   * post-connect finish surface (ResumePodSetup) where the password is entered
   * once and family members are added. iOS reaches the same surface via the
   * Drive redirect return, not this emit.
   */
  'finish-storage': [];
}>();

const currentStep = ref(1);
const formError = ref<string | null>(null);

// Step 1 fields
const familyName = ref('');
const name = ref('');
const email = ref('');
const ownerRole = ref<'parent' | 'child'>('parent');
const ownerRoleOptions = computed(() => [
  { value: 'parent', label: t('loginV6.parentBean') },
  { value: 'child', label: t('loginV6.littleBean') },
]);
const subscribeNewsletter = ref(true);

// Step 2 state
const storageSaved = ref(false);
const isSavingStorage = ref(false);
const storageType = ref<'local' | 'google_drive' | null>(null);
const showDriveResultModal = ref(false);
const driveResultError = ref<string | null>(null);
const showLocalFileWarning = ref(false);

/** Visual state of the Google Drive hero card in Step 2. */
const driveCardState = computed<'idle' | 'connecting' | 'connected'>(() =>
  storageType.value === 'google_drive' ? 'connected' : isSavingStorage.value ? 'connecting' : 'idle'
);

// Two steps now: identity → connect storage. The password is collected ONCE on
// the shared finish surface (ResumePodSetup) AFTER storage connects, and the
// add-members step runs there too — for every user, iPhone included. See
// docs/plans/2026-06-20-unified-create-flow-defer-password.md.
const totalSteps = 2;

// E2E seam (dev mode only). Pod creation moved OFF this component to the
// ResumePodSetup finish surface, which requires a real StorageProvider — and
// the storage connect (OS file picker / Drive OAuth) is the ONE step Playwright
// can't drive headless. So the hook injects ONLY that piece: a DEV in-memory
// provider via the same `syncService.setProvider` seam the real connect uses
// (which also flips `isConfigured`), and marks the storage step done. The test
// then drives the REAL UI — the step-2 Continue hand-off, the finish surface's
// single password entry, and the members step — so the harness exercises the
// genuine create path and can't drift from production.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__e2eCreatePod = {
    installMemoryProvider: async () => {
      const { createMemoryProvider } = await import('@/services/sync/providers/memoryProvider');
      const { setProvider } = await import('@/services/sync/syncService');
      setProvider(createMemoryProvider(`${familyName.value || 'my-family'}.beanpod`));
      storageSaved.value = true;
      storageType.value = 'local';
    },
  };
}

const stepLabels = [() => t('loginV6.createStep1'), () => t('loginV6.createStep2')];

async function handleStep1Next() {
  formError.value = null;

  // Idempotency guard: if a session already exists, the owner already signed up
  // (e.g. they hit Back from step 2 to step 1, then Next again). Re-running
  // signUp would orphan the first family + re-fire the Slack ping / newsletter.
  // Just advance to the storage step with the family we already created.
  // (Renaming the family after creation is out of scope — see the plan.)
  if (authStore.currentUser) {
    currentStep.value = 2;
    return;
  }

  if (!familyName.value || !name.value || !email.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  // Identity only — no password here. `deferPassword` builds the owner with an
  // empty sentinel hash; the real password is collected once on the finish
  // surface (after storage connect) and applied via `rehydrateOwnerDoc`.
  const result = await authStore.signUp({
    deferPassword: true,
    email: email.value,
    familyName: familyName.value,
    memberName: name.value,
    subscribeNewsletter: subscribeNewsletter.value,
  });

  if (result.success) {
    slackNotify(
      `🫘 *New family pod started!*\n*Family:* ${familyName.value}\n*Owner:* ${name.value}` +
        `\n*Platform:* ${getPlatformLabel()}\n*Device:* ${getDeviceLabel()}`
    );
    if (subscribeNewsletter.value) {
      try {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = 'https://everybeancounts.substack.com/api/v1/free';
        form.target = 'substack-subscribe-frame';
        form.style.display = 'none';

        const emailInput = document.createElement('input');
        emailInput.name = 'email';
        emailInput.value = email.value;
        form.appendChild(emailInput);

        const sourceInput = document.createElement('input');
        sourceInput.name = 'first_url';
        sourceInput.value = 'https://beanies.family/signup';
        form.appendChild(sourceInput);

        const iframe = document.createElement('iframe');
        iframe.name = 'substack-subscribe-frame';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        document.body.appendChild(form);
        form.submit();

        setTimeout(() => {
          form.remove();
          iframe.remove();
        }, 5000);
      } catch {
        // Newsletter subscription is best-effort
      }
    }
    currentStep.value = 2;
    formError.value = null;
  } else {
    const msg = result.error ?? t('auth.signUpFailed');
    formError.value = msg;
    // Severity 'warning': some signup failures are expected (email already
    // in a pod) — but a failed signup is still a dropped onboarding, and we
    // want them visible. The reporter's 60s dedup keeps duplicates quiet.
    reportError({
      surface: 'createPod.signUp',
      message: msg,
      severity: 'warning',
      context: { family_email: email.value },
    });
  }
}

function handleLocalFileClick() {
  showLocalFileWarning.value = true;
}

/**
 * Keep the focused field (and its nearby CTA) in view when the mobile on-screen
 * keyboard opens. iOS Safari overlays the keyboard; Android Chrome resizes the
 * viewport — `scrollIntoView({ block: 'center' })` handles both. Deferred so the
 * keyboard has begun affecting the viewport before we scroll. Only for text
 * controls (buttons/selects don't raise the keyboard).
 */
function handleFieldFocus(e: FocusEvent) {
  const el = e.target as HTMLElement | null;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
}

/** "Use Google Drive instead" from the local-file warning modal. */
function handleUseDriveFromWarning() {
  showLocalFileWarning.value = false;
  void handleChooseGoogleDriveStorage();
}

async function handleChooseLocalStorage() {
  showLocalFileWarning.value = false;
  if (isSavingStorage.value) return;
  isSavingStorage.value = true;
  formError.value = null;

  try {
    // Only selects the file + installs the provider — createNewFile() (on
    // "Next") initializes the doc and writes the V4 envelope.
    const r = await connectLocalStorage();
    if (r.status === 'connected') {
      storageSaved.value = true;
      storageType.value = 'local';
    } else if (r.errorKind === 'unsupported-browser') {
      // Firefox/Safari lack the File System Access API — a retry can never
      // succeed. Surface an actionable message (Drive works here; or switch
      // to Chrome/Edge). Not a Slack-worthy error — it's a known browser gap.
      formError.value = t('setup.localFileUnsupported');
      console.warn('[CreatePodView] local file unsupported in this browser:', r.error);
    } else if (r.cancelled) {
      // Normal abort (user dismissed the OS picker) — re-prompt, no report.
      formError.value = t('setup.fileCreateFailed');
    } else {
      formError.value = t('setup.fileCreateFailed');
      console.error('[CreatePodView] local file selection failed:', r.error);
      reportError({
        surface: 'createPod.selectLocalFile',
        message: r.error || 'Local file selection failed',
        severity: 'critical',
        context: { provider_type: 'local' },
      });
    }
  } finally {
    isSavingStorage.value = false;
  }
}

async function handleChooseGoogleDriveStorage() {
  if (!syncStore.isGoogleDriveAvailable) {
    // Defense-in-depth: the card is hidden in this state. If this fires,
    // log so a dev can spot the regression.
    console.warn(
      '[CreatePodView] Drive storage handler invoked while isGoogleDriveAvailable is false — check the v-if on the Drive card.'
    );
    return;
  }
  if (storageType.value === 'google_drive') return; // Already connected
  if (isSavingStorage.value) return; // Already in progress

  isSavingStorage.value = true;
  formError.value = null;
  driveResultError.value = null;

  // On a redirect surface (iOS / PWA / native) connecting Drive does a full-page
  // redirect that destroys this component's state. The routing rides through the
  // OAuth `state` param (redirectState.ts), and on return ResumePodSetup re-asks
  // for the password ONCE — no secret is stashed across the redirect (the round-2
  // sessionStorage stash was removed 2026-06-20; WebKit bounce-tracking cleared
  // it anyway). See docs/plans/2026-06-20-ios-oauth-bounce-state-param.md.
  try {
    const r = await connectDriveStorage(familyName.value || 'my-family', {
      googleEmail: email.value || undefined,
      activeFamilyId: familyContextStore.activeFamilyId,
    });
    // On iOS / installed PWAs this kicks off a full-page redirect to Google —
    // the page is navigating away; there's nothing more to do here. We resume
    // on return via `/welcome?resume=setup` → ResumePodSetup.
    if (r.status === 'redirecting') {
      return;
    }

    if (r.status === 'connected') {
      storageSaved.value = true;
      storageType.value = 'google_drive';
      showDriveResultModal.value = true; // success state
    } else if (r.errorKind === 'name-collision' && r.collision) {
      // A `.beanpod` with this family-name already exists in the user's Drive
      // folder. Resolve it via the adopt-existing recovery (2026-06-19):
      //  - own orphan STUB → adopt it as the create target, continue as success;
      //  - own POPULATED pod → (after confirm) send the user to the load flow;
      //  - DIFFERENT account → the focused "pick a different name" hint.
      // The existing file is never silently overwritten or duplicated.
      const action = await resolveDriveCollision(r.collision, {
        familyName: familyName.value || 'my-family',
        activeFamilyId: familyContextStore.activeFamilyId,
      });
      switch (action.kind) {
        case 'adopted-stub':
          storageSaved.value = true;
          storageType.value = 'google_drive';
          showDriveResultModal.value = true; // success state — write into the adopted file
          break;
        case 'open-existing':
          // They already have a real family file with this name — open it.
          emit('navigate', 'load-pod');
          break;
        case 'reject-different-account':
        case 'declined':
          driveResultError.value = t('createPod.duplicateFile');
          if (action.kind === 'reject-different-account') {
            console.error('[CreatePodView] Drive name collision (different account):', r.error);
            reportError({
              surface: 'createPod.nameCollision',
              message: r.error,
              severity: 'warning',
              context: { provider_type: 'google_drive', collision_file_id: r.collision.fileId },
            });
          }
          showDriveResultModal.value = true;
          break;
        case 'failed':
          driveResultError.value = action.error || t('googleDrive.authFailed');
          console.error('[CreatePodView] adopt-existing recovery failed:', action.error);
          reportError({
            surface: 'createPod.adoptExisting',
            message: action.error || 'adopt-existing recovery failed',
            severity: 'critical',
            context: { provider_type: 'google_drive' },
          });
          showDriveResultModal.value = true;
          break;
      }
    } else if (r.errorKind === 'collision-check-unavailable') {
      // Couldn't verify the user's Drive for existing files — we refused to
      // create blindly (avoids a second orphan). Retryable.
      driveResultError.value = t('createPod.driveCheckUnavailable');
      console.warn('[CreatePodView] Drive collision check unavailable:', r.error);
      showDriveResultModal.value = true;
    } else {
      driveResultError.value = r.error || t('googleDrive.authFailed');
      // A genuine cancellation (closed the chooser) is benign; anything else
      // — a 400, a timeout, a scope denial — is a real onboarding failure.
      const cancelled = r.cancelled || isUserCancellation(r.error);
      if (cancelled) console.warn('[CreatePodView] Drive connect cancelled:', r.error);
      else console.error('[CreatePodView] Drive connect failed:', r.error);
      reportError({
        surface: 'createPod.connectDrive',
        message: r.error || 'Google Drive connect failed',
        severity: cancelled ? 'warning' : 'critical',
        context: { provider_type: 'google_drive' },
      });
      showDriveResultModal.value = true; // failure state — Try again / Use a local file
    }
  } finally {
    isSavingStorage.value = false;
  }
}

/** Drive-result-modal actions (success: Continue; failure: Try again / Use a local file). */
function handleDriveModalContinue() {
  showDriveResultModal.value = false;
  handleStorageConnected();
}
function handleDriveModalRetry() {
  showDriveResultModal.value = false;
  void handleChooseGoogleDriveStorage();
}
function handleDriveModalUseLocal() {
  showDriveResultModal.value = false;
  handleLocalFileClick();
}

/**
 * Storage connected (desktop popup or local file). Step 2's job ends here —
 * the pod is NOT written in this component anymore. Hand off to the shared
 * finish surface (ResumePodSetup), which collects the password ONCE and runs
 * the add-members step. The freshly-installed `syncService` provider stays
 * live in the store across the in-component view switch (no route change), so
 * the finish surface writes straight into it without re-connecting.
 */
function handleStorageConnected() {
  formError.value = null;
  if (!storageSaved.value) {
    formError.value = t('setup.fileCreateFailed');
    return;
  }
  if (!authStore.currentUser) {
    // Impossible after step 1's signUp — but never hand off into a finish
    // surface with no authenticated owner.
    formError.value = t('setup.fileCreateFailed');
    console.error('[CreatePodView] handleStorageConnected: no authenticated owner');
    reportError({
      surface: 'createPod.handOff',
      message: 'storage hand-off reached with no authenticated owner',
      severity: 'critical',
      context: { provider_type: storageType.value },
    });
    return;
  }
  if (!syncStore.isConfigured) {
    // `storageSaved` is true but no provider is actually wired (a torn-down or
    // half-installed provider). `setProvider` flips `isConfigured`, so this is
    // false only when the install genuinely didn't take — refuse the hand-off
    // rather than landing on a finish surface whose createNewFile will fail at
    // the write step with no provider. (Restores the guard the old
    // handleStep2Next had before the unified-flow refactor.)
    formError.value = t('setup.fileCreateFailed');
    console.error(
      '[CreatePodView] storageSaved=true but syncStore.isConfigured=false — refusing the hand-off'
    );
    reportError({
      surface: 'createPod.handOff',
      message: 'storage hand-off refused: storageSaved=true but syncStore is not configured',
      severity: 'critical',
      context: { provider_type: storageType.value },
    });
    return;
  }
  emit('finish-storage');
}

function handleBack() {
  formError.value = null;
  if (currentStep.value === 1) {
    emit('back');
  } else {
    currentStep.value--;
  }
}
</script>

<template>
  <!--
    Scoped experiment: cream gradient on the setup wizard modal frame only.
    CIG defines Cloud White (#F8F9FA) as the primary background; the warmer
    cream tail here is a localized warmth try, evaluated after live. If this
    spreads to other surfaces, promote `#fffaf3` to a brand token in
    `packages/brand/theme.css` instead of inline-copying the literal.
  -->
  <div
    class="dark:bg-surface-raised dark:from-surface-raised dark:to-surface-raised mx-auto max-w-[540px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl"
    @focusin="handleFieldFocus"
  >
    <!-- Back button -->
    <button
      class="dark:text-ink-soft dark:hover:text-ink mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      @click="handleBack"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Beanie image (step 1 only) -->
    <div v-if="currentStep === 1" class="mb-2 text-center">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mx-auto h-[100px] w-[100px]"
      />
      <p class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold">
        beanies<span class="text-primary-500">.family</span>
      </p>
    </div>

    <!-- Step indicator with labels -->
    <div class="mb-6">
      <div class="flex items-center">
        <template v-for="step in totalSteps" :key="step">
          <div
            class="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors"
            :class="
              step === currentStep
                ? 'bg-primary-500 text-white'
                : step < currentStep
                  ? 'dark:text-success-lift bg-green-100 text-green-600 dark:bg-green-900/30'
                  : 'dark:bg-surface-overlay dark:text-ink-faint bg-gray-100 text-gray-400'
            "
          >
            <svg
              v-if="step < currentStep"
              class="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="3"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span v-else>{{ step }}</span>
          </div>
          <div
            v-if="step < totalSteps"
            class="mx-2 h-[3px] flex-1 rounded-full transition-colors"
            :class="
              step < currentStep
                ? 'bg-green-300 dark:bg-green-600'
                : 'dark:bg-surface-hover bg-gray-200'
            "
          ></div>
        </template>
      </div>
      <div class="mt-1.5 flex justify-between">
        <span
          v-for="step in totalSteps"
          :key="step"
          class="text-xs font-semibold"
          :class="step === currentStep ? 'text-primary-500' : 'opacity-25'"
        >
          {{ stepLabels[step - 1]?.() }}
        </span>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="dark:text-danger-lift mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20"
    >
      {{ formError }}
    </div>

    <!-- Step 1: About You -->
    <div v-if="currentStep === 1">
      <h2 class="font-outfit dark:text-ink mb-6 text-xl font-bold text-gray-900">
        {{ t('loginV6.growPodTitle') }}
      </h2>

      <form @submit.prevent="handleStep1Next">
        <div class="space-y-4">
          <BaseInput
            v-model="familyName"
            :label="t('auth.familyName')"
            :placeholder="t('auth.familyNamePlaceholder')"
            required
          />
          <div class="grid grid-cols-2 gap-3">
            <BaseInput
              v-model="name"
              :label="t('setup.yourName')"
              :placeholder="t('auth.yourNamePlaceholder')"
              required
            />
            <!-- Role dropdown -->
            <div>
              <label
                class="font-outfit dark:text-ink-soft mb-1 block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase"
              >
                {{ t('form.type') }}
              </label>
              <!-- BaseSelect (not a raw <select>): its control inherits the
                   16px body size, so iOS Safari doesn't auto-zoom on focus. -->
              <BaseSelect v-model="ownerRole" :options="ownerRoleOptions" />
            </div>
          </div>
          <BaseInput
            v-model="email"
            :label="t('form.email')"
            type="email"
            placeholder="you@example.com"
            required
          />
        </div>

        <label class="mt-4 flex cursor-pointer items-start gap-3">
          <input
            v-model="subscribeNewsletter"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#F15D22] focus:ring-[#F15D22]"
          />
          <span class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('auth.subscribeNewsletter') }}
          </span>
        </label>

        <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
          {{ authStore.isLoading ? t('auth.creatingAccount') : t('loginV6.createNext') }}
        </BaseButton>
      </form>
    </div>

    <!-- Step 2: Save & Secure -->
    <div v-else-if="currentStep === 2">
      <h2 class="font-outfit dark:text-ink mb-6 text-center text-xl font-bold text-gray-900">
        {{ t('loginV6.storageSectionLabel') }}
      </h2>

      <!-- Storage section — v6 styled rounded box -->
      <div
        class="border-primary-500/15 bg-primary-500/[0.02] dark:border-primary-500/10 dark:bg-primary-500/[0.03] rounded-[18px] border-2 p-4"
      >
        <!-- Google Drive is available — lead with it; local file is a quiet detour below. -->
        <template v-if="syncStore.isGoogleDriveAvailable">
          <button
            type="button"
            class="flex w-full items-center gap-3.5 rounded-[16px] border-2 px-4 py-4 text-left transition-all"
            :class="
              driveCardState === 'connected'
                ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                : driveCardState === 'connecting'
                  ? 'border-blue-300 bg-blue-50/50 dark:border-blue-600/50 dark:bg-blue-900/15'
                  : 'border-primary-500/40 bg-primary-500/[0.04] hover:border-primary-500 hover:bg-primary-500/[0.08] dark:border-primary-500/30 dark:bg-primary-500/[0.06] dark:hover:border-primary-500/50 hover:shadow-[0_4px_20px_rgba(241,93,34,0.08)]'
            "
            @click="handleChooseGoogleDriveStorage"
          >
            <div
              class="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[12px]"
              :class="
                driveCardState === 'connecting'
                  ? ''
                  : 'dark:bg-surface-raised bg-white shadow-[0_2px_8px_rgba(44,62,80,0.08)]'
              "
            >
              <BeanieSpinner v-if="driveCardState === 'connecting'" size="sm" />
              <svg
                v-else-if="driveCardState === 'connected'"
                class="dark:text-success-lift h-5 w-5 text-green-600"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <svg v-else class="h-5 w-5" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
                  fill="#0066da"
                />
                <path
                  d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z"
                  fill="#00ac47"
                />
                <path
                  d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 13.15z"
                  fill="#ea4335"
                />
                <path
                  d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
                  fill="#00832d"
                />
                <path
                  d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
                  fill="#2684fc"
                />
                <path
                  d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z"
                  fill="#ffba00"
                />
              </svg>
            </div>

            <div v-if="driveCardState === 'connected'" class="min-w-0 flex-1">
              <p class="font-outfit dark:text-success-lift text-base font-semibold text-green-700">
                {{ t('googleDrive.fileCreated') }}
              </p>
              <p class="text-secondary-500/70 dark:text-ink-soft mt-0.5 text-sm leading-snug">
                {{ t('googleDrive.fileCreatedSubtitle') }}
              </p>
            </div>
            <div v-else-if="driveCardState === 'connecting'" class="min-w-0 flex-1">
              <p class="font-outfit dark:text-ink text-base font-semibold text-gray-900">
                {{ t('googleDrive.connecting') }}
              </p>
            </div>
            <div v-else class="min-w-0 flex-1">
              <p class="font-outfit dark:text-ink text-base font-semibold text-gray-900">
                {{ t('googleDrive.storageLabel') }}
                <span
                  class="bg-primary-500/15 text-primary-500 ml-1.5 rounded-full px-2 py-0.5 align-middle text-xs font-bold"
                  >{{ t('storage.recommended') }}</span
                >
              </p>
              <p class="text-secondary-500/70 dark:text-ink-soft mt-0.5 text-sm leading-snug">
                {{ t('storage.driveSyncsWithFamily') }}
              </p>
              <p class="text-primary-500 font-outfit mt-1.5 text-xs font-semibold">
                {{ t('storage.connectGoogleDrive') }} →
              </p>
            </div>
          </button>

          <div class="mt-3 text-center">
            <p
              v-if="storageType === 'local'"
              class="font-outfit dark:text-success-lift inline-flex items-center gap-1.5 text-sm font-semibold text-green-600"
            >
              <svg
                class="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {{ t('storage.savingToLocalFile') }}
            </p>
            <!-- Only offer the local-file path where the File System Access API
                 exists (Chromium desktop / native). On iOS WebKit + Firefox it
                 always dead-ends, so we hide it rather than fail post-click. -->
            <button
              v-else-if="canUseLocalFiles()"
              type="button"
              class="font-outfit text-secondary-500/60 hover:text-secondary-500 dark:text-ink-soft dark:hover:text-ink cursor-pointer text-sm underline decoration-1 underline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isSavingStorage"
              @click="handleLocalFileClick"
            >
              {{ t('storage.preferLocal') }}
            </button>
          </div>
        </template>

        <!-- Google Drive isn't configured on this server (self-host without an OAuth
             proxy): local file is the only option, shown as a normal card. -->
        <div v-else class="grid grid-cols-2 gap-2">
          <div
            class="dark:bg-surface-overlay/40 flex h-[88px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50 px-2.5 opacity-50"
            :title="t('selfHost.driveUnavailableTooltip')"
          >
            <svg
              class="mb-1.5 h-6 w-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              style="opacity: 0.5"
            >
              <path
                d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
              />
            </svg>
            <span
              class="font-outfit dark:text-ink-soft text-center text-xs font-semibold whitespace-nowrap text-gray-600"
              >{{ t('googleDrive.storageLabel') }}</span
            >
            <span
              class="mt-1 rounded-full bg-gray-400 px-2 py-0.5 text-center text-xs font-bold whitespace-nowrap text-white"
              >{{ t('selfHost.notConfigured') }}</span
            >
          </div>

          <!-- Local file (functional but muted). Only offered where the File
               System Access API exists; otherwise a clear message (this is the
               self-host case where Drive isn't available, so we can't point to
               it — direct the user to a Chromium desktop browser instead). -->
          <div
            v-if="!canUseLocalFiles()"
            class="font-outfit dark:bg-surface-overlay/40 dark:text-ink-soft flex h-[88px] flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50 px-2.5 text-center text-xs text-gray-500"
          >
            {{ t('selfHost.localUnsupported') }}
          </div>
          <button
            v-else
            class="flex h-[88px] flex-col items-center justify-center rounded-[14px] border-2 px-2.5 transition-all"
            :class="
              storageType === 'local'
                ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                : 'dark:border-line-strong/50 dark:bg-surface-overlay/30 dark:hover:border-line-strong/50 border-gray-200 bg-gray-50/80 text-gray-400 hover:border-gray-300 hover:bg-gray-100/80'
            "
            :disabled="isSavingStorage"
            @click="handleLocalFileClick"
          >
            <svg
              v-if="storageType === 'local'"
              class="dark:text-success-lift mb-1.5 h-6 w-6 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <svg
              v-else
              class="dark:text-ink-faint mb-1.5 h-6 w-6 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
            <span
              class="font-outfit text-xs font-semibold"
              :class="
                storageType === 'local'
                  ? 'dark:text-success-lift text-green-700'
                  : 'dark:text-ink-soft text-gray-500'
              "
              >{{ t('storage.localFile') }}</span
            >
          </button>
        </div>

        <!-- "How this works" disclosure — replaces the 75-word security paragraph.
             Native <details>; mirrors the existing child-hint pattern in
             InviteWizardModal.vue (▸ rotates 90° on open). Inline by site, not
             a shared component, since the 3 disclosure usages in the codebase
             have distinct visual contexts. -->
        <details class="group mt-3">
          <summary
            class="font-outfit text-secondary-500/70 hover:text-primary-500 dark:text-ink-soft inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors"
          >
            <span
              class="text-primary-500 inline-block text-xs transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('loginV6.howThisWorks.toggle') }}</span>
          </summary>
          <div class="text-secondary-500/70 dark:text-ink-soft pb-2 pl-4 text-sm leading-relaxed">
            <p class="mb-2">
              <strong class="text-secondary-500 dark:text-ink">{{
                t('loginV6.howThisWorks.leadStrong')
              }}</strong>
              {{ t('loginV6.howThisWorks.lead') }}
            </p>
            <ul class="list-disc space-y-1 pl-4">
              <li>{{ t('loginV6.howThisWorks.bullet1') }}</li>
              <li>{{ t('loginV6.howThisWorks.bullet2') }}</li>
              <li>{{ t('loginV6.howThisWorks.bullet3') }}</li>
            </ul>
          </div>
        </details>

        <!-- Coming-soon providers — collapsed into a disclosure with compact chips
             instead of 3 disabled full-size cards. -->
        <details class="group">
          <summary
            class="font-outfit text-secondary-500/70 hover:text-primary-500 dark:text-ink-soft inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors"
          >
            <span
              class="text-primary-500 inline-block text-xs transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('loginV6.moreProvidersComingSoon') }}</span>
          </summary>
          <div class="flex gap-2 pb-2 pl-4">
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >📦 {{ t('storage.dropbox') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >☁️ {{ t('storage.iCloud') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 dark:border-line-strong dark:bg-surface-overlay/30 dark:text-ink-soft flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold"
              >🪟 OneDrive</span
            >
          </div>
        </details>
      </div>

      <BaseButton class="mt-6 w-full" :disabled="!storageSaved" @click="handleStorageConnected">
        {{ storageSaved ? t('loginV6.createNext') : t('loginV6.pickStorageToContinue') }}
      </BaseButton>
    </div>

    <!-- Footer link -->
    <div class="mt-6 text-center">
      <span class="dark:text-ink-soft text-sm text-gray-500">
        {{ t('loginV6.alreadyHavePod') }}
      </span>
      {{ ' ' }}
      <button
        type="button"
        class="text-primary-500 hover:text-terracotta-400 text-sm font-medium"
        @click="emit('navigate', 'load-pod')"
      >
        {{ t('loginV6.loadItLink') }}
      </button>
    </div>

    <!-- Local-file confirmation modal for the storage step -->
    <LocalFileSyncWarning
      :open="showLocalFileWarning"
      :google-drive-available="syncStore.isGoogleDriveAvailable"
      @close="showLocalFileWarning = false"
      @proceed="handleChooseLocalStorage"
      @use-google-drive="handleUseDriveFromWarning"
    />

    <!-- Google Drive result modal (success or failure) -->
    <BaseModal :open="showDriveResultModal" @close="showDriveResultModal = false">
      <!-- Success -->
      <template v-if="!driveResultError">
        <div class="text-center">
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
          >
            <svg
              class="dark:text-success-lift h-6 w-6 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 class="font-outfit dark:text-ink text-lg font-bold text-gray-900">
            {{ t('googleDrive.fileCreated') }}
          </h3>
          <p class="dark:text-ink-soft mt-1 text-sm text-gray-500">
            {{ t('googleDrive.fileCreatedSubtitle') }}
          </p>
        </div>

        <div class="mt-4">
          <!-- File details — single compact badge. Folder location, sharing
               instructions, and other Drive-side details intentionally
               omitted from this success moment; they're available in
               Settings → Family Data and via the Pod page invite flow. -->
          <div class="dark:bg-surface-overlay/50 rounded-xl bg-gray-50 p-3">
            <CloudProviderBadge
              provider-type="google_drive"
              :file-name="syncStore.fileName"
              :account-email="syncStore.providerAccountEmail"
              size="md"
            />
          </div>
        </div>

        <!-- Primary action: continue to next step -->
        <BaseButton class="mt-4 w-full" @click="handleDriveModalContinue">
          {{ t('loginV6.createNext') }}
        </BaseButton>

        <!-- Secondary: view in Drive (informational, de-emphasized) -->
        <a
          :href="
            syncStore.driveFolderId
              ? `https://drive.google.com/drive/folders/${syncStore.driveFolderId}`
              : 'https://drive.google.com'
          "
          target="_blank"
          rel="noopener noreferrer"
          class="dark:text-ink-faint mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-blue-500"
        >
          {{ t('googleDrive.openInDrive') }}
          <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </template>

      <!-- Failure -->
      <template v-else>
        <div class="text-center">
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
          >
            <svg
              class="dark:text-danger-lift h-6 w-6 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 class="font-outfit dark:text-ink text-lg font-bold text-gray-900">
            {{ t('googleDrive.authFailed') }}
          </h3>
          <p class="dark:text-ink-soft mt-2 text-sm text-gray-500">
            {{ driveResultError }}
          </p>
        </div>

        <!-- The diagnostic is already on its way to #beanies-errors via
             reportError. Give the user two concrete ways forward — never
             leave them stuck (the × dismisses back to the picker). -->
        <BaseButton class="mt-4 w-full" @click="handleDriveModalRetry">
          {{ t('action.tryAgain') }}
        </BaseButton>
        <BaseButton variant="outline" class="mt-2 w-full" @click="handleDriveModalUseLocal">
          {{ t('storage.useLocalInstead') }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
