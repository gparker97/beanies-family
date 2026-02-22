<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSyncStore } from '@/stores/syncStore';
import type { FamilyMember, Gender, AgeGroup } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
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
const password = ref('');
const confirmPassword = ref('');

// Step 2 state
const storageSaved = ref(false);
const isSavingStorage = ref(false);

// Step 3 state
const addedMembers = ref<FamilyMember[]>([]);
const newMemberName = ref('');
const newMemberEmail = ref('');
const newMemberRole = ref<'parent' | 'child'>('parent');

const totalSteps = 3;

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
    currentStep.value = 2;
    formError.value = null;
  } else {
    formError.value = result.error ?? t('auth.signUpFailed');
  }
}

async function handleChooseLocalStorage() {
  isSavingStorage.value = true;
  formError.value = null;

  try {
    const success = await syncStore.configureSyncFile();
    if (success) {
      storageSaved.value = true;
    } else {
      formError.value = t('setup.fileCreateFailed');
    }
  } catch {
    formError.value = t('setup.fileCreateFailed');
  } finally {
    isSavingStorage.value = false;
  }
}

function handleStep2Next() {
  currentStep.value = 3;
  formError.value = null;
}

function handleStep2Skip() {
  currentStep.value = 3;
  formError.value = null;
}

async function handleAddMember() {
  formError.value = null;

  if (!newMemberName.value || !newMemberEmail.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  const memberInput = {
    name: newMemberName.value,
    email: newMemberEmail.value,
    gender: 'other' as Gender,
    ageGroup: (newMemberRole.value === 'child' ? 'child' : 'adult') as AgeGroup,
    role: 'member' as const,
    color: getNextColor(),
    requiresPassword: false,
  };

  const member = await familyStore.createMember(memberInput);
  if (member) {
    addedMembers.value.push(member);
    newMemberName.value = '';
    newMemberEmail.value = '';
    newMemberRole.value = 'parent';
  }
}

const memberColors = ['#ef4444', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

function getNextColor(): string {
  const usedCount = addedMembers.value.length;
  return memberColors[usedCount % memberColors.length] ?? '#3b82f6';
}

async function handleFinish() {
  // Save to file if configured
  if (syncStore.isConfigured) {
    syncStore.setupAutoSync();
    await syncStore.syncNow(true);
  }
  emit('signed-in', '/dashboard');
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
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
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

    <!-- Step indicator -->
    <div class="mb-6 flex items-center justify-center gap-2">
      <div v-for="step in totalSteps" :key="step" class="flex items-center gap-2">
        <div
          class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors"
          :class="
            step === currentStep
              ? 'bg-[#F15D22] text-white'
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
          class="h-px w-8 transition-colors"
          :class="
            step < currentStep ? 'bg-green-300 dark:bg-green-600' : 'bg-gray-200 dark:bg-slate-600'
          "
        ></div>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Step 1: Name & Password -->
    <div v-if="currentStep === 1">
      <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.createTitle') }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.createSubtitle') }}
      </p>

      <form @submit.prevent="handleStep1Next">
        <div class="space-y-4">
          <BaseInput
            v-model="familyName"
            :label="t('auth.familyName')"
            :placeholder="t('auth.familyNamePlaceholder')"
            required
          />
          <BaseInput
            v-model="name"
            :label="t('setup.yourName')"
            :placeholder="t('auth.yourNamePlaceholder')"
            required
          />
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
              :label="t('auth.password')"
              type="password"
              :placeholder="t('auth.passwordPlaceholder')"
              required
            />
            <p class="mt-1 text-xs text-gray-400">
              {{ t('loginV6.passwordHint') }}
            </p>
          </div>
          <BaseInput
            v-model="confirmPassword"
            :label="t('auth.confirmPassword')"
            type="password"
            :placeholder="t('auth.confirmPasswordPlaceholder')"
            required
          />
        </div>

        <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
          {{ authStore.isLoading ? t('auth.creatingAccount') : t('loginV6.createNext') }}
        </BaseButton>
      </form>
    </div>

    <!-- Step 2: Choose Storage -->
    <div v-else-if="currentStep === 2">
      <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.storageTitle') }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.loadPodSubtitle') }}
      </p>

      <div class="space-y-3">
        <!-- Local file (functional) -->
        <button
          class="w-full rounded-2xl border-2 p-4 text-left transition-all"
          :class="
            storageSaved
              ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
              : 'border-[#F15D22] bg-[#FEF0E8] hover:shadow-md dark:border-[#F15D22]/50 dark:bg-[#F15D22]/10'
          "
          :disabled="isSavingStorage"
          @click="handleChooseLocalStorage"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl"
              :class="storageSaved ? 'bg-green-100 dark:bg-green-900/30' : 'bg-[#F15D22]/10'"
            >
              <svg
                v-if="storageSaved"
                class="h-5 w-5 text-green-600 dark:text-green-400"
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
                class="h-5 w-5 text-[#F15D22]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('loginV6.storageLocal') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('loginV6.storageLocalDesc') }}
              </p>
            </div>
          </div>
        </button>

        <!-- Google Drive (coming soon) -->
        <div
          class="flex w-full cursor-not-allowed items-center gap-3 rounded-2xl border border-gray-200 p-4 opacity-50 dark:border-slate-600"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-700"
          >
            <svg class="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
              />
            </svg>
          </div>
          <div class="flex-1">
            <p class="font-medium text-gray-500">Google Drive</p>
          </div>
          <span
            class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-400 dark:bg-slate-700"
          >
            {{ t('loginV6.cloudComingSoon') }}
          </span>
        </div>

        <!-- Dropbox (coming soon) -->
        <div
          class="flex w-full cursor-not-allowed items-center gap-3 rounded-2xl border border-gray-200 p-4 opacity-50 dark:border-slate-600"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-700"
          >
            <svg class="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2L6 6.5l6 4.5-6 4.5L12 20l6-4.5-6-4.5 6-4.5L12 2zm0 13l-4-3 4-3 4 3-4 3z"
              />
            </svg>
          </div>
          <div class="flex-1">
            <p class="font-medium text-gray-500">Dropbox</p>
          </div>
          <span
            class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-400 dark:bg-slate-700"
          >
            {{ t('loginV6.cloudComingSoon') }}
          </span>
        </div>
      </div>

      <div class="mt-6 flex gap-3">
        <BaseButton class="flex-1" @click="handleStep2Next">
          {{ t('loginV6.createNext') }}
        </BaseButton>
      </div>
      <button
        v-if="!storageSaved"
        type="button"
        class="mt-2 w-full text-center text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        @click="handleStep2Skip"
      >
        {{ t('loginV6.skip') }}
      </button>
    </div>

    <!-- Step 3: Add Family Members -->
    <div v-else-if="currentStep === 3">
      <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.addBeansTitle') }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.addBeansSubtitle') }}
      </p>

      <!-- Added members list -->
      <div v-if="addedMembers.length > 0" class="mb-4 space-y-2">
        <div
          v-for="member in addedMembers"
          :key="member.id"
          class="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50"
        >
          <BeanieAvatar :variant="getMemberAvatarVariant(member)" :color="member.color" size="sm" />
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ member.name }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ member.email }}</p>
          </div>
          <span class="text-xs text-gray-400">
            {{ member.ageGroup === 'child' ? t('loginV6.littleBean') : t('loginV6.parentBean') }}
          </span>
        </div>
      </div>

      <!-- Add member form -->
      <div class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-600">
        <BaseInput
          v-model="newMemberName"
          :label="t('form.name')"
          :placeholder="t('family.enterName')"
        />
        <BaseInput
          v-model="newMemberEmail"
          :label="t('form.email')"
          type="email"
          :placeholder="t('family.enterEmail')"
        />
        <!-- Role toggle -->
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('form.type') }}:</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-1 text-sm transition-colors"
              :class="
                newMemberRole === 'parent'
                  ? 'bg-[#2C3E50] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
              "
              @click="newMemberRole = 'parent'"
            >
              {{ t('loginV6.parentBean') }}
            </button>
            <button
              type="button"
              class="rounded-full px-3 py-1 text-sm transition-colors"
              :class="
                newMemberRole === 'child'
                  ? 'bg-[#2C3E50] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
              "
              @click="newMemberRole = 'child'"
            >
              {{ t('loginV6.littleBean') }}
            </button>
          </div>
        </div>

        <BaseButton
          class="w-full"
          variant="secondary"
          :disabled="!newMemberName || !newMemberEmail"
          @click="handleAddMember"
        >
          {{ t('loginV6.addMember') }}
        </BaseButton>
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
        class="text-sm font-medium text-[#F15D22] hover:text-[#E67E22]"
        @click="emit('navigate', 'load-pod')"
      >
        {{ t('loginV6.loadItLink') }}
      </button>
    </div>
  </div>
</template>
