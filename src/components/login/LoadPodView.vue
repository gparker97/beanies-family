<script setup lang="ts">
/* global FileSystemFileHandle, FileSystemHandle */
import { ref, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import GoogleDriveFilePicker from '@/components/google/GoogleDriveFilePicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import {
  isPlatformAuthenticatorAvailable,
  hasRegisteredPasskeys,
} from '@/services/auth/passkeyService';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();

const SESSION_PASSWORD_KEY = 'beanies-file-password';

const props = defineProps<{
  needsPermissionGrant?: boolean;
  autoLoad?: boolean;
  skipBiometric?: boolean;
  forceNewGoogleAccount?: boolean;
  loadError?: string;
  providerHint?: 'local' | 'google_drive';
}>();

const emit = defineEmits<{
  back: [];
  'file-loaded': [];
  'biometric-available': [payload: { familyId: string; familyName?: string }];
}>();

const isLoadingFile = ref(false);
const formError = ref<string | null>(null);
const showDecryptModal = ref(false);
const decryptPassword = ref('');
const loadedFileName = ref<string | null>(null);
const isDragging = ref(false);
const selectedSource = ref<'google_drive' | 'dropbox' | 'icloud' | 'local' | null>(null);
let dragCounter = 0;

/**
 * Try to auto-decrypt using a cached sessionStorage password.
 * Returns true if decryption succeeded.
 */
async function tryAutoDecrypt(): Promise<boolean> {
  // Use familyId from pending encrypted file's raw data for per-family cache lookup
  const pendingFamilyId = syncStore.pendingEncryptedFile?.rawSyncData?.familyId;

  // Try sessionStorage first (current session), then trusted device cache (persistent)
  const passwords = [
    sessionStorage.getItem(SESSION_PASSWORD_KEY),
    pendingFamilyId ? settingsStore.getCachedEncryptionPassword(pendingFamilyId) : null,
  ].filter(Boolean) as string[];

  for (const pw of passwords) {
    try {
      const result = await syncStore.decryptPendingFile(pw);
      if (result.success) return true;
    } catch {
      // Try next password
    }
  }

  // All attempts failed — clear stale caches
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
  if (pendingFamilyId) {
    await settingsStore.clearCachedEncryptionPassword(pendingFamilyId);
  }
  return false;
}

/**
 * Check if biometric login is available for the given family.
 * Returns true if biometric-available was emitted (caller should stop the password flow).
 */
async function checkBiometricForFamily(familyId: string, familyName?: string): Promise<boolean> {
  if (props.skipBiometric) return false;
  try {
    const hasPlatform = await isPlatformAuthenticatorAvailable();
    if (!hasPlatform) return false;
    const hasPasskeys = await hasRegisteredPasskeys(familyId);
    if (!hasPasskeys) return false;
    emit('biometric-available', { familyId, familyName });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract familyId/familyName from the pending encrypted file's raw sync data.
 */
function getPendingFamilyInfo(): { familyId?: string; familyName?: string } {
  const raw = syncStore.pendingEncryptedFile?.rawSyncData;
  return { familyId: raw?.familyId, familyName: raw?.familyName };
}

onMounted(async () => {
  if (props.loadError) {
    formError.value = props.loadError;
  }
  if (props.providerHint === 'local') {
    selectedSource.value = 'local';
  }
  if (props.autoLoad) {
    await autoLoadFile();
  }
});

async function autoLoadFile() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    // If there's already a pending encrypted file (e.g. from loadFromNewFile() before
    // a biometric fallback), go straight to decrypt flow instead of re-reading from
    // the configured handle — which may still point to the previous family's file.
    if (syncStore.hasPendingEncryptedFile) {
      if (!(await tryAutoDecrypt())) {
        const { familyId, familyName } = getPendingFamilyInfo();
        if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
          // Biometric flow will handle decryption — don't show password modal
        } else {
          loadedFileName.value = syncStore.fileName;
          showDecryptModal.value = true;
        }
      } else {
        emit('file-loaded');
      }
      isLoadingFile.value = false;
      return;
    }

    const loadResult = await syncStore.loadFromFile();
    if (!loadResult.success && loadResult.needsPassword) {
      // File is encrypted — try cached password before showing modal
      if (!(await tryAutoDecrypt())) {
        const { familyId, familyName } = getPendingFamilyInfo();
        if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
          // Biometric flow will handle decryption — don't show password modal
        } else {
          loadedFileName.value = syncStore.fileName;
          showDecryptModal.value = true;
        }
      } else {
        emit('file-loaded');
      }
    } else if (loadResult.success) {
      emit('file-loaded');
    }
  } catch {
    // File load failed — stay on this screen
  }
  isLoadingFile.value = false;
}

