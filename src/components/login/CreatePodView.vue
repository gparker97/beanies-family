<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import SetupProgressModal from '@/components/login/SetupProgressModal.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { isUserCancellation } from '@/services/google/googleAuth';
import { slackNotify } from '@/utils/slackNotify';
import { reportError } from '@/utils/errorReporter';
import { formatBirthdayShort } from '@/utils/date';
import type { FamilyMember, Gender, AgeGroup, DateOfBirth } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();

type LoginView = 'load-pod';

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
  navigate: [view: LoginView];
}>();

const currentStep = ref(1);
const formError = ref<string | null>(null);

// Step 1 fields
const familyName = ref('');
const name = ref('');
const email = ref('');
const ownerRole = ref<'parent' | 'child'>('parent');
const password = ref('');
const confirmPassword = ref('');
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

// Step 3 state
const addedMembers = ref<FamilyMember[]>([]);
const isAddingMember = ref(false);
const showSetupModal = ref(false);
const newMemberName = ref('');
const newMemberRole = ref<'parent' | 'child'>('parent');
const dobMonth = ref('');
const dobDay = ref('');
const dobYear = ref('');
const showMemberForm = ref(true); // Pre-opened for first member

const MONTH_KEYS = [
  'month.january',
  'month.february',
  'month.march',
  'month.april',
  'month.may',
  'month.june',
  'month.july',
  'month.august',
  'month.september',
  'month.october',
  'month.november',
  'month.december',
] as const;

const monthOptions = computed(() =>
  MONTH_KEYS.map((key, i) => ({
    value: String(i + 1),
    label: t(key),
  }))
);

const dayOptions = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const totalSteps = 3;

// Expose step navigation for E2E tests (dev mode only)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__e2eCreatePod = {
    setStep: (s: number) => (currentStep.value = s),
  };
}

const stepLabels = [
  () => t('loginV6.createStep1'),
  () => t('loginV6.createStep2'),
  () => t('loginV6.createStep3'),
];

