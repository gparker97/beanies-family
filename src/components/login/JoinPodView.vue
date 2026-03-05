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
import { pickBeanpodFile } from '@/services/google/drivePicker';
import {
  requestAccessToken,
  startRedirectAuth,
  completeRedirectAuth,
} from '@/services/google/googleAuth';
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
const targetDriveFileId = ref('');
const inviteToken = ref('');
const registryEntry = ref<RegistryEntry | null>(null);
const isLookingUp = ref(false);
const lookupDone = ref(false);
const formError = ref<string | null>(null);

// File loading (inline within verify step)
const fileLoaded = ref(false);
const needsManualFileLoad = ref(false);
const cloudLoadFailed = ref(false);
const isLoadingFile = ref(false);
const isPickerLoading = ref(false);
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
  // Parse query params — invite links use t= and f=, magic links use fam= and code=
  const fam =
    (route.query.fam as string) || (route.query.code as string) || (route.query.f as string) || '';
  const p = (route.query.p as string) || 'local';
  const fileRef = (route.query.ref as string) || '';
  const fileIdParam = (route.query.fileId as string) || '';
  const token = (route.query.t as string) || '';

  if (token) inviteToken.value = token;

  if (fam) {
    targetFamilyId.value = fam;
    targetProvider.value = p;
    targetFileRef.value = fileRef;
    targetDriveFileId.value = fileIdParam;

    // Check if we're returning from a redirect-based OAuth flow (mobile)
    const redirectToken = await completeRedirectAuth().catch((e) => {
      console.error('[JoinPodView] Redirect auth failed:', e);
      return null;
    });
    if (redirectToken && p === 'google_drive') {
      // We have a token from redirect auth — go straight to Picker
      await handlePickFromDriveWithToken(redirectToken);
      return;
    }

    await performLookup(fam);
  }
});

async function performLookup(familyId: string) {
  isLookingUp.value = true;
  formError.value = null;
  lookupDone.value = false;

  try {
    if (!isRegistryConfigured()) {
      // Registry not configured — try cloud load if we have provider info from URL
      registryEntry.value = null;
      lookupDone.value = true;
      await attemptFileLoad();
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
    } else {
      // Registry didn't find it — still try cloud load if URL had provider info
      await attemptFileLoad();
    }
  } catch {
    // Network error — try cloud load if we have provider info, else manual fallback
    lookupDone.value = true;
    await attemptFileLoad();
  } finally {
    isLookingUp.value = false;
  }
}

async function attemptFileLoad() {
  // For local provider, we can't load the file automatically
  if (targetProvider.value === 'local') {
    needsManualFileLoad.value = true;
    return;
  }

  if (targetProvider.value === 'google_drive') {
    const fileId = targetDriveFileId.value || registryEntry.value?.fileId;
    const fileName = expectedFileName.value || 'family.beanpod';

    if (!fileId) {
      needsManualFileLoad.value = true;
      return;
    }

    isLoadingFile.value = true;
    try {
      const result = await syncStore.loadFromGoogleDrive(fileId, fileName);
      if (result.success) {
        await onFileLoaded();
      } else if (result.needsPassword) {
        if (await tryInviteTokenDecrypt()) {
          await onFileLoaded();
        } else if (!inviteToken.value) {
          showDecryptModal.value = true;
        }
        // If invite token was present but failed, formError is already set
      } else {
        // Cloud load failed — fall back to manual file load
        cloudLoadFailed.value = true;
        needsManualFileLoad.value = true;
      }
    } catch {
      cloudLoadFailed.value = true;
      needsManualFileLoad.value = true;
    } finally {
      isLoadingFile.value = false;
    }
    return;
  }

  // Unknown provider — fall back to manual
  needsManualFileLoad.value = true;
}

// --- Google Picker fallback ---
const showManualFallback = ref(false);

/** Open Picker with an already-acquired OAuth token. */
async function handlePickFromDriveWithToken(token: string) {
  isPickerLoading.value = true;
  formError.value = null;
  needsManualFileLoad.value = true; // ensure the Picker UI is visible
  try {
    const result = await pickBeanpodFile(token);
    if (!result) return; // User cancelled

    targetDriveFileId.value = result.fileId;
    cloudLoadFailed.value = false;
    await attemptFileLoad();
  } catch (e) {
    console.error('[JoinPodView] Picker failed:', e);
    const detail = e instanceof Error ? e.message : String(e);
    formError.value = `${t('join.pickerPrompt.error')} (${detail})`;
    showManualFallback.value = true;
  } finally {
    isPickerLoading.value = false;
  }
}

