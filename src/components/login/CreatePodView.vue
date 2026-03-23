<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import * as syncService from '@/services/sync/syncService';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import { clearFolderCache } from '@/services/google/driveService';
import { slackNotify } from '@/utils/slackNotify';
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

// Step 2 state
const storageSaved = ref(false);
const isSavingStorage = ref(false);
const storageType = ref<'local' | 'google_drive' | null>(null);
const showDriveResultModal = ref(false);
const driveResultError = ref<string | null>(null);
const showLocalFileWarning = ref(false);

// Step 3 state
const addedMembers = ref<FamilyMember[]>([]);
const isAddingMember = ref(false);
const isFinishing = ref(false);
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
  });

  if (result.success) {
    slackNotify(
      `🫘 *New family pod started!*\n*Family:* ${familyName.value}\n*Owner:* ${name.value}`
    );
    currentStep.value = 2;
    formError.value = null;
  } else {
    formError.value = result.error ?? t('auth.signUpFailed');
  }
}

function handleLocalFileClick() {
  showLocalFileWarning.value = true;
}

async function handleChooseLocalStorage() {
  showLocalFileWarning.value = false;
  isSavingStorage.value = true;
  formError.value = null;

  try {
    // Only select the file/set up the provider — don't save yet.
    // createNewFile() in handleStep2Next will initialize the doc and write the V4 envelope.
    const success = await syncService.selectSyncFile();
    if (success) {
      storageSaved.value = true;
      storageType.value = 'local';
    } else {
      formError.value = t('setup.fileCreateFailed');
    }
  } catch {
    formError.value = t('setup.fileCreateFailed');
  } finally {
    isSavingStorage.value = false;
  }
}

async function handleChooseGoogleDriveStorage() {
  if (!syncStore.isGoogleDriveAvailable) return;
  if (storageType.value === 'google_drive') return; // Already connected
  if (isSavingStorage.value) return; // Already in progress

  isSavingStorage.value = true;
  formError.value = null;
  driveResultError.value = null;

  try {
    // Only create the Drive provider — don't save yet.
    // createNewFile() in handleStep2Next will initialize the doc and write the V4 envelope.
    const podFileName = `${familyName.value || 'my-family'}.beanpod`;
    const provider = await GoogleDriveProvider.createNew(podFileName);
    syncService.setProvider(provider);

    const familyId = familyContextStore.activeFamilyId;
    if (familyId) {
      await provider.persist(familyId);
    }

    storageSaved.value = true;
    storageType.value = 'google_drive';
  } catch (e) {
    driveResultError.value = (e as Error).message || t('googleDrive.authFailed');
    // Clear stale folder cache so retry starts fresh (prevents cross-account 404)
    clearFolderCache();
  } finally {
    isSavingStorage.value = false;
    showDriveResultModal.value = true;
  }
}

function handleDriveModalContinue() {
  showDriveResultModal.value = false;
  handleStep2Next();
}

