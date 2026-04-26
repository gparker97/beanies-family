<script setup lang="ts">
/* global FileSystemFileHandle */
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useFileDrop } from '@/composables/useFileDrop';
import { isTemporaryEmail } from '@/utils/email';
import { useJoinFlow, JOIN_ERRORS, type RecoveryAction } from '@/composables/useJoinFlow';
import { useSyncStore } from '@/stores/syncStore';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const syncStore = useSyncStore();
const flow = useJoinFlow();

type LoginView = 'create';

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
  navigate: [view: LoginView];
}>();

// ── View-local form state ────────────────────────────────────────────────────
const password = ref('');
const confirmPassword = ref('');
const decryptPassword = ref('');
const showDecryptModal = ref(false);
const isLoadingLocalFile = ref(false);
const localFormError = ref<string | null>(null);

// ── Derived from the composable ──────────────────────────────────────────────

/** True while the composable is doing background work the user should wait on. */
const isBusy = computed(() =>
  ['lookup', 'authenticating', 'loading', 'joining'].includes(flow.currentStep.value)
);

const busyLabel = computed(() => {
  if (flow.currentStep.value === 'lookup') return t('join.lookingUp');
  if (flow.currentStep.value === 'authenticating') return t('join.loadingFromCloud');
  if (flow.currentStep.value === 'loading') return t('join.loadingFromCloud');
  if (flow.currentStep.value === 'joining') return t('join.completing');
  return '';
});

/** Registry-driven view of the current error (or null). */
const currentErrorView = computed(() => {
  const err = flow.currentError.value;
  if (!err) return null;
  const meta = JOIN_ERRORS[err.code];
  let message = t(meta.messageKey);
  // Interpolate context (used by FILE_READ_FAILED, FILE_FAMILY_MISMATCH, etc.)
  if (err.context) {
    for (const [key, value] of Object.entries(err.context)) {
      message = message.replace(`{${key}}`, String(value ?? ''));
    }
  }
  return {
    code: err.code,
    severity: meta.severity,
    message,
    recoveries: meta.recoveries,
  };
});

const recoveryHandlers: Record<RecoveryAction, () => void | Promise<void>> = {
  retry: () => flow.handleRetry(),
  signInDifferentAccount: () => flow.handleSignInDifferent(),
  tryAnotherDevice: () => flow.handleTryAnotherDevice(),
  pickDifferentBean: () => {
    flow.clearError();
    // Navigation back to the member-pick step is handled by the composable
    // when the file is already loaded; otherwise this is a no-op (the
    // error registry only lists this recovery for codes that fire after
    // the member grid is reachable).
  },
  askForNewInvite: () => {
    // Dead-end recovery — the user must contact the inviter for a new
    // link. The button is rendered for visibility / messaging; clicking
    // is a no-op beyond clearing the error so the user can re-read it.
    flow.clearError();
  },
};

function getMemberRole(member: FamilyMember): string {
  if (member.ageGroup === 'child') return t('loginV6.littleBean');
  return t('loginV6.parentBean');
}

// ── Local-provider drop-zone (only relevant when provider !== 'google_drive') ─
//
// The composable owns the cloud flow; for `local` invites the user must
// drop or pick a `.beanpod` file from disk. We delegate to the existing
// syncStore methods (loadFromNewFile / loadFromDroppedFile) which handle
// V3 + V4 file shapes.

async function handleLoadLocalFile(): Promise<void> {
  localFormError.value = null;
  isLoadingLocalFile.value = true;
  try {
    const result = await syncStore.loadFromNewFile();
    handleLocalLoadResult(result);
  } catch {
    localFormError.value = syncStore.error || t('auth.fileLoadFailed');
  } finally {
    isLoadingLocalFile.value = false;
  }
}

async function handleDroppedFile(file: File, fileHandle?: FileSystemFileHandle): Promise<void> {
  localFormError.value = null;
  isLoadingLocalFile.value = true;
  try {
    const result = await syncStore.loadFromDroppedFile(file, fileHandle);
    handleLocalLoadResult(result);
  } catch {
    localFormError.value = syncStore.error || t('auth.fileLoadFailed');
  } finally {
    isLoadingLocalFile.value = false;
  }
}

