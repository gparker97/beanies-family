<script setup lang="ts">
/* global FileSystemFileHandle, FileSystemHandle */
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { isTemporaryEmail } from '@/utils/email';
import { lookupFamily, isRegistryConfigured } from '@/services/registry/registryService';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import type { FamilyMember, RegistryEntry } from '@/types/models';

const { t } = useTranslation();
const route = useRoute();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();

const SESSION_PASSWORD_KEY = 'beanies-file-password';

type LoginView = 'create';
type JoinStep = 'verify' | 'pick-member' | 'set-password';

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
  navigate: [view: LoginView];
}>();

// --- Wizard state ---
const currentStep = ref<JoinStep>('verify');

// Step 1: Verify & Load
const targetFamilyId = ref('');
const targetProvider = ref('local');
const targetFileRef = ref('');
const registryEntry = ref<RegistryEntry | null>(null);
const isLookingUp = ref(false);
const lookupDone = ref(false);
const manualCode = ref('');
const formError = ref<string | null>(null);

// File loading (inline within verify step)
const fileLoaded = ref(false);
const needsManualFileLoad = ref(false);
const isLoadingFile = ref(false);
const showDecryptModal = ref(false);
const decryptPassword = ref('');
const isDragging = ref(false);
let dragCounter = 0;

// Step 2: Pick member
const selectedMember = ref<FamilyMember | null>(null);

// Step 3: Set password
const password = ref('');
const confirmPassword = ref('');
const isJoining = ref(false);

// --- Computed ---
const expectedFileName = computed(() => {
  if (registryEntry.value?.displayPath) return registryEntry.value.displayPath;
  if (targetFileRef.value) {
    try {
      return atob(targetFileRef.value);
    } catch {
      return null;
    }
  }
  return null;
});

const unclaimedMembers = computed(() => familyStore.members.filter((m) => m.requiresPassword));

function getMemberRole(member: FamilyMember): string {
  if (member.ageGroup === 'child') return t('loginV6.littleBean');
  return t('loginV6.parentBean');
}

// --- Step 1: Verify & Load ---
onMounted(async () => {
  // Parse query params
  const fam = (route.query.fam as string) || (route.query.code as string) || '';
  const p = (route.query.p as string) || 'local';
  const fileRef = (route.query.ref as string) || '';

  if (fam) {
    targetFamilyId.value = fam;
    targetProvider.value = p;
    targetFileRef.value = fileRef;
    await performLookup(fam);
  }
});

async function performLookup(familyId: string) {
  isLookingUp.value = true;
  formError.value = null;
  lookupDone.value = false;

  try {
    if (!isRegistryConfigured()) {
      // Registry not configured — skip lookup, go straight to file load
      registryEntry.value = null;
      lookupDone.value = true;
      needsManualFileLoad.value = true;
      return;
    }

    const entry = await lookupFamily(familyId);
    registryEntry.value = entry;
    lookupDone.value = true;

    if (entry) {
      // Family found — attempt to load file based on provider
      targetFamilyId.value = familyId;
      targetProvider.value = entry.provider || 'local';
      await attemptFileLoad();
    }
    // If entry is null but registry IS configured, it's genuinely not found — UI shows warning
  } catch {
    // Network error — treat like unavailable, allow file load
    lookupDone.value = true;
    needsManualFileLoad.value = true;
  } finally {
    isLookingUp.value = false;
  }
}

function parseMagicLink(input: string): { fam: string; p?: string; ref?: string } | null {
  try {
    const url = new URL(input);
    const fam = url.searchParams.get('fam') || url.searchParams.get('code');
    if (fam)
      return {
        fam,
        p: url.searchParams.get('p') || undefined,
        ref: url.searchParams.get('ref') || undefined,
      };
  } catch {
    // Not a URL — return null
  }
  return null;
}

async function handleManualCodeSubmit() {
  formError.value = null;
  const raw = manualCode.value.trim();
  if (!raw) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  // Check if the input is a magic link URL
  const parsed = parseMagicLink(raw);
  if (parsed) {
    targetFamilyId.value = parsed.fam;
    targetProvider.value = parsed.p || 'local';
    targetFileRef.value = parsed.ref || '';
  } else {
    targetFamilyId.value = raw;
  }

  await performLookup(targetFamilyId.value);
}

async function attemptFileLoad() {
  // For local provider, we can't load the file automatically
  if (targetProvider.value === 'local') {
    needsManualFileLoad.value = true;
    return;
  }

  // Future: cloud providers would fetch the file directly here
  // For now, fall back to manual file load
  needsManualFileLoad.value = true;
}