async function handleStep2Next() {
  formError.value = null;

  // Storage location is required
  if (!storageSaved.value) {
    formError.value = t('setup.fileCreateFailed');
    return;
  }

  // Initialize the Automerge document, generate keys, and write V4 envelope to the provider.
  // Uses the member password from Step 1 to derive the wrapping key for the family key.
  if (syncStore.isConfigured && authStore.currentUser) {
    const podFileName = `${familyName.value || 'my-family'}.beanpod`;
    const success = await syncStore.createNewFile(
      podFileName,
      password.value,
      authStore.currentUser.memberId,
      familyContextStore.activeFamilyId ?? '',
      familyName.value
    );
    if (!success) {
      formError.value = syncStore.error ?? t('setup.fileCreateFailed');
      return;
    }
  }

  currentStep.value = 3;
  formError.value = null;
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

async function handleFinish() {
  isFinishing.value = true;
  // Save to file if configured — the doc + family key are initialized by createNewFile() in Step 2
  if (syncStore.isConfigured) {
    let saved = await syncStore.syncNow(true);
    if (!saved) {
      // Retry once — transient errors (Google Drive token refresh, permission prompt) often resolve
      console.warn('[CreatePod] Initial save failed, retrying...');
      saved = await syncStore.syncNow(true);
      if (!saved) {
        console.warn(
          '[CreatePod] Save failed after retry — data is cached locally but not persisted to file'
        );
      }
    }
    syncStore.setupAutoSync();
    syncStore.ensureRegistered();
  }
  const memberNames = addedMembers.value.map((m) => m.name);
  const allMembers = [name.value, ...memberNames];
  const storage = storageType.value === 'google_drive' ? 'Google Drive' : 'Local File';
  slackNotify(
    `🎉 *Family pod created!*\n*Family:* ${familyName.value}\n*Members (${allMembers.length}):* ${allMembers.join(', ')}\n*Storage:* ${storage}`
  );
  emit('signed-in', '/nook');
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
  <div class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
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
      <h2 class="font-outfit mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.growPodTitle') }} 🌱
      </h2>
      <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.growPodSubtitle') }}
      </p>

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

        <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
          {{ authStore.isLoading ? t('auth.creatingAccount') : t('loginV6.createNext') }}
        </BaseButton>
      </form>
    </div>

    <!-- Step 2: Save & Secure -->
    <div v-else-if="currentStep === 2">
      <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.step2Title') }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.step2Subtitle') }}
      </p>

      <!-- Storage section — v6 styled rounded box -->
      <div
        class="border-primary-500/15 bg-primary-500/[0.02] dark:border-primary-500/10 dark:bg-primary-500/[0.03] rounded-[18px] border-2 p-4"
      >
        <div
          class="font-outfit text-primary-500 mb-1.5 text-xs font-bold tracking-[0.1em] uppercase"
        >
          {{ t('loginV6.storageSectionLabel') }}
        </div>
        <p class="text-secondary-500 mb-3 text-xs leading-relaxed opacity-40 dark:text-gray-300">
          {{ t('loginV6.storageDescription') }}
        </p>

        <!-- Available storage options -->
        <div class="grid grid-cols-2 gap-2">
          <!-- Google Drive -->
          <button
            v-if="syncStore.isGoogleDriveAvailable"
            class="flex h-[88px] flex-col items-center justify-center rounded-[14px] border-2 px-2.5 transition-all"
            :class="
              storageType === 'google_drive'
                ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                : isSavingStorage
                  ? 'border-blue-300 bg-blue-50/50 dark:border-blue-600/50 dark:bg-blue-900/15'
                  : 'border-primary-500/40 bg-primary-500/[0.04] hover:border-primary-500 hover:bg-primary-500/[0.08] dark:border-primary-500/30 dark:bg-primary-500/[0.06] dark:hover:border-primary-500/50'
            "
            @click="handleChooseGoogleDriveStorage"
          >
            <BeanieSpinner
              v-if="isSavingStorage && storageType !== 'google_drive'"
              size="sm"
              class="mb-1.5"
            />
            <svg
              v-else-if="storageType === 'google_drive'"
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
              class="mb-1.5 h-6 w-6"
              viewBox="0 0 87.3 78"
              xmlns="http://www.w3.org/2000/svg"
            >
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
            <span
              class="font-outfit text-xs font-semibold"
              :class="
                storageType === 'google_drive'
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-900 dark:text-gray-100'
              "
            >
              {{
                isSavingStorage && storageType !== 'google_drive'
                  ? t('googleDrive.connecting')
                  : t('googleDrive.storageLabel')
              }}
            </span>
            <span
              v-if="storageType !== 'google_drive'"
              class="bg-primary-500/15 text-primary-500 mt-1 rounded-full px-2 py-0.5 text-xs font-bold"
              >{{ t('storage.recommended') }}</span
            >
          </button>
          <div
            v-else
            class="flex h-[88px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50 px-2.5 opacity-50 dark:bg-slate-700/40"
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
              class="bg-primary-500/10 text-primary-500 mt-1 rounded-full px-2 py-0.5 text-center text-xs font-bold whitespace-nowrap"
              >{{ t('storage.comingSoon') }}</span
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

        <!-- Coming soon providers -->
        <div class="mt-2 grid grid-cols-3 gap-2">
          <!-- Dropbox (coming soon) -->
          <div
            class="flex h-[72px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50/60 px-2.5 opacity-40 dark:bg-slate-700/30"
          >
            <svg class="mb-1 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2L6 6.5l6 4.5-6 4.5L12 20l6-4.5-6-4.5 6-4.5L12 2zm0 13l-4-3 4-3 4 3-4 3z"
              />
            </svg>
            <span
              class="font-outfit text-center text-xs font-semibold whitespace-nowrap text-gray-500 dark:text-gray-500"
              >{{ t('storage.dropbox') }}</span
            >
            <span class="mt-0.5 text-center text-xs text-gray-400 dark:text-gray-500">{{
              t('storage.comingSoon')
            }}</span>
          </div>

          <!-- iCloud (coming soon) -->
          <div
            class="flex h-[72px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50/60 px-2.5 opacity-40 dark:bg-slate-700/30"
          >
            <svg class="mb-1 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"
              />
            </svg>
            <span
              class="font-outfit text-center text-xs font-semibold whitespace-nowrap text-gray-500 dark:text-gray-500"
              >{{ t('storage.iCloud') }}</span
            >
            <span class="mt-0.5 text-center text-xs text-gray-400 dark:text-gray-500">{{
              t('storage.comingSoon')
            }}</span>
          </div>

          <!-- OneDrive (coming soon) -->
          <div
            class="flex h-[72px] cursor-not-allowed flex-col items-center justify-center rounded-[14px] border-2 border-transparent bg-gray-50/60 px-2.5 opacity-40 dark:bg-slate-700/30"
          >
            <svg class="mb-1 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M10.5 18H18a4.5 4.5 0 0 0 .87-8.92A6 6 0 0 0 6.25 10.1 4 4 0 0 0 7 18h3.5z"
              />
            </svg>
            <span
              class="font-outfit text-center text-xs font-semibold whitespace-nowrap text-gray-500 dark:text-gray-500"
              >OneDrive</span
            >
            <span class="mt-0.5 text-center text-xs text-gray-400 dark:text-gray-500">{{
              t('storage.comingSoon')
            }}</span>
          </div>
        </div>
      </div>

      <BaseButton class="mt-6 w-full" :disabled="!storageSaved" @click="handleStep2Next">
        {{ t('loginV6.createNext') }}
      </BaseButton>
    </div>

    <!-- Step 3: Add Family Members -->
    <div v-else-if="currentStep === 3">
      <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.addBeansTitle') }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.addBeansSubtitle') }}
      </p>

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
              }}
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

      <!-- Add member form -->
      <div
        v-if="showMemberForm"
        class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-600"
      >
        <!-- Role toggle -->
        <div class="flex items-center gap-3">
          <span
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
            >{{ t('form.type') }}</span
          >
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
        </div>

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

      <BaseButton
        class="mt-6 w-full"
        :disabled="isFinishing"
        :loading="isFinishing"
        @click="handleFinish"
      >
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

    <!-- Local file warning modal -->
    <BaseModal :open="showLocalFileWarning" size="sm" @close="showLocalFileWarning = false">
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2">
          <svg
            class="h-5 w-5 flex-shrink-0 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
            {{ t('storage.localFile') }}
          </h3>
        </div>
        <p class="mb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {{ t('storage.localFileWarning') }}
        </p>
        <p class="mb-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          🔒 {{ t('storage.localFileWarningEncryption') }}
        </p>
        <div class="flex gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            class="flex-1"
            @click="showLocalFileWarning = false"
          >
            {{ t('action.back') }}
          </BaseButton>
          <BaseButton size="sm" class="flex-1" @click="handleChooseLocalStorage">
            {{ t('storage.localFileContinue') }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>

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
        </div>

        <div class="mt-4 space-y-3">
          <!-- File details -->
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
            <div class="flex items-center gap-2.5">
              <CloudProviderBadge
                provider-type="google_drive"
                :file-name="syncStore.fileName"
                :account-email="syncStore.providerAccountEmail"
                size="md"
              />
            </div>
            <p class="mt-1 pl-5 text-xs text-gray-500 dark:text-gray-400">
              {{ t('googleDrive.fileLocation') }}
            </p>
          </div>

          <!-- Sharing hint — prominent callout -->
          <div
            class="border-primary-500/25 bg-primary-500/[0.06] dark:border-primary-500/15 dark:bg-primary-500/[0.08] rounded-xl border p-3"
          >
            <div class="flex gap-2.5">
              <img
                src="/brand/beanies_impact_bullet_transparent_192x192.png"
                alt=""
                class="mt-0.5 h-5 w-5 flex-shrink-0"
              />
              <p class="text-secondary-500 text-sm leading-relaxed font-medium dark:text-gray-200">
                {{ t('googleDrive.shareHint') }}
              </p>
            </div>
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

        <BaseButton class="mt-4 w-full" @click="showDriveResultModal = false">
          {{ t('action.ok') }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