async function handleStep1Next() {
  formError.value = null;

  if (!familyName.value || !name.value || !email.value || !password.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  if (password.value.length < 8) {
    formError.value = t('auth.passwordMinLength');
    return;
  }

  if (password.value !== confirmPassword.value) {
    formError.value = t('auth.passwordsDoNotMatch');
    return;
  }

  const result = await authStore.signUp({
    email: email.value,
    password: password.value,
    familyName: familyName.value,
    memberName: name.value,
    subscribeNewsletter: subscribeNewsletter.value,
  });

  if (result.success) {
    slackNotify(
      `🫘 *New family pod started!*\n*Family:* ${familyName.value}\n*Owner:* ${name.value}`
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
    } else if (r.cancelled) {
      // Normal abort (user dismissed the OS picker) — re-prompt, no report.
      formError.value = t('setup.fileCreateFailed');
    } else {
      formError.value = t('setup.fileCreateFailed');
      console.error('[CreatePodView] local file selection failed:', r.error);
      reportError({
        surface: 'createPod.selectLocalFile',
        message: r.error || 'Local file selection failed',
        severity: 'error',
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

  try {
    const r = await connectDriveStorage(familyName.value || 'my-family', {
      googleEmail: email.value || undefined,
      activeFamilyId: familyContextStore.activeFamilyId,
    });
    // On iOS / installed PWAs this kicks off a full-page redirect to Google —
    // the page is navigating away; there's nothing more to do here. We resume
    // on return via `/welcome?resume=setup` → ResumePodSetup.
    if (r.status === 'redirecting') return;

    if (r.status === 'connected') {
      storageSaved.value = true;
      storageType.value = 'google_drive';
      showDriveResultModal.value = true; // success state
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
        severity: cancelled ? 'warning' : 'error',
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
  void handleStep2Next();
}
function handleDriveModalRetry() {
  showDriveResultModal.value = false;
  void handleChooseGoogleDriveStorage();
}
function handleDriveModalUseLocal() {
  showDriveResultModal.value = false;
  handleLocalFileClick();
}

async function handleStep2Next() {
  formError.value = null;

  // Storage location is required.
  if (!storageSaved.value) {
    formError.value = t('setup.fileCreateFailed');
    return;
  }

  if (!authStore.currentUser) {
    // Impossible after step 1's signUp — but never fall through to step 3
    // (and an empty /nook) if it somehow happens.
    formError.value = t('setup.fileCreateFailed');
    console.error('[CreatePodView] handleStep2Next: no authenticated owner');
    reportError({
      surface: 'createPod.createNewFile',
      message: 'handleStep2Next reached with no authenticated owner',
      severity: 'error',
      context: { provider_type: storageType.value },
    });
    return;
  }

  if (!syncStore.isConfigured) {
    // storageSaved is true (guarded above) but no provider is wired. Without
    // a provider createNewFile() can't write the pod file — block here and
    // surface the regression rather than advancing to step 3 (then a
    // pod-less /nook).
    formError.value = t('setup.fileCreateFailed');
    console.error(
      '[CreatePodView] storageSaved=true but syncStore.isConfigured=false — refusing to advance'
    );
    reportError({
      surface: 'createPod.createNewFile',
      message: 'storageSaved=true but syncStore is not configured — refusing to advance to step 3',
      severity: 'error',
      context: { provider_type: storageType.value },
    });
    return;
  }

  // Already created (e.g. the user navigated back to step 2 and clicked Next
  // again) — re-running createNewFile would mint a fresh family key and
  // orphan the first. Just advance.
  if (syncStore.hasSessionPassword) {
    currentStep.value = 3;
    return;
  }

  // Initialize the Automerge doc, generate + wrap the family key, write the
  // V4 envelope. createNewFile() also fires the "🎉 pod created" Slack ping
  // and sets authStore.podCreated on success.
  const podFileName = `${familyName.value || 'my-family'}.beanpod`;
  const success = await syncStore.createNewFile(
    podFileName,
    password.value,
    authStore.currentUser.memberId,
    familyContextStore.activeFamilyId ?? '',
    familyName.value
  );
  if (!success) {
    const msg = syncStore.error ?? t('setup.fileCreateFailed');
    formError.value = msg;
    console.error('[CreatePodView] createNewFile failed:', msg);
    reportError({
      surface: 'createPod.createNewFile',
      message: msg,
      severity: 'error',
      context: { provider_type: storageType.value },
    });
    return;
  }

  currentStep.value = 3;
}

async function handleAddMember() {
  formError.value = null;

  if (!newMemberName.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  isAddingMember.value = true;

  const dateOfBirth: DateOfBirth | undefined =
    dobMonth.value && dobDay.value
      ? {
          month: parseInt(dobMonth.value, 10),
          day: parseInt(dobDay.value, 10),
          ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
        }
      : undefined;

  const memberInput = {
    name: newMemberName.value,
    email: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@setup.local`,
    gender: 'other' as Gender,
    ageGroup: (newMemberRole.value === 'child' ? 'child' : 'adult') as AgeGroup,
    role: 'member' as const,
    color: getNextColor(),
    requiresPassword: true,
    ...(dateOfBirth ? { dateOfBirth } : {}),
  };

  const member = await familyStore.createMember(memberInput);
  if (member) {
    addedMembers.value.push(member);
    newMemberName.value = '';
    newMemberRole.value = 'parent';
    dobMonth.value = '';
    dobDay.value = '';
    dobYear.value = '';
    showMemberForm.value = false; // Collapse after adding — user must explicitly add another
  } else {
    formError.value = t('loginV6.addMemberFailed');
  }
  isAddingMember.value = false;
}

async function handleRemoveMember(memberId: string) {
  await familyStore.deleteMember(memberId);
  addedMembers.value = addedMembers.value.filter((m) => m.id !== memberId);
  // If all members removed, re-show the form
  if (addedMembers.value.length === 0) showMemberForm.value = true;
}

function openAddMemberForm(role: 'parent' | 'child') {
  newMemberRole.value = role;
  newMemberName.value = '';
  dobMonth.value = '';
  dobDay.value = '';
  dobYear.value = '';
  showMemberForm.value = true;
}

const memberColors = ['#ef4444', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

function getNextColor(): string {
  const usedCount = addedMembers.value.length;
  return memberColors[usedCount % memberColors.length] ?? '#3b82f6';
}

function handleFinish() {
  showSetupModal.value = true;
}

function handleSetupComplete() {
  // The "pod created" Slack ping already fired in handleStep2Next, the moment
  // the pod was actually written. This handler just closes the wizard and
  // routes into the app.
  showSetupModal.value = false;
  emit('signed-in', '/nook');
}

function handleSetupBack() {
  showSetupModal.value = false;
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
    class="mx-auto max-w-[540px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl dark:bg-slate-800 dark:from-slate-800 dark:to-slate-800"
  >
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
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
      <p class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-200">
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
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-gray-500'
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
                : 'bg-gray-200 dark:bg-slate-600'
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
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Step 1: About You -->
    <div v-if="currentStep === 1">
      <h2 class="font-outfit mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">
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
                class="font-outfit mb-1 block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
              >
                {{ t('form.type') }}
              </label>
              <select
                v-model="ownerRole"
                class="focus:border-primary-500 focus:ring-primary-500 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
              >
                <option value="parent">{{ t('loginV6.parentBean') }}</option>
                <option value="child">{{ t('loginV6.littleBean') }}</option>
              </select>
            </div>
          </div>
          <BaseInput
            v-model="email"
            :label="t('form.email')"
            type="email"
            placeholder="you@example.com"
            required
          />
          <div>
            <BaseInput
              v-model="password"
              :label="t('loginV6.signInPasswordLabel')"
              type="password"
              :placeholder="t('auth.passwordPlaceholder')"
              required
              @input="formError = null"
            />
            <p class="mt-1 text-xs text-gray-400">
              {{ t('loginV6.signInPasswordHint') }}
            </p>
          </div>
          <BaseInput
            v-model="confirmPassword"
            :label="t('auth.confirmPassword')"
            type="password"
            :placeholder="t('auth.confirmPasswordPlaceholder')"
            required
            @input="formError = null"
          />
        </div>

        <label class="mt-4 flex cursor-pointer items-start gap-3">
          <input
            v-model="subscribeNewsletter"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#F15D22] focus:ring-[#F15D22]"
          />
          <span class="text-sm text-gray-500 dark:text-gray-400">
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
      <h2 class="font-outfit mb-6 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
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
                  : 'bg-white shadow-[0_2px_8px_rgba(44,62,80,0.08)] dark:bg-slate-800'
              "
            >
              <BeanieSpinner v-if="driveCardState === 'connecting'" size="sm" />
              <svg
                v-else-if="driveCardState === 'connected'"
                class="h-5 w-5 text-green-600 dark:text-green-400"
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
              <p class="font-outfit text-base font-semibold text-green-700 dark:text-green-400">
                {{ t('googleDrive.fileCreated') }}
              </p>
              <p class="text-secondary-500/70 mt-0.5 text-sm leading-snug dark:text-gray-400">
                {{ t('googleDrive.fileCreatedSubtitle') }}
              </p>
            </div>
            <div v-else-if="driveCardState === 'connecting'" class="min-w-0 flex-1">
              <p class="font-outfit text-base font-semibold text-gray-900 dark:text-gray-100">
                {{ t('googleDrive.connecting') }}
              </p>
            </div>
            <div v-else class="min-w-0 flex-1">
              <p class="font-outfit text-base font-semibold text-gray-900 dark:text-gray-100">
                {{ t('googleDrive.storageLabel') }}
                <span
                  class="bg-primary-500/15 text-primary-500 ml-1.5 rounded-full px-2 py-0.5 align-middle text-xs font-bold"
                  >{{ t('storage.recommended') }}</span
                >
              </p>
              <p class="text-secondary-500/70 mt-0.5 text-sm leading-snug dark:text-gray-400">
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
              class="font-outfit inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 dark:text-green-400"
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
            <button
              v-else
              type="button"
              class="font-outfit text-secondary-500/60 hover:text-secondary-500 cursor-pointer text-sm underline decoration-1 underline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-200"
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
            class="flex h-[88px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50 px-2.5 opacity-50 dark:bg-slate-700/40"
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
              class="font-outfit text-center text-xs font-semibold whitespace-nowrap text-gray-600 dark:text-gray-400"
              >{{ t('googleDrive.storageLabel') }}</span
            >
            <span
              class="mt-1 rounded-full bg-gray-400 px-2 py-0.5 text-center text-xs font-bold whitespace-nowrap text-white"
              >{{ t('selfHost.notConfigured') }}</span
            >
          </div>

          <!-- Local file (functional but muted) -->
          <button
            class="flex h-[88px] flex-col items-center justify-center rounded-[14px] border-2 px-2.5 transition-all"
            :class="
              storageType === 'local'
                ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                : 'border-gray-200 bg-gray-50/80 text-gray-400 hover:border-gray-300 hover:bg-gray-100/80 dark:border-slate-600/50 dark:bg-slate-700/30 dark:hover:border-slate-500/50'
            "
            :disabled="isSavingStorage"
            @click="handleLocalFileClick"
          >
            <svg
              v-if="storageType === 'local'"
              class="mb-1.5 h-6 w-6 text-green-600 dark:text-green-400"
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
              class="mb-1.5 h-6 w-6 text-gray-400 dark:text-gray-500"
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
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400'
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
            class="font-outfit text-secondary-500/70 hover:text-primary-500 inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors dark:text-gray-400"
          >
            <span
              class="text-primary-500 inline-block text-[0.625rem] transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('loginV6.howThisWorks.toggle') }}</span>
          </summary>
          <div class="text-secondary-500/70 pb-2 pl-4 text-sm leading-relaxed dark:text-gray-400">
            <p class="mb-2">
              <strong class="text-secondary-500 dark:text-gray-200">{{
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
            class="font-outfit text-secondary-500/70 hover:text-primary-500 inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors dark:text-gray-400"
          >
            <span
              class="text-primary-500 inline-block text-[0.625rem] transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('loginV6.moreProvidersComingSoon') }}</span>
          </summary>
          <div class="flex gap-2 pb-2 pl-4">
            <span
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
              >📦 {{ t('storage.dropbox') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
              >☁️ {{ t('storage.iCloud') }}</span
            >
            <span
              class="font-outfit text-secondary-500/50 flex-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold dark:border-slate-600 dark:bg-slate-700/30 dark:text-gray-400"
              >🪟 OneDrive</span
            >
          </div>
        </details>
      </div>

      <BaseButton class="mt-6 w-full" :disabled="!storageSaved" @click="handleStep2Next">
        {{ storageSaved ? t('loginV6.createNext') : t('loginV6.pickStorageToContinue') }}
      </BaseButton>
    </div>

    <!-- Step 3: Add Family Members -->
    <div v-else-if="currentStep === 3">
      <h2 class="font-outfit mb-6 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.addBeansTitle') }}
      </h2>

      <!-- Owner + added members list -->
      <div class="mb-4 space-y-2">
        <!-- Owner (always shown, non-removable) -->
        <div
          v-if="familyStore.owner"
          class="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50"
        >
          <BeanieAvatar
            :variant="
              getMemberAvatarVariant({
                gender: familyStore.owner.gender,
                ageGroup: ownerRole === 'child' ? 'child' : 'adult',
              })
            "
            :color="familyStore.owner.color"
            size="sm"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ familyStore.owner.name }}
              <span
                class="bg-primary-500/15 text-primary-500 ml-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                >{{ t('loginV6.you') }}</span
              >
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{
                ownerRole === 'child'
                  ? '🌱 ' + t('loginV6.littleBean')
                  : '🫘 ' + t('loginV6.parentBean')
              }}
            </p>
          </div>
        </div>

        <!-- Additional members -->
        <div
          v-for="member in addedMembers"
          :key="member.id"
          class="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50"
        >
          <BeanieAvatar :variant="getMemberAvatarVariant(member)" :color="member.color" size="sm" />
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ member.name }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{
                member.ageGroup === 'child'
                  ? '🌱 ' + t('loginV6.littleBean')
                  : '🫘 ' + t('loginV6.parentBean')
              }}<template v-if="formatBirthdayShort(member.dateOfBirth)">
                · {{ formatBirthdayShort(member.dateOfBirth) }}</template
              >
            </p>
          </div>
          <button
            type="button"
            class="ml-1 rounded-lg p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
            :title="t('loginV6.removeMember')"
            @click="handleRemoveMember(member.id)"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- Add another beanie prompt (shown after first member added, form collapsed) -->
      <div
        v-if="!showMemberForm && addedMembers.length > 0"
        class="rounded-2xl border-2 border-dashed border-gray-200 p-4 text-center dark:border-slate-600"
      >
        <p class="font-outfit mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {{ t('loginV6.addAnotherBeanie') }}
        </p>
        <div class="flex justify-center gap-2">
          <button
            type="button"
            class="font-outfit flex items-center gap-1.5 rounded-full border-2 border-transparent bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:border-[var(--color-secondary-500)] hover:bg-gray-50 dark:bg-slate-700 dark:text-gray-300 dark:hover:border-slate-400 dark:hover:bg-slate-600"
            @click="openAddMemberForm('parent')"
          >
            🫘 {{ t('loginV6.parentBean') }}
          </button>
          <button
            type="button"
            class="font-outfit flex items-center gap-1.5 rounded-full border-2 border-transparent bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:border-[var(--color-secondary-500)] hover:bg-gray-50 dark:bg-slate-700 dark:text-gray-300 dark:hover:border-slate-400 dark:hover:bg-slate-600"
            @click="openAddMemberForm('child')"
          >
            🌱 {{ t('loginV6.littleBean') }}
          </button>
        </div>
      </div>

      <!-- Add member form. Field order is intentional: Name → Birthday → Role.
           Easiest/least committal field first (name), narrowing fact next
           (birthday), categorize last (role). The role chips are
           self-describing via their emoji + word labels — no "Type" prompt
           label is needed above. -->
      <div
        v-if="showMemberForm"
        class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-600"
      >
        <BaseInput
          v-model="newMemberName"
          :label="'👤 ' + t('form.name')"
          :placeholder="t('family.enterName')"
        />

        <!-- Birthday (month & day required, year optional) -->
        <div>
          <span
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
            >🎂 {{ t('modal.birthday') }}</span
          >
          <div class="mt-1 grid grid-cols-[1fr_0.6fr_0.7fr] gap-1.5">
            <BaseSelect
              v-model="dobMonth"
              :options="monthOptions"
              :placeholder="t('family.dateOfBirth.month')"
            />
            <BaseSelect
              v-model="dobDay"
              :options="dayOptions"
              :placeholder="t('family.dateOfBirth.day')"
            />
            <BaseInput v-model="dobYear" type="number" placeholder="Year" />
          </div>
        </div>

        <!-- Role chips — self-describing via emoji + labels, no prompt above. -->
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-full px-3 py-1 text-sm transition-colors"
            :class="
              newMemberRole === 'parent'
                ? 'bg-secondary-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
            "
            @click="newMemberRole = 'parent'"
          >
            🫘 {{ t('loginV6.parentBean') }}
          </button>
          <button
            type="button"
            class="rounded-full px-3 py-1 text-sm transition-colors"
            :class="
              newMemberRole === 'child'
                ? 'bg-secondary-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
            "
            @click="newMemberRole = 'child'"
          >
            🌱 {{ t('loginV6.littleBean') }}
          </button>
        </div>

        <div class="flex gap-2">
          <BaseButton
            v-if="addedMembers.length > 0"
            class="flex-1"
            variant="outline"
            @click="showMemberForm = false"
          >
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton
            class="flex-1"
            variant="secondary"
            :disabled="!newMemberName || !dobMonth || !dobDay || isAddingMember"
            :loading="isAddingMember"
            @click="handleAddMember"
          >
            🫘 {{ t('loginV6.addMember') }}
          </BaseButton>
        </div>
      </div>

      <BaseButton class="mt-6 w-full" @click="handleFinish">
        {{ t('loginV6.finish') }}
      </BaseButton>
      <button
        v-if="addedMembers.length === 0"
        type="button"
        class="mt-2 w-full text-center text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        @click="handleFinish"
      >
        {{ t('loginV6.skip') }}
      </button>
    </div>

    <!-- Footer link -->
    <div class="mt-6 text-center">
      <span class="text-sm text-gray-500 dark:text-gray-400">
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
              class="h-6 w-6 text-green-600 dark:text-green-400"
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
          <h3 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
            {{ t('googleDrive.fileCreated') }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ t('googleDrive.fileCreatedSubtitle') }}
          </p>
        </div>

        <div class="mt-4">
          <!-- File details — single compact badge. Folder location, sharing
               instructions, and other Drive-side details intentionally
               omitted from this success moment; they're available in
               Settings → Family Data and via the Pod page invite flow. -->
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
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
          class="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-blue-500 dark:text-gray-500"
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
              class="h-6 w-6 text-red-600 dark:text-red-400"
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
          <h3 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
            {{ t('googleDrive.authFailed') }}
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
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

    <!-- Setup progress modal -->
    <SetupProgressModal
      :open="showSetupModal"
      @complete="handleSetupComplete"
      @back="handleSetupBack"
    />
  </div>
</template>
