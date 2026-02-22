<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();
const settingsStore = useSettingsStore();

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
}>();

const password = ref('');
const confirmPassword = ref('');
const selectedMember = ref<FamilyMember | null>(null);
const formError = ref<string | null>(null);
const needsFileLoad = ref(false);
const isLoadingFile = ref(false);
const needsDecryptPassword = ref(false);
const decryptPassword = ref('');

// All selectable members (both with and without passwords)
const allMembers = computed(() => familyStore.members);

// Whether the selected member needs to create a password
const isCreatingPassword = computed(
  () => selectedMember.value && !selectedMember.value.passwordHash
);

onMounted(async () => {
  // If no members loaded yet, we need to load the file first
  if (familyStore.members.length === 0) {
    // Activate last active family so sync can find the stored file handle
    if (!familyContextStore.activeFamilyId) {
      await familyContextStore.initialize();
    }

    // Try to initialize sync to check if file is configured
    if (!syncStore.isConfigured) {
      await syncStore.initialize();
    }

    if (syncStore.isConfigured && !syncStore.needsPermission) {
      isLoadingFile.value = true;
      try {
        const loadResult = await syncStore.loadFromFile();
        if (!loadResult.success && loadResult.needsPassword) {
          // File is encrypted — show decrypt password form
          needsDecryptPassword.value = true;
        }
      } catch {
        // File load failed
      }
      isLoadingFile.value = false;
    }

    // If still no members, user needs to load a file manually
    if (familyStore.members.length === 0 && !needsFileLoad.value) {
      needsFileLoad.value = true;
    }
  }
});

function selectMember(member: FamilyMember) {
  selectedMember.value = member;
  password.value = '';
  confirmPassword.value = '';
  formError.value = null;
}

async function handleSignIn() {
  formError.value = null;

  if (!selectedMember.value) {
    formError.value = t('auth.selectMember');
    return;
  }

  if (!password.value) {
    formError.value = t('auth.enterPassword');
    return;
  }

  // If member has no password yet, create one
  if (isCreatingPassword.value) {
    if (password.value.length < 8) {
      formError.value = t('auth.passwordMinLength');
      return;
    }
    if (password.value !== confirmPassword.value) {
      formError.value = t('auth.passwordsDoNotMatch');
      return;
    }

    const result = await authStore.setPassword(selectedMember.value.id, password.value);
    if (result.success) {
      // Save to file immediately so password persists
      syncStore.setupAutoSync();
      await syncStore.syncNow(true);

      let destination = '/dashboard';
      if (!settingsStore.onboardingCompleted) {
        destination = '/setup';
      }
      emit('signed-in', destination);
    } else {
      formError.value = result.error ?? t('auth.signInFailed');
    }
    return;
  }

  // Normal sign-in with existing password
  const result = await authStore.signIn(selectedMember.value.id, password.value);
  if (result.success) {
    let destination = '/dashboard';
    if (!settingsStore.onboardingCompleted) {
      destination = '/setup';
    }
    emit('signed-in', destination);
  } else {
    formError.value = result.error ?? t('auth.signInFailed');
  }
}

