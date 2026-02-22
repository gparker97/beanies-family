<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { celebrate } from '@/composables/useCelebration';
import PasswordModal from '@/components/common/PasswordModal.vue';
import { BaseButton, BaseInput, BaseSelect, BaseCard } from '@/components/ui';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useTranslation } from '@/composables/useTranslation';
import { canAutoSync } from '@/services/sync/capabilities';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Gender } from '@/types/models';

const router = useRouter();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const { t } = useTranslation();

// Authenticated users already have an email from their account — no need to ask again
const hasAuthEmail = computed(() => authStore.isAuthenticated && !!authStore.currentUser?.email);

const supportsFileSystemAccess = computed(() => canAutoSync());

const isSubmitting = ref(false);
const isLoadingFile = ref(false);
const isCreatingFile = ref(false);
const loadFileError = ref<string | null>(null);
const showDecryptModal = ref(false);
const showEncryptModal = ref(false);
const decryptError = ref<string | null>(null);
const step = ref(1);

const form = reactive({
  name: '',
  email: '',
  baseCurrency: DEFAULT_CURRENCY,
});

// Joiner detection: member with role 'member' but no owner in local DB
const isJoiner = computed(() => {
  return !familyStore.hasOwner && familyStore.members.some((m) => m.role === 'member');
});

const genderOptions = [
  { value: 'male', label: t('family.gender.male') },
  { value: 'female', label: t('family.gender.female') },
  { value: 'other', label: t('family.gender.other') },
];

const joinerForm = reactive({
  name: '',
  gender: 'male' as Gender,
  dateOfBirth: '',
  color: '#10b981',
  password: '',
  confirmPassword: '',
});
const joinerFormError = ref<string | null>(null);

// Pre-populate form with existing data from cloud signup
onMounted(() => {
  if (isJoiner.value) {
    const me = familyStore.members.find((m) => m.role === 'member');
    if (me) {
      joinerForm.name = me.name;
      joinerForm.gender = me.gender || 'male';
      joinerForm.color = me.color;
    }
    return;
  }
  const owner = familyStore.members.find((m) => m.role === 'owner');
  if (owner) {
    form.name = owner.name;
    form.email = owner.email;
  }
  if (hasAuthEmail.value && !form.email) {
    form.email = authStore.currentUser!.email;
  }
});

const errors = reactive({
  name: '',
  email: '',
});

const { currencyOptions } = useCurrencyOptions();

const colors: string[] = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];

function validateStep1(): boolean {
  errors.name = '';
  errors.email = '';

  if (!form.name.trim()) {
    errors.name = t('setup.nameRequired');
    return false;
  }

  // Email validation only needed for local-only users (authenticated users have email from auth)
  if (!hasAuthEmail.value) {
    if (!form.email.trim()) {
      errors.email = t('setup.emailRequired');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = t('setup.invalidEmail');
      return false;
    }
  }

  return true;
}

function nextStep() {
  if (step.value === 1 && validateStep1()) {
    step.value = 2;
  } else if (step.value === 2) {
    step.value = 3;
  }
}

function prevStep() {
  if (step.value > 1) {
    step.value -= 1;
  }
}

/**
 * Create the owner profile and save currency settings (Steps 1-2).
 * Called before step 3 (file creation) to ensure data exists to save.
 */
async function createProfileAndSettings(): Promise<boolean> {
  if (isSubmitting.value) return false;

  isSubmitting.value = true;

  try {
    const email = hasAuthEmail.value ? authStore.currentUser!.email : form.email.trim();
    const existingOwner = familyStore.members.find((m) => m.role === 'owner');

    if (existingOwner) {
      // Owner already exists (cloud signup) — update with any edits from the form
      await familyStore.updateMember(existingOwner.id, {
        name: form.name.trim(),
        email,
      });
      familyStore.setCurrentMember(existingOwner.id);
    } else {
      // Create the owner profile
      const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
      const member = await familyStore.createMember({
        name: form.name.trim(),
        email,
        gender: 'male',
        ageGroup: 'adult',
        role: 'owner',
        color: randomColor,
        requiresPassword: true,
      });

      if (member) {
        familyStore.setCurrentMember(member.id);
      }
    }

    // Set base currency
    await settingsStore.setBaseCurrency(form.baseCurrency);

    return true;
  } catch (error) {
    console.error('Setup failed:', error);
    return false;
  } finally {
    isSubmitting.value = false;
  }
}

/**
 * Create a new family data file. Opens file picker, then prompts for encryption password.
 */
