<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import { celebrate } from '@/composables/useCelebration';
import PasswordModal from '@/components/common/PasswordModal.vue';
import { BaseButton, BaseInput, BaseSelect, BaseCard } from '@/components/ui';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { canAutoSync } from '@/services/sync/capabilities';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';

const router = useRouter();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();

// Authenticated users already have an email from their account — no need to ask again
const hasAuthEmail = computed(
  () => authStore.isAuthenticated && !authStore.isLocalOnlyMode && !!authStore.currentUser?.email
);

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
    errors.name = 'Name is required';
    return false;
  }

  // Email validation only needed for local-only users (authenticated users have email from auth)
  if (!hasAuthEmail.value) {
    if (!form.email.trim()) {
      errors.email = 'Email is required';
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Please enter a valid email address';
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
    // Create the owner profile
    const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
    const email = hasAuthEmail.value ? authStore.currentUser!.email : form.email.trim();
    const member = await familyStore.createMember({
      name: form.name.trim(),
      email,
      gender: 'male',
      ageGroup: 'adult',
      role: 'owner',
      color: randomColor,
    });

    if (member) {
      familyStore.setCurrentMember(member.id);
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

  // Ensure profile and settings are saved first
  const profileReady = familyStore.isSetupComplete || (await createProfileAndSettings());
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
    loadFileError.value = 'Failed to create file. Please try again.';
  } finally {
    isCreatingFile.value = false;
  }
}

/**
 * After encryption password is set, navigate to dashboard.
 */
async function handleSetEncryptionPassword(password: string) {
  const success = await syncStore.enableEncryption(password);
  showEncryptModal.value = false;
  if (success) {
    celebrate('first-save');
    syncStore.setupAutoSync();
    router.replace('/dashboard');
  } else {
    loadFileError.value = 'Failed to encrypt file. You can configure encryption later in Settings.';
    // Still navigate — file was created, just not encrypted
    celebrate('setup-complete');
    syncStore.setupAutoSync();
    router.replace('/dashboard');
  }
}

/**
 * Skip encryption (user chose not to set a password) and go to dashboard.
 */
function handleSkipEncryption() {
  showEncryptModal.value = false;
  celebrate('setup-complete');
  syncStore.setupAutoSync();
  router.replace('/dashboard');
}

/**
 * For browsers without File System Access API: complete setup without file.
 */
async function handleDownloadFallback() {
  const profileReady = familyStore.isSetupComplete || (await createProfileAndSettings());
  if (!profileReady) return;

  // Manual export as download
  await syncStore.manualExport();
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
        <p class="mt-2 text-gray-600 dark:text-gray-400">Let's get you set up</p>
      </div>

      <BaseCard>
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
            Create Your Profile
          </h2>

          <BaseInput
            v-model="form.name"
            label="Your Name"
            placeholder="Enter your name"
            :error="errors.name"
            required
          />

          <BaseInput
            v-if="!hasAuthEmail"
            v-model="form.email"
            type="email"
            label="Email Address"
            placeholder="Enter your email"
            :error="errors.email"
            required
          />

          <div class="pt-4">
            <BaseButton class="w-full" @click="nextStep"> Continue </BaseButton>
          </div>

          <!-- Load existing data option -->
          <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
            <p class="mb-3 text-center text-sm text-gray-500 dark:text-gray-400">
              Have an existing data file?
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
              Load Existing Family Data File
            </BaseButton>
            <p v-if="loadFileError" class="mt-2 text-center text-sm text-red-600 dark:text-red-400">
              {{ loadFileError }}
            </p>
          </div>
        </div>

        <!-- Step 2: Preferences -->
        <div v-if="step === 2" class="space-y-4">
          <h2 class="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            Set Your Preferences
          </h2>

          <BaseSelect
            v-model="form.baseCurrency"
            :options="currencyOptions"
            label="Base Currency"
            hint="This will be your primary currency for displaying totals"
          />

          <div class="flex gap-3 pt-4">
            <BaseButton variant="secondary" class="flex-1" @click="prevStep"> Back </BaseButton>
            <BaseButton class="flex-1" @click="nextStep"> Continue </BaseButton>
          </div>
        </div>

        <!-- Step 3: Secure Your Data -->
        <div v-if="step === 3" class="space-y-4">
          <h2 class="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            Secure Your Data
          </h2>

          <p class="text-sm text-gray-600 dark:text-gray-400">
            Your data is encrypted and saved to a file you control. No data is stored on our
            servers. You can place this file in Google Drive, Dropbox, or any synced folder for
            cloud backup.
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
                Encrypted with a password only you know
              </p>
            </div>
            <div class="flex items-start gap-3">
              <img
                src="/brand/beanies_impact_bullet_transparent_192x192.png"
                alt=""
                class="mt-0.5 h-5 w-5 flex-shrink-0"
              />
              <p class="text-secondary-500 dark:text-sky-silk-300 text-sm">
                Saved automatically as you make changes
              </p>
            </div>
            <div class="flex items-start gap-3">
              <img
                src="/brand/beanies_impact_bullet_transparent_192x192.png"
                alt=""
                class="mt-0.5 h-5 w-5 flex-shrink-0"
              />
              <p class="text-secondary-500 dark:text-sky-silk-300 text-sm">
                You control where the file is stored
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
              Create New Family Data File
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
              Load Existing Family Data File
            </BaseButton>
          </div>

          <!-- Fallback for browsers without File System Access API -->
          <div v-else class="pt-2">
            <div
              class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
            >
              <p class="text-sm text-amber-800 dark:text-amber-200">
                For automatic saving, use Chrome or Edge. You can still download your data manually.
              </p>
            </div>
            <BaseButton class="w-full" :loading="isSubmitting" @click="handleDownloadFallback">
              Download Your Data
            </BaseButton>
          </div>

          <p v-if="loadFileError" class="text-center text-sm text-red-600 dark:text-red-400">
            {{ loadFileError }}
          </p>

          <div class="pt-2">
            <BaseButton variant="secondary" class="w-full" @click="prevStep"> Back </BaseButton>
          </div>
        </div>
      </BaseCard>

      <!-- Footer -->
      <p class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Your data is encrypted and stored in a file you control — not on our servers.
      </p>
    </div>

    <!-- Encrypt File Password Modal (for new file creation) -->
    <PasswordModal
      :open="showEncryptModal"
      title="Set Encryption Password"
      description="Choose a strong password to protect your data file. You'll need this password each time you open the app."
      confirm-label="Set Password & Continue"
      :require-confirmation="true"
      @close="handleSkipEncryption"
      @confirm="handleSetEncryptionPassword"
    />

    <!-- Decrypt File Password Modal (for loading existing file) -->
    <PasswordModal
      :open="showDecryptModal"
      title="Enter Password"
      description="This file is encrypted. Enter your password to decrypt and load your data."
      confirm-label="Decrypt & Load"
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
          <p class="text-sm font-medium text-red-800 dark:text-red-200">Decryption Error</p>
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