function handleLocalLoadResult(result: { success: boolean; needsPassword?: boolean }): void {
  if (result.success) {
    // No invite token → ask the user for the file password.
    showDecryptModal.value = true;
    return;
  }
  if (result.needsPassword) {
    showDecryptModal.value = true;
    return;
  }
  if (syncStore.error) {
    localFormError.value = syncStore.error;
  } else {
    localFormError.value = t('auth.fileLoadFailed');
  }
}

const { isDragging, bindings: dropZoneBindings } = useFileDrop({
  accept: ['.beanpod', '.json'],
  multiple: false,
  onReject: () => {
    localFormError.value = t('auth.fileLoadFailed');
  },
  onDrop: async ([dropped]) => {
    if (!dropped) return;
    await handleDroppedFile(dropped.file, dropped.handle);
  },
});

// ── Decrypt modal ────────────────────────────────────────────────────────────

async function handleDecrypt(): Promise<void> {
  if (!decryptPassword.value) return;
  const ok = await flow.handleSubmitDecryptPassword(decryptPassword.value);
  if (ok) {
    showDecryptModal.value = false;
    decryptPassword.value = '';
  }
}

// ── Password creation (final join step) ──────────────────────────────────────

async function handleCreatePassword(): Promise<void> {
  if (!password.value || password.value.length < 8) return;
  if (password.value !== confirmPassword.value) return;
  const ok = await flow.handleSubmitPassword(password.value);
  if (ok) emit('signed-in', '/nook');
}

const passwordError = computed(() => {
  if (!password.value) return null;
  if (password.value.length < 8) return t('auth.passwordMinLength');
  if (password.value !== confirmPassword.value && confirmPassword.value)
    return t('auth.passwordsDoNotMatch');
  return null;
});

// ── Navigation ───────────────────────────────────────────────────────────────