async function handleCreateNewFile() {
  if (isCreatingFile.value) return;

  // Always save profile and settings (even if owner was pre-created during cloud signup)
  const profileReady = await createProfileAndSettings();
  if (!profileReady) return;

  isCreatingFile.value = true;
  loadFileError.value = null;

  try {
    const success = await syncStore.configureSyncFile();
    if (success) {
      // File created — now prompt for encryption password
      showEncryptModal.value = true;
    }
  } catch (error) {
    console.error('Failed to create file:', error);
    loadFileError.value = t('setup.fileCreateFailed');
  } finally {
    isCreatingFile.value = false;
  }
}

/**
 * After encryption password is set, navigate to dashboard.
 */
async function completeOnboarding() {
  await settingsStore.setOnboardingCompleted(true);
}

/**
 * Navigate to dashboard — guaranteed to execute even if prior steps fail.
 */
function navigateToDashboard() {
  syncStore.setupAutoSync();
  router.replace('/dashboard');
}

async function handleSetEncryptionPassword(password: string) {
  showEncryptModal.value = false;
  // Complete onboarding FIRST — before enableEncryption() which reloads settings
  await completeOnboarding();
  try {
    const success = await syncStore.enableEncryption(password);
    if (success) {
      celebrate('first-save');
    } else {
      celebrate('setup-complete');
    }
  } catch (e) {
    console.error('Encryption failed:', e);
  }
  navigateToDashboard();
}

// Encryption is mandatory — no skip option. The modal is non-closable.

/**
 * For browsers without File System Access API: complete setup without file.
 */
async function handleDownloadFallback() {
  const profileReady = await createProfileAndSettings();
  if (!profileReady) return;

  // Manual export as download
  await syncStore.manualExport();
  await completeOnboarding();
  celebrate('setup-complete');
  router.replace('/dashboard');
}

