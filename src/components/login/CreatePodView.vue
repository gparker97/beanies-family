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
const ownerRole = ref<'parent' | 'child'>('parent');
const password = ref('');
const confirmPassword = ref('');

// Step 2 state
const storageSaved = ref(false);
const isSavingStorage = ref(false);
const podPassword = ref('');
const confirmPodPassword = ref('');

// Step 3 state
const addedMembers = ref<FamilyMember[]>([]);
const newMemberName = ref('');
const newMemberRole = ref<'parent' | 'child'>('parent');

const totalSteps = 3;

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

async function handleStep2Next() {
  formError.value = null;

  // Validate pod password if provided
  if (podPassword.value) {
    if (podPassword.value.length < 8) {
      formError.value = t('auth.passwordMinLength');
      return;
    }
    if (podPassword.value !== confirmPodPassword.value) {
      formError.value = t('auth.passwordsDoNotMatch');
      return;
    }

    // Enable encryption with the pod password
    if (syncStore.isConfigured) {
      await syncStore.enableEncryption(podPassword.value);
    }
  }

  currentStep.value = 3;
  formError.value = null;
}

function handleStep2Skip() {
  currentStep.value = 3;
  formError.value = null;
}

async function handleAddMember() {
  formError.value = null;

  if (!newMemberName.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  const memberInput = {
    name: newMemberName.value,
    email: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@setup.local`,
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
    newMemberRole.value = 'parent';
  } else {
    formError.value = t('loginV6.addMemberFailed');
  }
}

async function handleRemoveMember(memberId: string) {
  await familyStore.deleteMember(memberId);
  addedMembers.value = addedMembers.value.filter((m) => m.id !== memberId);
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
      <p class="font-outfit text-[0.85rem] font-bold text-[#2C3E50] dark:text-gray-200">
        {{ t('app.name') }}
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
          class="text-[0.52rem] font-semibold"
          :class="step === currentStep ? 'text-[#F15D22]' : 'opacity-25'"
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
        🌱 {{ t('loginV6.growPodTitle') }}
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
                class="font-outfit mb-1 block text-[0.6rem] font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
              >
                {{ t('form.type') }}
              </label>
              <select
                v-model="ownerRole"
                class="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[#F15D22] focus:ring-1 focus:ring-[#F15D22] focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
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
        class="rounded-[18px] border-2 border-[#F15D22]/15 bg-[#F15D22]/[0.02] p-4 dark:border-[#F15D22]/10 dark:bg-[#F15D22]/[0.03]"
      >
        <div
          class="font-outfit mb-1.5 text-[0.6rem] font-bold tracking-[0.1em] text-[#F15D22] uppercase"
        >
          {{ t('loginV6.storageSectionLabel') }}
        </div>
        <p class="mb-3 text-[0.7rem] leading-relaxed text-[#2C3E50] opacity-40 dark:text-gray-300">
          {{ t('loginV6.storageDescription') }}
        </p>

        <!-- Storage options row -->
        <div class="flex gap-2">
          <!-- Google Drive (coming soon) -->
          <div
            class="flex flex-1 cursor-not-allowed flex-col items-center rounded-[14px] border-2 border-transparent bg-[#AED6F1]/15 px-2.5 py-3.5 opacity-50 dark:bg-slate-700/40"
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
              class="font-outfit text-center text-[0.68rem] font-semibold whitespace-nowrap text-gray-600 dark:text-gray-400"
              >Google Drive</span
            >
            <span
              class="mt-1 rounded-full bg-[#F15D22]/10 px-2 py-0.5 text-center text-[0.5rem] font-bold whitespace-nowrap text-[#F15D22]"
              >{{ t('loginV6.cloudComingSoon') }}</span
            >
          </div>

          <!-- Dropbox (coming soon) -->
          <div
            class="flex flex-1 cursor-not-allowed flex-col items-center rounded-[14px] border-2 border-transparent bg-[#AED6F1]/15 px-2.5 py-3.5 opacity-50 dark:bg-slate-700/40"
          >
            <svg
              class="mb-1.5 h-6 w-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              style="opacity: 0.5"
            >
              <path
                d="M12 2L6 6.5l6 4.5-6 4.5L12 20l6-4.5-6-4.5 6-4.5L12 2zm0 13l-4-3 4-3 4 3-4 3z"
              />
            </svg>
            <span
              class="font-outfit text-center text-[0.68rem] font-semibold whitespace-nowrap text-gray-600 dark:text-gray-400"
              >Dropbox</span
            >
            <span
              class="mt-1 rounded-full bg-[#F15D22]/10 px-2 py-0.5 text-center text-[0.5rem] font-bold whitespace-nowrap text-[#F15D22]"
              >{{ t('loginV6.cloudComingSoon') }}</span
            >
          </div>

          <!-- iCloud (coming soon) -->
          <div
            class="flex flex-1 cursor-not-allowed flex-col items-center rounded-[14px] border-2 border-transparent bg-[#AED6F1]/15 px-2.5 py-3.5 opacity-50 dark:bg-slate-700/40"
          >
            <svg
              class="mb-1.5 h-6 w-6"
              viewBox="0 0 24 24"
              fill="currentColor"
              style="opacity: 0.5"
            >
              <path
                d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"
              />
            </svg>
            <span
              class="font-outfit text-center text-[0.68rem] font-semibold whitespace-nowrap text-gray-600 dark:text-gray-400"
              >iCloud</span
            >
            <span
              class="mt-1 rounded-full bg-[#F15D22]/10 px-2 py-0.5 text-center text-[0.5rem] font-bold whitespace-nowrap text-[#F15D22]"
              >{{ t('loginV6.cloudComingSoon') }}</span
            >
          </div>

          <!-- Local file (functional) -->
          <button
            class="flex flex-1 flex-col items-center rounded-[14px] border-2 px-2.5 py-3.5 transition-all"
            :class="
              storageSaved
                ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                : 'border-[#F15D22] bg-[#F15D22]/[0.08] hover:bg-[#F15D22]/15 dark:bg-[#F15D22]/10'
            "
            :disabled="isSavingStorage"
            @click="handleChooseLocalStorage"
          >
            <svg
              v-if="storageSaved"
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
              class="mb-1.5 h-6 w-6 opacity-40"
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
              class="font-outfit text-[0.68rem] font-semibold"
              :class="
                storageSaved
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-900 dark:text-gray-100'
              "
              >Local</span
            >
          </button>
        </div>
      </div>

      <!-- Pod file encryption password (below storage box) -->
      <div class="mt-5 space-y-3">
        <div>
          <BaseInput
            v-model="podPassword"
            :label="t('loginV6.encryptionPasswordLabel')"
            type="password"
            :placeholder="t('auth.passwordPlaceholder')"
          />
          <p class="mt-1 text-xs text-gray-400">
            {{ t('loginV6.passwordHint') }}
          </p>
        </div>
        <BaseInput
          v-if="podPassword"
          v-model="confirmPodPassword"
          :label="t('loginV6.confirmPodPassword')"
          type="password"
          :placeholder="t('auth.confirmPasswordPlaceholder')"
        />
        <p v-if="!podPassword" class="text-[0.68rem] text-gray-400 opacity-60">
          {{ t('loginV6.podPasswordOptional') }}
        </p>
      </div>

      <BaseButton class="mt-6 w-full" @click="handleStep2Next">
        {{ t('loginV6.createNext') }}
      </BaseButton>
      <button
        v-if="!storageSaved && !podPassword"
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

      <!-- Add member form -->
      <div class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-600">
        <BaseInput
          v-model="newMemberName"
          :label="'👤 ' + t('form.name')"
          :placeholder="t('family.enterName')"
        />
        <!-- Role toggle -->
        <div class="flex items-center gap-3">
          <span
            class="font-outfit text-[0.6rem] font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
            >{{ t('form.type') }}</span
          >
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
              🫘 {{ t('loginV6.parentBean') }}
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
              🌱 {{ t('loginV6.littleBean') }}
            </button>
          </div>
        </div>

        <BaseButton
          class="w-full"
          variant="secondary"
          :disabled="!newMemberName"
          @click="handleAddMember"
        >
          🫘 {{ t('loginV6.addMember') }}
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
