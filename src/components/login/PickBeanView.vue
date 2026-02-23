<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
}>();

defineProps<{
  fileUnencrypted?: boolean;
}>();

const password = ref('');
const confirmPassword = ref('');
const selectedMember = ref<FamilyMember | null>(null);
const formError = ref<string | null>(null);

const allMembers = computed(() => familyStore.members);
const podName = computed(() => familyContextStore.activeFamilyName);

const isCreatingPassword = computed(
  () => selectedMember.value && !selectedMember.value.passwordHash
);

function selectMember(member: FamilyMember) {
  selectedMember.value = member;
  password.value = '';
  confirmPassword.value = '';
  formError.value = null;
}

function clearSelection() {
  selectedMember.value = null;
  password.value = '';
  confirmPassword.value = '';
  formError.value = null;
}

function getMemberRole(member: FamilyMember): string {
  if (member.ageGroup === 'child') {
    return t('loginV6.littleBean');
  }
  return t('loginV6.parentBean');
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
      syncStore.setupAutoSync();
      await syncStore.syncNow(true);
      emit('signed-in', '/dashboard');
    } else {
      formError.value = result.error ?? t('auth.signInFailed');
    }
    return;
  }

  // Normal sign-in with existing password
  const result = await authStore.signIn(selectedMember.value.id, password.value);
  if (result.success) {
    emit('signed-in', '/dashboard');
  } else {
    formError.value = result.error ?? t('auth.signInFailed');
  }
}
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="selectedMember ? clearSelection() : $emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header -->
    <div class="mb-6 text-center">
      <!-- Pod name chip -->
      <div
        v-if="podName"
        class="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-slate-700 dark:text-gray-400"
      >
        <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
        {{ podName }}
      </div>

      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.pickBeanTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.pickBeanSubtitle') }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Unencrypted file warning -->
    <div
      v-if="fileUnencrypted"
      class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div class="flex items-start gap-2">
        <img
          src="/brand/beanies_open_eyes_transparent_512x512.png"
          alt=""
          class="mt-0.5 h-4 w-4 flex-shrink-0"
        />
        <p class="text-sm text-amber-800 dark:text-amber-200">
          {{ t('auth.fileNotEncryptedWarning') }}
        </p>
      </div>
    </div>

    <!-- No members -->
    <div v-if="allMembers.length === 0" class="py-4 text-center">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.noMembersWithPassword') }}
      </p>
    </div>

    <!-- Avatar grid (shown when no member selected) -->
    <div v-else-if="!selectedMember" class="flex flex-wrap justify-center gap-6">
      <button
        v-for="member in allMembers"
        :key="member.id"
        class="group flex w-[88px] flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
        @click="selectMember(member)"
      >
        <div class="relative">
          <BeanieAvatar :variant="getMemberAvatarVariant(member)" :color="member.color" size="xl" />
          <!-- Status indicator -->
          <div
            v-if="member.passwordHash"
            class="absolute right-0 bottom-0 h-4 w-4 rounded-full border-2 border-white bg-green-400 dark:border-slate-800"
          ></div>
          <div
            v-else
            class="absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#F15D22] text-xs font-bold text-white dark:border-slate-800"
          >
            +
          </div>
        </div>
        <div class="text-center">
          <p
            class="font-outfit max-w-[88px] truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {{ member.name }}
          </p>
          <p class="text-xs text-gray-400 opacity-60">
            {{ getMemberRole(member) }}
          </p>
        </div>
      </button>
    </div>

    <!-- Info bubble (shown when no member selected and members exist) -->
    <div
      v-if="allMembers.length > 0 && !selectedMember"
      class="mt-6 flex items-start gap-3 rounded-2xl bg-gray-50 p-[14px_18px] dark:bg-slate-700/50"
    >
      <div
        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#6EE7B7]/[0.12]"
      >
        <svg class="h-4 w-4 text-[#6EE7B7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <p class="text-[0.7rem] font-semibold opacity-50">
        {{ t('loginV6.pickBeanInfoText') }}
      </p>
    </div>

    <!-- Password form (shown when member selected) -->
    <form v-if="selectedMember" @submit.prevent="handleSignIn">
      <!-- Selected member card -->
      <div class="mb-4 flex items-center gap-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-700/50">
        <BeanieAvatar
          :variant="getMemberAvatarVariant(selectedMember)"
          :color="selectedMember.color"
          size="lg"
        />
        <div class="flex-1">
          <p class="font-outfit font-semibold text-gray-900 dark:text-gray-100">
            {{ selectedMember.name }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ selectedMember.email }}</p>
        </div>
        <button
          v-if="allMembers.length > 1"
          type="button"
          class="text-sm font-medium text-[#F15D22] hover:text-[#E67E22]"
          @click="clearSelection"
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

      <!-- Normal sign-in -->
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
              : `${t('loginV6.signInAs')} ${selectedMember.name}`
        }}
      </BaseButton>
    </form>

    <!-- Switch family button -->
    <button
      type="button"
      class="mt-6 w-full rounded-2xl border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-gray-400 dark:hover:bg-slate-700"
      @click="$emit('back')"
    >
      {{ t('loginV6.switchFamily') }}
    </button>
  </div>
</template>