async function loadExistingData() {
  if (isLoadingFile.value) return;

  isLoadingFile.value = true;
  loadFileError.value = null;

  try {
    const result = await syncStore.loadFromNewFile();

    if (result.needsPassword) {
      // File is encrypted, show password modal
      isLoadingFile.value = false;
      showDecryptModal.value = true;
      return;
    }

    if (result.success) {
      // Data loaded successfully - set current member if we have one
      if (familyStore.members.length > 0) {
        const owner = familyStore.members.find((m) => m.role === 'owner') ?? familyStore.members[0];
        if (owner) {
          familyStore.setCurrentMember(owner.id);
        }
      }
      await completeOnboarding();
      syncStore.setupAutoSync();
      // Navigate to dashboard
      router.replace('/dashboard');
    } else if (syncStore.error) {
      loadFileError.value = syncStore.error;
    }
  } catch (error) {
    console.error('Failed to load existing data:', error);
    loadFileError.value = 'Failed to load file. Please try again.';
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleDecryptFile(password: string) {
  isLoadingFile.value = true;
  decryptError.value = null;

  const result = await syncStore.decryptPendingFile(password);

  if (result.success) {
    showDecryptModal.value = false;
    // Data loaded successfully - set current member if we have one
    if (familyStore.members.length > 0) {
      const owner = familyStore.members.find((m) => m.role === 'owner') ?? familyStore.members[0];
      if (owner) {
        familyStore.setCurrentMember(owner.id);
      }
    }
    await completeOnboarding();
    syncStore.setupAutoSync();
    // Navigate to dashboard
    router.replace('/dashboard');
  } else {
    decryptError.value = result.error ?? 'Failed to decrypt file';
    isLoadingFile.value = false;
  }
}

function handleDecryptModalClose() {
  showDecryptModal.value = false;
  syncStore.clearPendingEncryptedFile();
  decryptError.value = null;
}

async function completeJoinerSetup() {
  joinerFormError.value = null;
  const me = familyStore.members.find((m) => m.role === 'member');
  if (!me) return;

  // Validate password
  if (!joinerForm.password) {
    joinerFormError.value = t('auth.enterPassword');
    return;
  }
  if (joinerForm.password.length < 8) {
    joinerFormError.value = t('auth.passwordMinLength');
    return;
  }
  if (joinerForm.password !== joinerForm.confirmPassword) {
    joinerFormError.value = t('auth.passwordsDoNotMatch');
    return;
  }

  await familyStore.updateMember(me.id, {
    name: joinerForm.name.trim(),
    gender: joinerForm.gender,
    dateOfBirth: joinerForm.dateOfBirth
      ? {
          month: parseInt(joinerForm.dateOfBirth.split('-')[1] ?? '1', 10),
          day: parseInt(joinerForm.dateOfBirth.split('-')[2] ?? '1', 10),
          year: parseInt(joinerForm.dateOfBirth.split('-')[0] ?? '2000', 10),
        }
      : undefined,
    color: joinerForm.color,
  });

  // Set the member's password
  await authStore.setPassword(me.id, joinerForm.password);

  familyStore.setCurrentMember(me.id);
  await settingsStore.setOnboardingCompleted(true);

  // Ensure auto-sync is running and save immediately so password hash persists to file
  syncStore.setupAutoSync();
  await syncStore.syncNow(true);

  celebrate('setup-complete');
  router.replace('/dashboard');
}
</script>

<template>
  <div
    class="from-sky-silk-50 to-sky-silk-100 flex min-h-screen items-center justify-center bg-gradient-to-br p-4 dark:from-slate-900 dark:to-slate-800"
  >
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <h1 class="font-outfit text-secondary-500 text-3xl font-bold dark:text-gray-100">
          beanies.family
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">{{ t('setup.subtitle') }}</p>
      </div>

      <BaseCard>
        <!-- Joiner: simplified 1-step profile form -->
        <div v-if="isJoiner" class="space-y-5">
          <div>
            <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {{ t('setup.joinerTitle') }}
            </h2>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {{ t('setup.joinerSubtitle') }}
            </p>
          </div>

          <BaseInput
            v-model="joinerForm.name"
            :label="t('setup.yourName')"
            :placeholder="t('setup.enterYourName')"
            required
          />

          <BaseSelect
            v-model="joinerForm.gender"
            :options="genderOptions"
            :label="t('family.gender')"
          />

          <BaseInput v-model="joinerForm.dateOfBirth" type="date" :label="t('setup.dateOfBirth')" />

          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('setup.selectColor') }}
            </label>
            <div class="flex gap-2">
              <button
                v-for="c in colors"
                :key="c"
                type="button"
                class="h-8 w-8 rounded-full border-2 transition-all"
                :class="
                  joinerForm.color === c
                    ? 'scale-110 border-gray-900 dark:border-white'
                    : 'border-transparent'
                "
                :style="{ backgroundColor: c }"
                @click="joinerForm.color = c"
              />
            </div>
          </div>

          <BaseInput
            v-model="joinerForm.password"
            :label="t('auth.createPassword')"
            type="password"
            :placeholder="t('auth.passwordPlaceholder')"
            required
          />

          <BaseInput
            v-model="joinerForm.confirmPassword"
            :label="t('auth.confirmPassword')"
            type="password"
            :placeholder="t('auth.confirmPasswordPlaceholder')"
            required
          />

          <div
            v-if="joinerFormError"
            class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            {{ joinerFormError }}
          </div>

          <BaseButton class="w-full" @click="completeJoinerSetup">
            {{ t('setup.completeProfile') }}
          </BaseButton>
        </div>

        <!-- Owner: 3-step setup wizard -->
        <div v-else>
          <!-- Step indicator (3 steps) -->
          <div class="mb-8 flex items-center justify-center">
            <div class="flex items-center">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-full font-medium"
                :class="step >= 1 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-500'"
              >
                1
              </div>
              <div class="mx-2 h-1 w-12" :class="step >= 2 ? 'bg-primary-500' : 'bg-gray-200'" />
              <div
                class="flex h-8 w-8 items-center justify-center rounded-full font-medium"
                :class="step >= 2 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-500'"
              >
                2
              </div>
              <div class="mx-2 h-1 w-12" :class="step >= 3 ? 'bg-primary-500' : 'bg-gray-200'" />
              <div
                class="flex h-8 w-8 items-center justify-center rounded-full font-medium"
                :class="step >= 3 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-500'"
              >
                3
              </div>
            </div>
          </div>

          <!-- Step 1: Personal Info -->
          <div v-if="step === 1" class="space-y-4">
            <h2 class="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {{ t('setup.createProfile') }}
            </h2>

            <BaseInput
              v-model="form.name"
              :label="t('setup.yourName')"
              :placeholder="t('setup.enterYourName')"
              :error="errors.name"
              required
            />

            <BaseInput
              v-if="!hasAuthEmail"
              v-model="form.email"
              type="email"
              :label="t('setup.emailAddress')"
              :placeholder="t('setup.enterYourEmail')"
              :error="errors.email"
              required
            />

            <div class="pt-4">
              <BaseButton class="w-full" @click="nextStep"> {{ t('action.continue') }} </BaseButton>
            </div>

            <!-- Load existing data option -->
            <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
              <p class="mb-3 text-center text-sm text-gray-500 dark:text-gray-400">
                {{ t('setup.haveExistingFile') }}
              </p>
              <BaseButton
                variant="secondary"
                class="w-full"
                :loading="isLoadingFile"
                @click="loadExistingData"
              >
                <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                {{ t('setup.loadExistingFile') }}
              </BaseButton>
              <p
                v-if="loadFileError"
                class="mt-2 text-center text-sm text-red-600 dark:text-red-400"
              >
                {{ loadFileError }}
              </p>
            </div>
          </div>

          <!-- Step 2: Preferences -->
          <div v-if="step === 2" class="space-y-4">
            <h2 class="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {{ t('setup.setPreferences') }}
            </h2>

            <BaseSelect
              v-model="form.baseCurrency"
              :options="currencyOptions"
              :label="t('settings.baseCurrency')"
              :hint="t('setup.baseCurrencyHint')"
            />

            <div class="flex gap-3 pt-4">
              <BaseButton variant="secondary" class="flex-1" @click="prevStep">
                {{ t('action.back') }}
              </BaseButton>
              <BaseButton class="flex-1" @click="nextStep"> {{ t('action.continue') }} </BaseButton>
            </div>
          </div>

          <!-- Step 3: Secure Your Data -->
          <div v-if="step === 3" class="space-y-4">
            <h2 class="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {{ t('setup.secureData') }}
            </h2>

            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ t('setup.securityDescription') }}
            </p>

            <!-- Security feature list -->
            <div class="bg-sky-silk-50 dark:bg-secondary-700/30 space-y-3 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <img
                  src="/brand/beanies_impact_bullet_transparent_192x192.png"
                  alt=""
                  class="mt-0.5 h-5 w-5 flex-shrink-0"
                />
                <p class="text-secondary-500 dark:text-sky-silk-300 text-sm">
                  {{ t('setup.securityEncrypted') }}
                </p>
              </div>
              <div class="flex items-start gap-3">
                <img
                  src="/brand/beanies_impact_bullet_transparent_192x192.png"
                  alt=""
                  class="mt-0.5 h-5 w-5 flex-shrink-0"
                />
                <p class="text-secondary-500 dark:text-sky-silk-300 text-sm">
                  {{ t('setup.securityAutoSaved') }}
                </p>
              </div>
              <div class="flex items-start gap-3">
                <img
                  src="/brand/beanies_impact_bullet_transparent_192x192.png"
                  alt=""
                  class="mt-0.5 h-5 w-5 flex-shrink-0"
                />
                <p class="text-secondary-500 dark:text-sky-silk-300 text-sm">
                  {{ t('setup.securityYouControl') }}
                </p>
              </div>
            </div>

            <!-- File System Access API available -->
            <div v-if="supportsFileSystemAccess" class="flex flex-col gap-3 pt-2">
              <BaseButton class="w-full" :loading="isCreatingFile" @click="handleCreateNewFile">
                <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                {{ t('setup.createDataFile') }}
              </BaseButton>
              <BaseButton
                variant="secondary"
                class="w-full"
                :loading="isLoadingFile"
                @click="loadExistingData"
              >
                <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                {{ t('setup.loadExistingFile') }}
              </BaseButton>
            </div>

            <!-- Fallback for browsers without File System Access API -->
            <div v-else class="pt-2">
              <div
                class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
              >
                <p class="text-sm text-amber-800 dark:text-amber-200">
                  {{ t('setup.browserWarning') }}
                </p>
              </div>
              <BaseButton class="w-full" :loading="isSubmitting" @click="handleDownloadFallback">
                {{ t('setup.downloadData') }}
              </BaseButton>
            </div>

            <p v-if="loadFileError" class="text-center text-sm text-red-600 dark:text-red-400">
              {{ loadFileError }}
            </p>

            <div class="pt-2">
              <BaseButton variant="secondary" class="w-full" @click="prevStep">
                {{ t('action.back') }}
              </BaseButton>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- Footer -->
      <p class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('setup.footerNote') }}
      </p>
    </div>

    <!-- Encrypt File Password Modal (for new file creation) -->
    <PasswordModal
      :open="showEncryptModal"
      :title="t('password.setPassword')"
      :description="t('password.strongPasswordDescription')"
      :confirm-label="t('password.setAndContinue')"
      :require-confirmation="true"
      :closable="false"
      @confirm="handleSetEncryptionPassword"
    />

    <!-- Decrypt File Password Modal (for loading existing file) -->
    <PasswordModal
      :open="showDecryptModal"
      :title="t('password.enterPassword')"
      :description="t('password.encryptedFileDescription')"
      :confirm-label="t('password.decryptAndLoad')"
      @close="handleDecryptModalClose"
      @confirm="handleDecryptFile"
    />

    <!-- Decrypt error display -->
    <div
      v-if="decryptError"
      class="fixed right-4 bottom-4 max-w-sm rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg dark:border-red-800 dark:bg-red-900/90"
    >
      <div class="flex items-start gap-3">
        <svg
          class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <p class="text-sm font-medium text-red-800 dark:text-red-200">
            {{ t('password.decryptionError') }}
          </p>
          <p class="mt-1 text-sm text-red-600 dark:text-red-300">{{ decryptError }}</p>
        </div>
        <button
          class="text-red-400 hover:text-red-600 dark:hover:text-red-200"
          @click="decryptError = null"
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
  </div>
</template>