async function handleGrantPermission() {
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const granted = await syncStore.requestPermission();
    if (granted) {
      if (syncStore.hasPendingEncryptedFile) {
        if (!(await tryAutoDecrypt())) {
          const { familyId, familyName } = getPendingFamilyInfo();
          if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
            // Biometric flow will handle decryption
          } else {
            loadedFileName.value = syncStore.fileName;
            showDecryptModal.value = true;
          }
        } else {
          emit('file-loaded');
        }
      } else {
        emit('file-loaded');
      }
    } else {
      formError.value = t('auth.fileLoadFailed');
    }
  } catch {
    formError.value = t('auth.fileLoadFailed');
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleLoadFile() {
  formError.value = null;

  try {
    const result = await syncStore.loadFromNewFile();
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      const { familyId, familyName } = getPendingFamilyInfo();
      if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
        // Biometric flow will handle decryption
      } else {
        loadedFileName.value = syncStore.fileName;
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
      // decryptPendingFile already caches on trusted devices via syncStore
      showDecryptModal.value = false;
      decryptPassword.value = '';
      emit('file-loaded');
    } else {
      formError.value = result.error ?? t('password.decryptionError');
    }
  } catch {
    formError.value = t('password.decryptionError');
  } finally {
    isLoadingFile.value = false;
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

  // Grab the File synchronously — dataTransfer is cleared after the event handler returns
  const file = item.getAsFile();
  if (!file) return;

  // Try to get a FileSystemFileHandle for persistent access (Chromium only)
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

  // Validate file extension
  if (!file.name.endsWith('.beanpod') && !file.name.endsWith('.json')) {
    formError.value = t('auth.fileLoadFailed');
    return;
  }

  isLoadingFile.value = true;
  try {
    const result = await syncStore.loadFromDroppedFile(file, fileHandle);
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      const { familyId, familyName } = getPendingFamilyInfo();
      if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
        // Biometric flow will handle decryption
      } else {
        loadedFileName.value = file.name;
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

// Google Drive state
const showDrivePicker = ref(false);
const driveFiles = ref<Array<{ fileId: string; name: string; modifiedTime: string }>>([]);
const isDriveLoading = ref(false);

async function handleLoadFromGoogleDrive() {
  if (!syncStore.isGoogleDriveAvailable) return;

  isDriveLoading.value = true;
  formError.value = null;

  try {
    driveFiles.value = await syncStore.listGoogleDriveFiles({
      forceNewAccount: props.forceNewGoogleAccount,
    });
    if (driveFiles.value.length === 0) {
      formError.value = t('googleDrive.noFilesFound');
    } else {
      showDrivePicker.value = true;
    }
  } catch (e) {
    formError.value = (e as Error).message || t('googleDrive.authFailed');
  } finally {
    isDriveLoading.value = false;
  }
}

async function handleDriveFileSelected(payload: { fileId: string; fileName: string }) {
  showDrivePicker.value = false;
  isLoadingFile.value = true;
  formError.value = null;

  try {
    const result = await syncStore.loadFromGoogleDrive(payload.fileId, payload.fileName);
    if (result.success) {
      emit('file-loaded');
    } else if (result.needsPassword) {
      // Try auto-decrypt first
      if (!(await tryAutoDecrypt())) {
        const { familyId, familyName } = getPendingFamilyInfo();
        if (familyId && (await checkBiometricForFamily(familyId, familyName))) {
          // Biometric flow will handle decryption
        } else {
          loadedFileName.value = payload.fileName;
          showDecryptModal.value = true;
        }
      } else {
        emit('file-loaded');
      }
    } else if (syncStore.error) {
      formError.value = syncStore.error;
    }
  } catch {
    formError.value = syncStore.error || t('googleDrive.loadError');
  } finally {
    isLoadingFile.value = false;
  }
}

async function handleDriveRefresh() {
  isDriveLoading.value = true;
  try {
    driveFiles.value = await syncStore.listGoogleDriveFiles();
  } catch {
    // Keep existing list
  } finally {
    isDriveLoading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="$emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header -->
    <div class="mb-6 text-center">
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.loadPodTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.loadPodSubtitle') }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Loading state (only for auto-load and permission grant) -->
    <div v-if="isLoadingFile" class="py-12 text-center">
      <div
        class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#F15D22]"
      ></div>
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('auth.loadingFile') }}</p>
    </div>

    <!-- Permission reconnect state -->
    <div v-else-if="needsPermissionGrant" class="space-y-4">
      <div
        class="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center dark:border-slate-600"
      >
        <div
          class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30"
        >
          <svg
            class="h-7 w-7 text-amber-600 dark:text-amber-400"
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
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {{ t('auth.reconnectFile') }}
        </p>
        <BaseButton class="w-full" @click="handleGrantPermission">
          {{ t('auth.reconnectButton') }}
        </BaseButton>
      </div>
    </div>

    <!-- Storage source cards -->
    <template v-else>
      <div class="grid grid-cols-2 gap-3">
        <!-- Google Drive card (always enabled) -->
        <button
          class="relative rounded-2xl border-2 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
          :class="
            selectedSource === 'google_drive'
              ? 'border-[#F15D22] bg-[#FEF0E8]/40 shadow-md dark:border-[#F15D22]/60 dark:bg-[#F15D22]/10'
              : 'border-gray-200 bg-white hover:border-[#F15D22]/40 dark:border-slate-600 dark:bg-slate-700/50 dark:hover:border-[#F15D22]/30'
          "
          :disabled="isDriveLoading"
          @click="handleLoadFromGoogleDrive"
        >
          <span
            class="absolute -top-2.5 right-3 rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] px-2.5 py-0.5 text-[0.6rem] font-bold text-white shadow-sm"
          >
            {{ t('loginV6.recommended') }}
          </span>
          <div
            class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#F15D22]/10 dark:bg-[#F15D22]/20"
          >
            <svg
              v-if="isDriveLoading"
              class="h-5 w-5 animate-spin text-[#F15D22]"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <svg v-else class="h-5 w-5 text-[#F15D22]" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
              />
            </svg>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ t('googleDrive.storageLabel') }}
          </p>
          <p class="mt-0.5 text-[0.68rem] text-gray-500 dark:text-gray-400">
            {{ t('loginV6.googleDriveCardDesc') }}
          </p>
        </button>

        <!-- Dropbox card (coming soon) -->
        <div
          class="relative cursor-not-allowed rounded-2xl border-2 border-gray-200 bg-white p-5 text-left opacity-50 dark:border-slate-600 dark:bg-slate-700/50"
        >
          <span
            class="absolute -top-2.5 right-3 rounded-full bg-gray-400 px-2.5 py-0.5 text-[0.6rem] font-bold text-white"
          >
            {{ t('loginV6.cloudComingSoon') }}
          </span>
          <div
            class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20"
          >
            <svg class="h-5 w-5 text-[#0061FF]" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.707 7.293l-1.414 1.414L12 7.414l-3.293 3.293-1.414-1.414L12 4.586l4.707 4.707z"
              />
            </svg>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ t('storage.dropbox') }}
          </p>
          <p class="mt-0.5 text-[0.68rem] text-gray-500 dark:text-gray-400">
            {{ t('loginV6.dropboxCardDesc') }}
          </p>
        </div>

        <!-- iCloud card (coming soon) -->
        <div
          class="relative cursor-not-allowed rounded-2xl border-2 border-gray-200 bg-white p-5 text-left opacity-50 dark:border-slate-600 dark:bg-slate-700/50"
        >
          <span
            class="absolute -top-2.5 right-3 rounded-full bg-gray-400 px-2.5 py-0.5 text-[0.6rem] font-bold text-white"
          >
            {{ t('loginV6.cloudComingSoon') }}
          </span>
          <div
            class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-700"
          >
            <svg class="h-5 w-5 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"
              />
            </svg>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ t('storage.iCloud') }}
          </p>
          <p class="mt-0.5 text-[0.68rem] text-gray-500 dark:text-gray-400">
            {{ t('loginV6.iCloudCardDesc') }}
          </p>
        </div>

        <!-- Local File card -->
        <button
          class="relative rounded-2xl border-2 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
          :class="
            selectedSource === 'local'
              ? 'border-[#F15D22] bg-[#FEF0E8]/40 shadow-md dark:border-[#F15D22]/60 dark:bg-[#F15D22]/10'
              : 'border-gray-200 bg-white hover:border-[#F15D22]/40 dark:border-slate-600 dark:bg-slate-700/50 dark:hover:border-[#F15D22]/30'
          "
          @click="selectedSource = selectedSource === 'local' ? null : 'local'"
        >
          <div
            class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl"
            :class="
              selectedSource === 'local'
                ? 'bg-[#F15D22]/15 dark:bg-[#F15D22]/20'
                : 'bg-gray-100 dark:bg-slate-700'
            "
          >
            <svg
              class="h-5 w-5"
              :class="
                selectedSource === 'local' ? 'text-[#F15D22]' : 'text-gray-400 dark:text-gray-500'
              "
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
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ t('storage.localFile') }}
          </p>
          <p class="mt-0.5 text-[0.68rem] text-gray-500 dark:text-gray-400">
            {{ t('loginV6.localFileCardDesc') }}
          </p>
        </button>
      </div>

      <!-- Local file drop zone (appears when Local File selected) -->
      <div
        v-if="selectedSource === 'local'"
        role="button"
        tabindex="0"
        class="group mt-3 w-full cursor-pointer rounded-2xl border-[3px] border-dashed px-6 py-8 text-center transition-all"
        :class="
          isDragging
            ? 'border-[#F15D22] bg-[#FEF0E8]/40 dark:border-[#F15D22]/60 dark:bg-[#F15D22]/10'
            : 'border-[#F15D22]/20 bg-gradient-to-br from-[#F15D22]/[0.02] to-[#AED6F1]/[0.04] hover:border-[#F15D22]/40 hover:bg-[#FEF0E8]/30 dark:border-[#F15D22]/15 dark:from-[#F15D22]/[0.03] dark:to-[#AED6F1]/[0.02] dark:hover:border-[#F15D22]/30'
        "
        @click="handleLoadFile"
        @keydown.enter="handleLoadFile"
        @dragenter="handleDragEnter"
        @dragleave="handleDragLeave"
        @dragover="handleDragOver"
        @drop="handleDrop"
      >
        <div
          class="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors"
          :class="
            isDragging
              ? 'bg-[#F15D22]/15 dark:bg-[#F15D22]/20'
              : 'bg-gray-100 group-hover:bg-[#F15D22]/10 dark:bg-slate-700'
          "
        >
          <svg
            class="h-7 w-7 transition-colors"
            :class="
              isDragging
                ? 'text-[#F15D22]'
                : 'text-gray-400 group-hover:text-[#F15D22] dark:text-gray-500'
            "
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
        </div>
        <p class="font-medium text-gray-700 dark:text-gray-300">
          {{ t('loginV6.dropZoneText') }}
        </p>
        <p class="mt-1 text-sm text-[#F15D22]">
          {{ t('loginV6.dropZoneBrowse') }}
        </p>
        <p class="mt-2 text-[0.7rem] font-semibold text-[#F15D22]/70">
          {{ t('loginV6.acceptsBeanpod') }}
        </p>
      </div>

      <!-- Google Drive File Picker Modal -->
      <GoogleDriveFilePicker
        :open="showDrivePicker"
        :files="driveFiles"
        :is-loading="isDriveLoading"
        @close="showDrivePicker = false"
        @select="handleDriveFileSelected"
        @refresh="handleDriveRefresh"
      />

      <!-- Security messaging -->
      <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <!-- Card 1: Your Data, Your Cloud -->
        <div
          class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
        >
          <div
            class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#6EE7B7]/[0.12]"
          >
            <svg
              class="h-5 w-5 text-[#10b981]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
              />
            </svg>
          </div>
          <p class="text-[0.68rem] font-bold text-gray-700 dark:text-gray-300">
            {{ t('loginV6.securityYourData') }}
          </p>
          <p class="mt-0.5 text-[0.62rem] opacity-35">
            {{ t('loginV6.securityYourDataDesc') }}
          </p>
        </div>

        <!-- Card 2: AES-256 Encrypted -->
        <div
          class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
        >
          <div
            class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#F15D22]/10"
          >
            <svg
              class="h-5 w-5 text-[#F15D22]"
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
          <p class="text-[0.68rem] font-bold text-gray-700 dark:text-gray-300">
            {{ t('loginV6.securityEncrypted') }}
          </p>
          <p class="mt-0.5 text-[0.62rem] opacity-35">
            {{ t('loginV6.securityEncryptedDesc') }}
          </p>
        </div>

        <!-- Card 3: Zero Servers -->
        <div
          class="rounded-[18px] bg-white p-4 text-center shadow-[0_4px_16px_rgba(44,62,80,0.04)] dark:bg-slate-700/50 dark:shadow-none"
        >
          <div
            class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#AED6F1]/20"
          >
            <svg
              class="h-5 w-5 text-[#3498db]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <p class="text-[0.68rem] font-bold text-gray-700 dark:text-gray-300">
            {{ t('loginV6.securityZeroServers') }}
          </p>
          <p class="mt-0.5 text-[0.62rem] opacity-35">
            {{ t('loginV6.securityZeroServersDesc') }}
          </p>
        </div>
      </div>
    </template>

    <!-- Decrypt Modal -->
    <BaseModal :open="showDecryptModal" @close="showDecryptModal = false">
      <div class="text-center">
        <!-- File loaded badge -->
        <div
          v-if="loadedFileName"
          class="mx-auto mb-4 inline-flex items-center gap-2 rounded-full bg-[#27AE60]/[0.08] px-3 py-1.5 text-[0.68rem] font-semibold text-[#27AE60] dark:bg-green-900/30 dark:text-green-400"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {{ loadedFileName }} {{ t('loginV6.fileLoaded') }}
          <svg class="h-3 w-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <!-- Heading -->
        <h3 class="font-outfit text-[1.2rem] font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.unlockTitle') }}
        </h3>
        <p class="mt-1 text-[0.75rem] opacity-40">
          {{ t('loginV6.unlockSubtitle') }}
        </p>
      </div>

      <!-- Password form -->
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

        <p class="mt-3 text-center text-[0.68rem] opacity-30">
          {{ t('loginV6.unlockFooter') }}
        </p>
      </form>
    </BaseModal>
  </div>
</template>
