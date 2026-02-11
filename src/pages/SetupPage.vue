<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import PasswordModal from '@/components/common/PasswordModal.vue';
import { BaseButton, BaseInput, BaseSelect, BaseCard } from '@/components/ui';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies';
import { canAutoSync } from '@/services/sync/capabilities';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';

const router = useRouter();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();

const isSubmitting = ref(false);
const isLoadingFile = ref(false);
const loadFileError = ref<string | null>(null);
const showDecryptModal = ref(false);
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

const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

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

  if (!form.email.trim()) {
    errors.email = 'Email is required';
    return false;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email address';
    return false;
  }

  return true;
}

function nextStep() {
  if (step.value === 1 && validateStep1()) {
    step.value = 2;
  }
}

function prevStep() {
  if (step.value > 1) {
    step.value -= 1;
  }
}

async function completeSetup() {
  if (isSubmitting.value) return;

  isSubmitting.value = true;

  try {
    // Create the owner profile
    const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
    const member = await familyStore.createMember({
      name: form.name.trim(),
      email: form.email.trim(),
      role: 'owner',
      color: randomColor,
    });

    if (member) {
      familyStore.setCurrentMember(member.id);
    }

    // Set base currency
    await settingsStore.setBaseCurrency(form.baseCurrency);

    // Navigate to dashboard
    router.replace('/dashboard');
  } catch (error) {
    console.error('Setup failed:', error);
  } finally {
    isSubmitting.value = false;
  }
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
    class="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 dark:from-slate-900 dark:to-slate-800"
  >
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-blue-600 dark:text-blue-400">GP Family Finance</h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">Let's get you set up</p>
      </div>

      <BaseCard>
        <!-- Step indicator -->
        <div class="mb-8 flex items-center justify-center">
          <div class="flex items-center">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-full font-medium"
              :class="step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'"
            >
              1
            </div>
            <div class="mx-2 h-1 w-16" :class="step >= 2 ? 'bg-blue-600' : 'bg-gray-200'" />
            <div
              class="flex h-8 w-8 items-center justify-center rounded-full font-medium"
              :class="step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'"
            >
              2
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
          <div v-if="canAutoSync()" class="border-t border-gray-200 pt-4 dark:border-slate-700">
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
              Load Existing Data File
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
            <BaseButton class="flex-1" :loading="isSubmitting" @click="completeSetup">
              Get Started
            </BaseButton>
          </div>
        </div>
      </BaseCard>

      <!-- Footer -->
      <p class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Your data is stored locally and never leaves your device unless you enable sync.
      </p>
    </div>

    <!-- Decrypt File Password Modal -->
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