// --- File picker / drop zone ---
async function handleLoadFile() {
  formError.value = null;

  try {
    const result = await syncStore.loadFromNewFile();
    if (result.success) {
      await onFileLoaded();
    } else if (result.needsPassword) {
      showDecryptModal.value = true;
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = syncStore.error || t('auth.fileLoadFailed');
  }
}

function handleDragEnter(e: DragEvent) {
  e.preventDefault();
  dragCounter++;
  isDragging.value = true;
}

function handleDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragging.value = false;
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
}

async function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragCounter = 0;
  isDragging.value = false;
  formError.value = null;

  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return;

  const item = items[0];
  if (!item || item.kind !== 'file') return;

  const file = item.getAsFile();
  if (!file) return;

  let fileHandle: FileSystemFileHandle | undefined;
  if ('getAsFileSystemHandle' in item) {
    try {
      const handle = await (
        item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }
      ).getAsFileSystemHandle();
      if (handle?.kind === 'file') {
        fileHandle = handle as FileSystemFileHandle;
      }
    } catch {
      // Fall back to File-only path
    }
  }

  if (!file.name.endsWith('.beanpod') && !file.name.endsWith('.json')) {
    formError.value = t('auth.fileLoadFailed');
    return;
  }

  isLoadingFile.value = true;
  try {
    const result = await syncStore.loadFromDroppedFile(file, fileHandle);
    if (result.success) {
      await onFileLoaded();
    } else if (result.needsPassword) {
      showDecryptModal.value = true;
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = syncStore.error || t('auth.fileLoadFailed');
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
      sessionStorage.setItem(SESSION_PASSWORD_KEY, decryptPassword.value);
      showDecryptModal.value = false;
      decryptPassword.value = '';
      await onFileLoaded();
    } else {
      formError.value = result.error ?? t('password.decryptionError');
    }
  } catch {
    formError.value = t('password.decryptionError');
  } finally {
    isLoadingFile.value = false;
  }
}

async function onFileLoaded() {
  // Validate familyId matches if we have a target
  if (targetFamilyId.value && familyContextStore.activeFamilyId !== targetFamilyId.value) {
    formError.value = t('join.fileMismatch');
    fileLoaded.value = false;
    return;
  }

  fileLoaded.value = true;
  needsManualFileLoad.value = false;

  // Check for unclaimed members
  if (unclaimedMembers.value.length === 0) {
    formError.value = t('join.noUnclaimedMembers');
    return;
  }

  // Advance to pick-member step
  formError.value = null;
  currentStep.value = 'pick-member';
}

// --- Step 2: Pick member ---
function selectMember(member: FamilyMember) {
  selectedMember.value = member;
  formError.value = null;
  password.value = '';
  confirmPassword.value = '';
  currentStep.value = 'set-password';
}