async function handlePickFromDrive() {
  isPickerLoading.value = true;
  formError.value = null;
  try {
    const token = await requestAccessToken();
    await handlePickFromDriveWithToken(token);
  } catch (e) {
    console.error('[JoinPodView] Picker auth failed:', e);
    const detail = e instanceof Error ? e.message : String(e);

    // If popup was blocked, fall back to redirect-based OAuth
    if (detail.includes('Popup blocked') || detail.includes('popup')) {
      console.warn('[JoinPodView] Popup blocked — falling back to redirect auth');
      try {
        // Build return URL preserving all current query params
        const returnPath = `${window.location.pathname}${window.location.search}`;
        await startRedirectAuth(returnPath);
        // Page will redirect — don't update state
        return;
      } catch (redirectErr) {
        console.error('[JoinPodView] Redirect auth failed:', redirectErr);
      }
    }

    formError.value = `${t('join.pickerPrompt.error')} (${detail})`;
    showManualFallback.value = true;
  } finally {
    isPickerLoading.value = false;
  }
}

// --- File picker / drop zone ---
async function handleLoadFile() {
  formError.value = null;

  try {
    const result = await syncStore.loadFromNewFile();
    if (result.success) {
      await onFileLoaded();
    } else if (result.needsPassword) {
      if (await tryInviteTokenDecrypt()) {
        await onFileLoaded();
      } else if (!inviteToken.value) {
        showDecryptModal.value = true;
      }
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
      if (await tryInviteTokenDecrypt()) {
        await onFileLoaded();
      } else if (!inviteToken.value) {
        showDecryptModal.value = true;
      }
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

/**
 * Try to decrypt the pending V4 file using the invite token.
 * Returns true if decryption succeeded, false if it should fall back to the password modal.
 */
async function tryInviteTokenDecrypt(): Promise<boolean> {
  if (!inviteToken.value) return false;

  const pending = syncStore.pendingEncryptedFile;
  if (!pending?.envelope?.inviteKeys) return false;

  try {
    const { hashInviteToken, redeemInviteToken, isInviteExpired } =
      await import('@/services/crypto/inviteService');

    const tokenHash = await hashInviteToken(inviteToken.value);
    const pkg = pending.envelope.inviteKeys[tokenHash];

    if (!pkg) {
      formError.value = t('join.inviteTokenInvalid');
      return false;
    }

    if (isInviteExpired(pkg.expiresAt)) {
      formError.value = t('join.inviteTokenExpired');
      return false;
    }

    const fk = await redeemInviteToken(pkg.wrapped, pkg.salt, inviteToken.value);
    const result = await syncStore.decryptPendingFileWithKey(fk);

    if (result.success) return true;

    formError.value = result.error ?? t('join.inviteTokenInvalid');
    return false;
  } catch {
    formError.value = t('join.inviteTokenInvalid');
    return false;
  }
}

async function onFileLoaded() {
  // Validate familyId matches if we have a target.
  // Use the V4 envelope's familyId (always available after decrypt) with fallback
  // to the context store (which may be null in a fresh browser).
  const loadedFamilyId = syncStore.envelope?.familyId ?? familyContextStore.activeFamilyId;
  if (targetFamilyId.value && loadedFamilyId && loadedFamilyId !== targetFamilyId.value) {
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
      emit('signed-in', '/nook');
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

      <!-- Error -->
      <div
        v-if="formError"
        class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ formError }}
      </div>

      <!-- Looking up / cloud loading spinner -->
      <div v-if="isLookingUp || (isLoadingFile && !needsManualFileLoad)" class="py-12 text-center">
        <div
          class="border-t-primary-500 mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300"
        ></div>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ isLoadingFile ? t('join.loadingFromCloud') : t('join.lookingUp') }}
        </p>
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

        <!-- Google Picker (primary option when cloud load failed for Drive) -->
        <template v-if="cloudLoadFailed && targetProvider === 'google_drive'">
          <div class="space-y-3 text-center">
            <p class="text-sm text-slate-600 dark:text-slate-400">
              {{ t('join.pickerPrompt.description') }}
            </p>
            <BaseButton :loading="isPickerLoading" class="w-full" @click="handlePickFromDrive">
              {{ t('join.pickerPrompt.button') }}
            </BaseButton>
          </div>

          <!-- Manual file fallback (collapsed by default, expands on click or Picker error) -->
          <div class="mt-4">
            <button
              v-if="!showManualFallback"
              type="button"
              class="text-primary-500 hover:text-terracotta-400 mx-auto block text-xs font-medium"
              @click="showManualFallback = true"
            >
              {{ t('join.pickerPrompt.orManual') }}
            </button>
            <div
              v-if="showManualFallback"
              class="bg-secondary-500 rounded-2xl p-5 dark:bg-slate-700"
            >
              <p class="mb-3 text-sm font-semibold text-white">
                {{ t('join.cloudLoadFailed') }}
              </p>
              <p class="mb-4 text-sm text-white/70">
                {{ t('join.needsFileDesc') }}
              </p>
              <div v-if="expectedFileName" class="mb-4 rounded-xl bg-white/10 px-3 py-2">
                <p class="text-xs text-white/50">{{ t('join.expectedFile') }}</p>
                <p class="font-mono text-sm font-medium text-white">{{ expectedFileName }}</p>
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
                @click="handleLoadFile"
                @keydown.enter="handleLoadFile"
                @dragenter="handleDragEnter"
                @dragleave="handleDragLeave"
                @dragover="handleDragOver"
                @drop="handleDrop"
              >
                <div v-if="isLoadingFile" class="py-2">
                  <div
                    class="border-t-primary-500 mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-white/30"
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
                  <p class="text-primary-500 mt-1 text-xs">
                    {{ t('join.loadFileButton') }}
                  </p>
                </template>
              </div>
            </div>
          </div>
        </template>

        <!-- File guidance card (non-Drive providers or no cloud failure) -->
        <div v-else class="bg-secondary-500 rounded-2xl p-5 dark:bg-slate-700">
          <p class="mb-3 text-sm font-semibold text-white">
            {{ cloudLoadFailed ? t('join.cloudLoadFailed') : t('join.needsFile') }}
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
                ? 'border-primary-500 bg-primary-500/10'
                : 'hover:border-primary-500/50 border-white/20 hover:bg-white/5'
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
                class="border-t-primary-500 mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-white/30"
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
              <p class="text-primary-500 mt-1 text-xs">
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

      <!-- No link params — show instructions to get a magic link -->
      <template v-else-if="!isLookingUp && !lookupDone">
        <!-- How to join card -->
        <div class="bg-secondary-500 rounded-2xl p-5 dark:bg-slate-700">
          <p class="mb-3 text-sm font-semibold text-white">
            {{ t('join.howToJoinTitle') }}
          </p>
          <div class="space-y-2.5">
            <div class="flex items-start gap-3">
              <div
                class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
              >
                1
              </div>
              <p class="text-sm text-white/80">{{ t('join.howToJoinStep1') }}</p>
            </div>
            <div class="flex items-start gap-3">
              <div
                class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
              >
                2
              </div>
              <p class="text-sm text-white/80">{{ t('join.howToJoinStep2') }}</p>
            </div>
            <div class="flex items-start gap-3">
              <div
                class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
              >
                3
              </div>
              <p class="text-sm text-white/80">{{ t('join.howToJoinStep3') }}</p>
            </div>
          </div>
        </div>

        <!-- Expiry note -->
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
          <p class="text-xs font-semibold opacity-50">
            {{ t('join.linkExpiryNote') }}
          </p>
        </div>
      </template>

      <!-- Footer link -->
      <div class="mt-6 text-center">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('loginV6.wantYourOwn') }}
        </span>
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
            class="text-primary-500 hover:text-terracotta-400 text-sm font-medium"
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
        <h3 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.unlockTitle') }}
        </h3>
        <p class="mt-1 text-xs opacity-40">
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
          class="from-primary-500 to-terracotta-400 mt-4 w-full bg-gradient-to-r"
          :disabled="isLoadingFile"
        >
          {{ t('loginV6.unlockButton') }}
        </BaseButton>
      </form>
    </BaseModal>
  </div>
</template>