function handleBack(): void {
  if (flow.currentStep.value === 'set-password') {
    flow.currentStep.value = 'pick-member';
    flow.selectedMember.value = null;
    password.value = '';
    confirmPassword.value = '';
    flow.clearError();
  } else if (flow.currentStep.value === 'pick-member') {
    flow.currentStep.value = 'awaiting-auth';
    flow.clearError();
  } else {
    emit('back');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

onMounted(() => {
  flow.init().catch((e) => {
    console.warn('[JoinPodView] flow.init crashed', e);
  });
});
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

    <!-- ============================================ -->
    <!-- ERROR BLOCK (rendered above any step content) -->
    <!-- ============================================ -->
    <div
      v-if="currentErrorView"
      class="mb-4 rounded-2xl p-4"
      :class="
        currentErrorView.severity === 'critical'
          ? 'bg-red-50 dark:bg-red-900/20'
          : 'bg-amber-50 dark:bg-amber-900/20'
      "
      role="alert"
    >
      <p
        class="mb-3 text-sm"
        :class="
          currentErrorView.severity === 'critical'
            ? 'text-red-800 dark:text-red-300'
            : 'text-amber-800 dark:text-amber-300'
        "
      >
        {{ currentErrorView.message }}
      </p>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          v-for="action in currentErrorView.recoveries"
          :key="action"
          size="sm"
          :variant="action === currentErrorView.recoveries[0] ? 'primary' : 'secondary'"
          @click="recoveryHandlers[action]()"
        >
          {{ t(`join.recovery.${action}`) }}
        </BaseButton>
      </div>
    </div>

    <!-- ============================================ -->
    <!-- STEP 1: Verify & Load                        -->
    <!-- ============================================ -->
    <template
      v-if="
        flow.currentStep.value === 'lookup' ||
        flow.currentStep.value === 'awaiting-auth' ||
        flow.currentStep.value === 'authenticating' ||
        flow.currentStep.value === 'loading'
      "
    >
      <!-- Header with beanie family image -->
      <div class="mb-6 text-center">
        <img
          src="/brand/beanies_family_icon_transparent_384x384.png"
          alt=""
          class="mx-auto mb-3 h-24 w-24"
        />
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.verifyTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.verifySubtitle') }}
        </p>
      </div>

      <!-- Busy spinner -->
      <div v-if="isBusy && !currentErrorView" class="py-12 text-center">
        <BeanieSpinner size="md" class="mx-auto mb-3" />
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ busyLabel }}</p>
      </div>

      <!-- Awaiting user gesture: show family-found card + Picker CTA / drop zone -->
      <template v-else-if="flow.currentStep.value === 'awaiting-auth'">
        <!-- Family found card -->
        <div
          v-if="flow.registryEntry.value?.familyName"
          class="mb-5 rounded-2xl bg-green-50 p-4 dark:bg-green-900/20"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-green-800/30"
            >
              <svg
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
            </div>
            <div>
              <p class="text-sm font-semibold text-green-800 dark:text-green-300">
                {{ t('join.familyFound') }}
              </p>
              <p class="font-outfit text-lg font-bold text-green-900 dark:text-green-200">
                {{ flow.registryEntry.value.familyName }}
              </p>
            </div>
          </div>
        </div>

        <!-- Google Drive Picker CTA — primary path for any drive-backed invite -->
        <template v-if="flow.targetProvider.value === 'google_drive'">
          <div class="space-y-3 text-center">
            <p class="text-sm text-slate-600 dark:text-slate-400">
              {{ t('join.pickerPrompt.description') }}
            </p>
            <BaseButton class="w-full" @click="flow.handleAuthTap">
              {{ t('join.pickerPrompt.button') }}
            </BaseButton>
          </div>
        </template>

        <!-- Local-provider drop zone -->
        <template v-else-if="flow.targetFamilyId.value">
          <div class="bg-secondary-500 rounded-2xl p-5 dark:bg-slate-700">
            <p class="mb-3 text-sm font-semibold text-white">{{ t('join.needsFile') }}</p>
            <p class="mb-4 text-sm text-white/70">{{ t('join.needsFileDesc') }}</p>
            <div v-if="flow.expectedFileName.value" class="mb-4 rounded-xl bg-white/10 px-3 py-2">
              <p class="text-xs text-white/50">{{ t('join.expectedFile') }}</p>
              <p class="font-mono text-sm font-medium text-white">
                {{ flow.expectedFileName.value }}
              </p>
            </div>
            <div
              v-if="localFormError"
              class="mb-4 rounded-lg bg-red-50/20 p-2 text-xs text-red-200"
            >
              {{ localFormError }}
            </div>
            <div
              role="button"
              tabindex="0"
              class="w-full cursor-pointer rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-all"
              :class="
                isDragging
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'hover:border-primary-500/50 border-white/20 hover:bg-white/5'
              "
              v-bind="dropZoneBindings"
              @click="handleLoadLocalFile"
              @keydown.enter="handleLoadLocalFile"
            >
              <div v-if="isLoadingLocalFile" class="py-2">
                <BeanieSpinner size="sm" class="mx-auto mb-2" />
                <p class="text-xs text-white/60">{{ t('auth.loadingFile') }}</p>
              </div>
              <template v-else>
                <svg
                  class="mx-auto mb-2 h-8 w-8 text-white/40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p class="text-sm font-medium text-white/80">{{ t('join.dropZoneText') }}</p>
                <p class="text-primary-500 mt-1 text-xs">{{ t('join.loadFileButton') }}</p>
              </template>
            </div>
          </div>
        </template>

        <!-- No URL params — instructions for getting a magic link -->
        <template v-else>
          <div class="bg-secondary-500 rounded-2xl p-5 dark:bg-slate-700">
            <p class="mb-3 text-sm font-semibold text-white">{{ t('join.howToJoinTitle') }}</p>
            <div class="space-y-2.5">
              <div
                v-for="step in [
                  { n: 1, label: t('join.howToJoinStep1') },
                  { n: 2, label: t('join.howToJoinStep2') },
                  { n: 3, label: t('join.howToJoinStep3') },
                ]"
                :key="step.n"
                class="flex items-start gap-3"
              >
                <div
                  class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
                >
                  {{ step.n }}
                </div>
                <p class="text-sm text-white/80">{{ step.label }}</p>
              </div>
            </div>
          </div>
          <div
            class="mt-4 flex items-start gap-3 rounded-2xl bg-gray-50 p-[14px_18px] dark:bg-slate-700/50"
          >
            <div
              class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#6EE7B7]/[0.12]"
            >
              <svg
                class="h-4 w-4 text-[#6EE7B7]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <p class="text-xs font-semibold opacity-50">{{ t('join.linkExpiryNote') }}</p>
          </div>
        </template>
      </template>

      <!-- Footer link (always visible at the bottom of step 1) -->
      <div class="mt-6 text-center">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('loginV6.wantYourOwn') }}</span>
        {{ ' ' }}
        <button
          type="button"
          class="text-primary-500 hover:text-terracotta-400 text-sm font-medium"
          @click="emit('navigate', 'create')"
        >
          {{ t('loginV6.createLink') }}
        </button>
      </div>
    </template>

    <!-- ============================================ -->
    <!-- STEP 2: Pick Your Bean                       -->
    <!-- ============================================ -->
    <template v-else-if="flow.currentStep.value === 'pick-member'">
      <div class="mb-6 text-center">
        <div
          v-if="flow.registryEntry.value?.familyName"
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
          {{ flow.registryEntry.value.familyName }}
        </div>
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.pickMemberTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.pickMemberSubtitle') }}
        </p>
      </div>

      <div
        v-if="flow.unclaimedMembers.value.length > 0"
        class="flex flex-wrap justify-center gap-6"
      >
        <button
          v-for="member in flow.unclaimedMembers.value"
          :key="member.id"
          class="group flex w-[88px] flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
          @click="flow.handleSelectMember(member)"
        >
          <div class="relative">
            <BeanieAvatar
              :variant="getMemberAvatarVariant(member)"
              :color="member.color"
              size="xl"
            />
            <div
              class="bg-primary-500 absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-slate-800"
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
            <p class="text-xs text-gray-400 opacity-60">{{ getMemberRole(member) }}</p>
          </div>
        </button>
      </div>
      <div v-else class="py-8 text-center">
        <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('join.noUnclaimedMembers') }}</p>
      </div>
    </template>

    <!-- ============================================ -->
    <!-- STEP 3: Create Password                      -->
    <!-- ============================================ -->
    <template
      v-else-if="flow.currentStep.value === 'set-password' || flow.currentStep.value === 'joining'"
    >
      <div class="mb-6 text-center">
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.setPasswordTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.setPasswordSubtitle') }}
        </p>
      </div>

      <form @submit.prevent="handleCreatePassword">
        <!-- Selected member card -->
        <div class="mb-4 flex items-center gap-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-700/50">
          <BeanieAvatar
            v-if="flow.selectedMember.value"
            :variant="getMemberAvatarVariant(flow.selectedMember.value)"
            :color="flow.selectedMember.value.color"
            size="lg"
          />
          <div class="flex-1">
            <p class="font-outfit font-semibold text-gray-900 dark:text-gray-100">
              {{ flow.selectedMember.value?.name }}
            </p>
            <p
              v-if="
                flow.selectedMember.value?.email &&
                !isTemporaryEmail(flow.selectedMember.value.email)
              "
              class="text-xs text-gray-500 dark:text-gray-400"
            >
              {{ flow.selectedMember.value.email }}
            </p>
          </div>
          <button
            v-if="flow.unclaimedMembers.value.length > 1"
            type="button"
            class="text-primary-500 hover:text-terracotta-400 text-sm font-medium"
            @click="handleBack"
          >
            {{ t('action.change') }}
          </button>
        </div>

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

        <p v-if="passwordError" class="mt-2 text-xs text-red-600 dark:text-red-400">
          {{ passwordError }}
        </p>

        <BaseButton
          type="submit"
          class="mt-4 w-full"
          :loading="flow.currentStep.value === 'joining'"
          :disabled="!!passwordError || !password || !confirmPassword"
        >
          {{
            flow.currentStep.value === 'joining' ? t('join.completing') : t('auth.createAndSignIn')
          }}
        </BaseButton>
      </form>
    </template>

    <!-- ============================================ -->
    <!-- Decrypt Modal (no invite token / local file) -->
    <!-- ============================================ -->
    <BaseModal :open="showDecryptModal" @close="showDecryptModal = false">
      <div class="text-center">
        <h3 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.unlockTitle') }}
        </h3>
        <p class="mt-1 text-xs opacity-40">{{ t('loginV6.unlockSubtitle') }}</p>
      </div>

      <form class="mt-6" @submit.prevent="handleDecrypt">
        <BaseInput
          v-model="decryptPassword"
          :label="t('password.password')"
          type="password"
          :placeholder="t('password.enterPasswordPlaceholder')"
          required
        />

        <BaseButton
          type="submit"
          class="from-primary-500 to-terracotta-400 mt-4 w-full bg-gradient-to-r"
        >
          {{ t('loginV6.unlockButton') }}
        </BaseButton>
      </form>
    </BaseModal>
  </div>
</template>