// --- Step 3: Set password ---
async function handleCreatePassword() {
  formError.value = null;

  if (!password.value) {
    formError.value = t('auth.enterPassword');
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

  if (!selectedMember.value) return;

  isJoining.value = true;

  try {
    const result = await authStore.joinFamily({
      memberId: selectedMember.value.id,
      password: password.value,
      familyId: familyContextStore.activeFamilyId ?? targetFamilyId.value,
    });

    if (result.success) {
      // Persist password hash to file before handing off to LoginPage
      await syncStore.syncNow(true);
      emit('signed-in', '/dashboard');
    } else {
      formError.value = result.error ?? t('auth.signInFailed');
    }
  } catch {
    formError.value = t('auth.signInFailed');
  } finally {
    isJoining.value = false;
  }
}

// --- Navigation ---
function handleBack() {
  if (currentStep.value === 'set-password') {
    currentStep.value = 'pick-member';
    selectedMember.value = null;
    password.value = '';
    confirmPassword.value = '';
    formError.value = null;
  } else if (currentStep.value === 'pick-member') {
    currentStep.value = 'verify';
    formError.value = null;
  } else {
    emit('back');
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

    <!-- ============================================ -->
    <!-- STEP 1: Verify & Load                        -->
    <!-- ============================================ -->
    <template v-if="currentStep === 'verify'">
      <!-- Header -->
      <div class="mb-6 text-center">
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.verifyTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.verifySubtitle') }}
        </p>
      </div>

      <!-- Error -->
      <div
        v-if="formError"
        class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ formError }}
      </div>

      <!-- Looking up spinner -->
      <div v-if="isLookingUp" class="py-12 text-center">
        <div
          class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#F15D22]"
        ></div>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('join.lookingUp') }}</p>
      </div>

      <!-- Family found + needs manual file load -->
      <template v-else-if="lookupDone && needsManualFileLoad">
        <!-- Family info card -->
        <div v-if="registryEntry" class="mb-5 rounded-2xl bg-green-50 p-4 dark:bg-green-900/20">
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
              <p
                v-if="registryEntry.familyName"
                class="font-outfit text-lg font-bold text-green-900 dark:text-green-200"
              >
                {{ registryEntry.familyName }}
              </p>
            </div>
          </div>
        </div>

        <!-- File guidance card -->
        <div class="rounded-2xl bg-[#2C3E50] p-5 dark:bg-slate-700">
          <p class="mb-3 text-sm font-semibold text-white">
            {{ t('join.needsFile') }}
          </p>
          <p class="mb-4 text-sm text-white/70">
            {{ t('join.needsFileDesc') }}
          </p>

          <!-- Expected file name -->
          <div v-if="expectedFileName" class="mb-4 rounded-xl bg-white/10 px-3 py-2">
            <p class="text-xs text-white/50">{{ t('join.expectedFile') }}</p>
            <p class="font-mono text-sm font-medium text-white">{{ expectedFileName }}</p>
          </div>

          <!-- File picker drop zone -->
          <div
            role="button"
            tabindex="0"
            class="w-full cursor-pointer rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-all"
            :class="
              isDragging
                ? 'border-[#F15D22] bg-[#F15D22]/10'
                : 'border-white/20 hover:border-[#F15D22]/50 hover:bg-white/5'
            "
            @click="handleLoadFile"
            @keydown.enter="handleLoadFile"
            @dragenter="handleDragEnter"
            @dragleave="handleDragLeave"
            @dragover="handleDragOver"
            @drop="handleDrop"
          >
            <div v-if="isLoadingFile" class="py-2">
              <div
                class="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-[#F15D22]"
              ></div>
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
              <p class="text-sm font-medium text-white/80">
                {{ t('join.dropZoneText') }}
              </p>
              <p class="mt-1 text-xs text-[#F15D22]">
                {{ t('join.loadFileButton') }}
              </p>
            </template>
          </div>
        </div>
      </template>

      <!-- Family not found (registry returned null but was reachable) -->
      <template v-else-if="lookupDone && !registryEntry && targetFamilyId">
        <div class="mb-5 rounded-2xl bg-amber-50 p-4 dark:bg-amber-900/20">
          <div class="flex items-start gap-3">
            <svg
              class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.27 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div>
              <p class="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {{ t('join.familyNotFound') }}
              </p>
              <p class="mt-1 text-xs text-amber-700/70 dark:text-amber-400/70">
                {{ t('join.registryOffline') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Still allow manual file load as fallback -->
        <div class="space-y-3">
          <BaseButton class="w-full" @click="needsManualFileLoad = true">
            {{ t('join.loadFileButton') }}
          </BaseButton>
        </div>
      </template>

      <!-- No link params — manual code entry -->
      <template v-else-if="!isLookingUp && !lookupDone">
        <form @submit.prevent="handleManualCodeSubmit">
          <BaseInput
            v-model="manualCode"
            :label="t('join.codeInputLabel')"
            :placeholder="t('login.familyCodePlaceholder')"
            required
          />
          <p class="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {{ t('join.codeInputHint') }}
          </p>

          <!-- What happens next card -->
          <div class="mt-6 rounded-2xl bg-[#2C3E50] p-5 dark:bg-slate-700">
            <p class="mb-3 text-sm font-semibold text-white">
              {{ t('loginV6.whatsNext') }}
            </p>
            <div class="space-y-2.5">
              <div class="flex items-start gap-3">
                <div
                  class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
                >
                  1
                </div>
                <p class="text-sm text-white/80">{{ t('loginV6.joinStep1') }}</p>
              </div>
              <div class="flex items-start gap-3">
                <div
                  class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
                >
                  2
                </div>
                <p class="text-sm text-white/80">{{ t('loginV6.joinStep2') }}</p>
              </div>
              <div class="flex items-start gap-3">
                <div
                  class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
                >
                  3
                </div>
                <p class="text-sm text-white/80">{{ t('loginV6.joinStep3') }}</p>
              </div>
            </div>
          </div>

          <BaseButton type="submit" class="mt-6 w-full" :disabled="isLookingUp">
            {{ t('join.next') }}
          </BaseButton>
        </form>
      </template>

      <!-- Footer link -->
      <div class="mt-6 text-center">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('loginV6.wantYourOwn') }}
        </span>
        {{ ' ' }}
        <button
          type="button"
          class="text-sm font-medium text-[#F15D22] hover:text-[#E67E22]"
          @click="emit('navigate', 'create')"
        >
          {{ t('loginV6.createLink') }}
        </button>
      </div>
    </template>

    <!-- ============================================ -->
    <!-- STEP 2: Pick Your Bean                       -->
    <!-- ============================================ -->
    <template v-else-if="currentStep === 'pick-member'">
      <!-- Header -->
      <div class="mb-6 text-center">
        <!-- Pod name chip -->
        <div
          v-if="registryEntry?.familyName || familyContextStore.activeFamilyName"
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
          {{ registryEntry?.familyName || familyContextStore.activeFamilyName }}
        </div>

        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.pickMemberTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.pickMemberSubtitle') }}
        </p>
      </div>

      <!-- Error -->
      <div
        v-if="formError"
        class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ formError }}
      </div>

      <!-- Avatar grid -->
      <div v-if="unclaimedMembers.length > 0" class="flex flex-wrap justify-center gap-6">
        <button
          v-for="member in unclaimedMembers"
          :key="member.id"
          class="group flex w-[88px] flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
          @click="selectMember(member)"
        >
          <div class="relative">
            <BeanieAvatar
              :variant="getMemberAvatarVariant(member)"
              :color="member.color"
              size="xl"
            />
            <!-- Unclaimed indicator -->
            <div
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

      <!-- No unclaimed members -->
      <div v-else class="py-8 text-center">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('join.noUnclaimedMembers') }}
        </p>
      </div>
    </template>

    <!-- ============================================ -->
    <!-- STEP 3: Create Password                      -->
    <!-- ============================================ -->
    <template v-else-if="currentStep === 'set-password'">
      <!-- Header -->
      <div class="mb-6 text-center">
        <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('join.setPasswordTitle') }}
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('join.setPasswordSubtitle') }}
        </p>
      </div>

      <!-- Error -->
      <div
        v-if="formError"
        class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ formError }}
      </div>

      <form @submit.prevent="handleCreatePassword">
        <!-- Selected member card -->
        <div class="mb-4 flex items-center gap-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-700/50">
          <BeanieAvatar
            v-if="selectedMember"
            :variant="getMemberAvatarVariant(selectedMember)"
            :color="selectedMember.color"
            size="lg"
          />
          <div class="flex-1">
            <p class="font-outfit font-semibold text-gray-900 dark:text-gray-100">
              {{ selectedMember?.name }}
            </p>
            <p
              v-if="selectedMember?.email && !isTemporaryEmail(selectedMember.email)"
              class="text-xs text-gray-500 dark:text-gray-400"
            >
              {{ selectedMember.email }}
            </p>
          </div>
          <button
            v-if="unclaimedMembers.length > 1"
            type="button"
            class="text-sm font-medium text-[#F15D22] hover:text-[#E67E22]"
            @click="handleBack"
          >
            {{ t('action.change') }}
          </button>
        </div>

        <!-- Password fields -->
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

        <BaseButton type="submit" class="mt-4 w-full" :disabled="isJoining">
          {{ isJoining ? t('join.completing') : t('auth.createAndSignIn') }}
        </BaseButton>
      </form>
    </template>

    <!-- Decrypt Modal -->
    <BaseModal :open="showDecryptModal" @close="showDecryptModal = false">
      <div class="text-center">
        <h3 class="font-outfit text-[1.2rem] font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.unlockTitle') }}
        </h3>
        <p class="mt-1 text-[0.75rem] opacity-40">
          {{ t('loginV6.unlockSubtitle') }}
        </p>
      </div>

      <form class="mt-6" @submit.prevent="handleDecrypt">
        <div
          v-if="formError"
          class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ formError }}
        </div>

        <BaseInput
          v-model="decryptPassword"
          :label="t('password.password')"
          type="password"
          :placeholder="t('password.enterPasswordPlaceholder')"
          required
        />

        <BaseButton
          type="submit"
          class="mt-4 w-full bg-gradient-to-r from-[#F15D22] to-[#E67E22]"
          :disabled="isLoadingFile"
        >
          {{ t('loginV6.unlockButton') }}
        </BaseButton>
      </form>
    </BaseModal>
  </div>
</template>