async function handleLoadFile() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.loadFromNewFile();
    if (result.success) {
      needsFileLoad.value = false;
    } else if (result.needsPassword) {
      // File is encrypted — show decrypt password form
      needsDecryptPassword.value = true;
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleDecrypt() {
  if (!decryptPassword.value) {
    formError.value = t('password.required');
    return;
  }

  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.decryptPendingFile(decryptPassword.value);
    if (result.success) {
      needsDecryptPassword.value = false;
      needsFileLoad.value = false;
      decryptPassword.value = '';
    } else {
      formError.value = result.error ?? t('password.decryptionError');
    }
  } catch {
    formError.value = t('password.decryptionError');
  } finally {
    isLoadingFile.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <button
        class="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-300"
        @click="$emit('back')"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('auth.signIn') }}
      </h2>
    </div>

    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Loading file -->
    <div v-if="isLoadingFile" class="py-8 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('auth.loadingFile') }}</p>
    </div>

    <!-- Need to load file first -->
    <div v-else-if="needsFileLoad && !needsDecryptPassword" class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.loadFileFirst') }}
      </p>
      <BaseButton class="w-full" @click="handleLoadFile">
        {{ t('auth.openDataFile') }}
      </BaseButton>
    </div>

    <!-- Encrypted file needs password -->
    <div v-else-if="needsDecryptPassword" class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('password.encryptedFileDescription') }}
      </p>
      <form @submit.prevent="handleDecrypt">
        <BaseInput
          v-model="decryptPassword"
          :label="t('password.password')"
          type="password"
          :placeholder="t('password.enterPasswordPlaceholder')"
          required
        />
        <BaseButton type="submit" class="mt-4 w-full" :disabled="isLoadingFile">
          {{ t('password.decryptAndLoad') }}
        </BaseButton>
      </form>
    </div>

    <!-- No members at all -->
    <div v-else-if="allMembers.length === 0" class="py-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.noMembersWithPassword') }}
      </p>
    </div>

    <!-- Member picker + password form -->
    <div v-else>
      <!-- Member picker — always shown so user can see all members -->
      <div v-if="!selectedMember" class="mb-4 space-y-2">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('auth.selectMember') }}
        </p>
        <button
          v-for="member in allMembers"
          :key="member.id"
          class="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
          @click="selectMember(member)"
        >
          <BeanieAvatar :variant="getMemberAvatarVariant(member)" :color="member.color" size="sm" />
          <div class="flex-1">
            <p class="font-medium text-gray-900 dark:text-gray-100">{{ member.name }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ member.email }}</p>
          </div>
          <span
            v-if="!member.passwordHash"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          >
            {{ t('auth.needsPassword') }}
          </span>
        </button>
      </div>

      <!-- Selected member + password -->
      <form v-if="selectedMember" @submit.prevent="handleSignIn">
        <!-- Show who is signing in -->
        <div class="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-slate-800">
          <BeanieAvatar
            :variant="getMemberAvatarVariant(selectedMember)"
            :color="selectedMember.color"
            size="sm"
          />
          <div class="flex-1">
            <p class="font-medium text-gray-900 dark:text-gray-100">{{ selectedMember.name }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ selectedMember.email }}</p>
          </div>
          <button
            v-if="allMembers.length > 1"
            type="button"
            class="text-primary-600 hover:text-primary-700 dark:text-primary-400 text-sm"
            @click="
              selectedMember = null;
              password = '';
              confirmPassword = '';
              formError = null;
            "
          >
            {{ t('action.change') }}
          </button>
        </div>

        <!-- Creating password for first time -->
        <div v-if="isCreatingPassword">
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.createPasswordPrompt') }}
          </p>
          <BaseInput
            v-model="password"
            :label="t('auth.createPassword')"
            type="password"
            :placeholder="t('auth.createPasswordPlaceholder')"
            required
          />
          <div class="mt-3">
            <BaseInput
              v-model="confirmPassword"
              :label="t('auth.confirmPassword')"
              type="password"
              :placeholder="t('auth.confirmPasswordPlaceholder')"
              required
            />
          </div>
        </div>

        <!-- Normal sign-in with existing password -->
        <div v-else>
          <BaseInput
            v-model="password"
            :label="t('auth.password')"
            type="password"
            :placeholder="t('auth.enterYourPassword')"
            required
          />
        </div>

        <BaseButton type="submit" class="mt-4 w-full" :disabled="authStore.isLoading">
          {{
            authStore.isLoading
              ? t('auth.signingIn')
              : isCreatingPassword
                ? t('auth.createAndSignIn')
                : t('auth.signIn')
          }}
        </BaseButton>
      </form>
    </div>
  </div>
</template>
