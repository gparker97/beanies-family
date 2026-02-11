import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

// Import other stores for auto-sync watching
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useSettingsStore } from './settingsStore';
import { useTransactionsStore } from './transactionsStore';
import { saveSettings } from '@/services/indexeddb/repositories/settingsRepository';
import { getSyncCapabilities, canAutoSync } from '@/services/sync/capabilities';
import { exportToFile, importFromFile } from '@/services/sync/fileSync';
import * as syncService from '@/services/sync/syncService';
import type { SyncFileData } from '@/types/models';
import { toISODateString } from '@/utils/date';

export const useSyncStore = defineStore('sync', () => {
  // State
  const isInitialized = ref(false);
  const isConfigured = ref(false);
  const fileName = ref<string | null>(null);
  const isSyncing = ref(false);
  const error = ref<string | null>(null);
  const lastSync = ref<string | null>(null);
  const needsPermission = ref(false);

  // Encryption state
  const sessionPassword = ref<string | null>(null);
  const pendingEncryptedFile = ref<{
    fileHandle: FileSystemFileHandle;
    rawSyncData: SyncFileData;
  } | null>(null);

  // Capabilities
  const capabilities = computed(() => getSyncCapabilities());
  const supportsAutoSync = computed(() => canAutoSync());

  // Encryption computed
  const isEncryptionEnabled = computed(() => {
    const settingsStore = useSettingsStore();
    return settingsStore.settings.encryptionEnabled;
  });

  const hasSessionPassword = computed(() => sessionPassword.value !== null);

  const hasPendingEncryptedFile = computed(() => pendingEncryptedFile.value !== null);

  // Getters
  const syncStatus = computed(() => {
    if (!isConfigured.value) return 'not-configured';
    if (needsPermission.value) return 'needs-permission';
    if (isSyncing.value) return 'syncing';
    if (error.value) return 'error';
    return 'ready';
  });

  // Subscribe to sync service state changes
  syncService.onStateChange((state) => {
    isInitialized.value = state.isInitialized;
    isConfigured.value = state.isConfigured;
    fileName.value = state.fileName;
    isSyncing.value = state.isSyncing;
    error.value = state.lastError;
  });

  /**
   * Initialize sync - restore file handle if available
   */
  async function initialize(): Promise<void> {
    const restored = await syncService.initialize();

    if (restored) {
      // Check if we have permission
      const hasPermission = await syncService.hasPermission();
      needsPermission.value = !hasPermission;
    }
  }

  /**
   * Request permission to access the sync file (must be called from user gesture)
   * If permission is granted, automatically loads from file and sets up auto-sync
   */
  async function requestPermission(): Promise<boolean> {
    const granted = await syncService.requestPermission();
    needsPermission.value = !granted;

    if (granted) {
      // Permission granted - load from file to get latest data
      const hasData = await syncService.loadAndImport();
      if (hasData) {
        lastSync.value = toISODateString(new Date());
        await reloadAllStores();
      }
      // Set up auto-sync now that we have permission
      setupAutoSync();
    }

    return granted;
  }

  /**
   * Configure a sync file (opens file picker)
   */
  async function configureSyncFile(): Promise<boolean> {
    const success = await syncService.selectSyncFile();
    if (success) {
      needsPermission.value = false;
      // Save initial data to the file
      await syncNow();
      // Update settings to reflect sync is enabled
      await saveSettings({
        syncEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: toISODateString(new Date()),
      });
    }
    return success;
  }

  /**
   * Check if the sync file has newer data than our last sync
   * Returns: { hasConflict, fileTimestamp, localTimestamp }
   */
  async function checkForConflicts(): Promise<{
    hasConflict: boolean;
    fileTimestamp: string | null;
    localTimestamp: string | null;
  }> {
    const fileTimestamp = await syncService.getFileTimestamp();
    const localTimestamp = lastSync.value;

    // If no file timestamp, no conflict (file might be empty/new)
    if (!fileTimestamp) {
      return { hasConflict: false, fileTimestamp: null, localTimestamp };
    }

    // If no local sync, we should load from file, not save
    if (!localTimestamp) {
      return { hasConflict: true, fileTimestamp, localTimestamp: null };
    }

    // Compare timestamps - if file is newer, there's a conflict
    const hasConflict = new Date(fileTimestamp) > new Date(localTimestamp);
    return { hasConflict, fileTimestamp, localTimestamp };
  }

  /**
   * Sync now - save current data to file
   * Uses encryption if enabled and session password is set
   * @param force - If true, skip conflict detection and force save
   */
  async function syncNow(force = false): Promise<boolean> {
    // Check for conflicts unless forced
    if (!force) {
      const { hasConflict } = await checkForConflicts();
      if (hasConflict) {
        error.value = 'File has newer data. Load from file first or force sync.';
        return false;
      }
    }

    const password = isEncryptionEnabled.value ? (sessionPassword.value ?? undefined) : undefined;
    const success = await syncService.save(password);
    if (success) {
      lastSync.value = toISODateString(new Date());
      await saveSettings({ lastSyncTimestamp: lastSync.value });
    }
    return success;
  }

  /**
   * Force sync - save current data to file, overwriting any newer data
   */
  async function forceSyncNow(): Promise<boolean> {
    return syncNow(true);
  }

  /**
   * Load data from the currently configured sync file
   */
  async function loadFromFile(): Promise<boolean> {
    const success = await syncService.loadAndImport();
    if (success) {
      lastSync.value = toISODateString(new Date());
      // Reload all stores after import
      await reloadAllStores();
    }
    return success;
  }

  /**
   * Open file picker to select a new file, load its data, and set it as sync target.
   * This replaces both local data AND the sync file connection.
   * Returns: { success, needsPassword } - if needsPassword is true, call decryptPendingFile with password
   */
  async function loadFromNewFile(): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.openAndLoadFile();

    // If file needs password, store it for later decryption
    if (result.needsPassword && result.fileHandle && result.rawSyncData) {
      pendingEncryptedFile.value = {
        fileHandle: result.fileHandle,
        rawSyncData: result.rawSyncData,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Reload all stores after import
      await reloadAllStores();

      // Update settings to reflect sync is enabled with the new file
      await saveSettings({
        syncEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });
    }
    return { success: result.success };
  }

  /**
   * Decrypt and load the pending encrypted file
   */
  async function decryptPendingFile(
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!pendingEncryptedFile.value) {
      return { success: false, error: 'No pending encrypted file' };
    }

    const { fileHandle, rawSyncData } = pendingEncryptedFile.value;
    const result = await syncService.decryptAndImport(fileHandle, rawSyncData, password);

    if (result.success) {
      // Clear pending file
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Set the session password for future saves
      sessionPassword.value = password;
      syncService.setSessionPassword(password);

      // Reload all stores after import
      await reloadAllStores();

      // Update settings to reflect sync is enabled with encryption
      await saveSettings({
        syncEnabled: true,
        encryptionEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });
    }

    return result;
  }

  /**
   * Clear the pending encrypted file (user cancelled)
   */
  function clearPendingEncryptedFile(): void {
    pendingEncryptedFile.value = null;
  }

  /**
   * Enable encryption with the given password
   * Immediately re-saves the file encrypted
   */
  async function enableEncryption(password: string): Promise<boolean> {
    // Set session password
    sessionPassword.value = password;
    syncService.setSessionPassword(password);

    // Update settings in DB
    await saveSettings({ encryptionEnabled: true });

    // Also update the settings store so isEncryptionEnabled reflects the change
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    // Re-save the file encrypted - pass password directly to ensure encryption happens
    const success = await syncService.save(password);
    if (success) {
      lastSync.value = toISODateString(new Date());
      await saveSettings({ lastSyncTimestamp: lastSync.value });
    } else {
      // Rollback on failure
      sessionPassword.value = null;
      syncService.setSessionPassword(null);
      await saveSettings({ encryptionEnabled: false });
      await settingsStore.loadSettings();
    }
    return success;
  }

  /**
   * Disable encryption
   * Immediately re-saves the file unencrypted
   */
  async function disableEncryption(): Promise<boolean> {
    // Clear session password
    sessionPassword.value = null;
    syncService.setSessionPassword(null);

    // Update settings in DB
    await saveSettings({ encryptionEnabled: false });

    // Also update the settings store
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    // Re-save the file unencrypted (no password = unencrypted)
    const success = await syncService.save(undefined);
    if (success) {
      lastSync.value = toISODateString(new Date());
      await saveSettings({ lastSyncTimestamp: lastSync.value });
    }
    // Note: We don't rollback here - the setting is disabled even if save fails
    // User can manually sync later
    return success;
  }

  /**
   * Set session password (for when user enters password to access encrypted file)
   */
  function setSessionPassword(password: string): void {
    sessionPassword.value = password;
    syncService.setSessionPassword(password);
  }

  /**
   * Clear session password (e.g., on logout or session end)
   */
  function clearSessionPassword(): void {
    sessionPassword.value = null;
    syncService.setSessionPassword(null);
  }

  /**
   * Disconnect from sync file
   */
  async function disconnect(): Promise<void> {
    await syncService.disconnect();
    needsPermission.value = false;
    lastSync.value = null;
    sessionPassword.value = null;
    syncService.setSessionPassword(null);
    await saveSettings({
      syncEnabled: false,
      encryptionEnabled: false,
      syncFilePath: undefined,
      lastSyncTimestamp: undefined,
    });
  }

  /**
   * Manual export (fallback for browsers without File System Access API)
   */
  async function manualExport(): Promise<void> {
    await exportToFile();
    lastSync.value = toISODateString(new Date());
  }

  /**
   * Manual import (fallback for browsers without File System Access API)
   */
  async function manualImport(): Promise<{ success: boolean; error?: string }> {
    const result = await importFromFile();
    if (result.success) {
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
    }
    return result;
  }

  /**
   * Reload all stores after data import
   */
  async function reloadAllStores(): Promise<void> {
    const familyStore = useFamilyStore();
    const accountsStore = useAccountsStore();
    const transactionsStore = useTransactionsStore();
    const assetsStore = useAssetsStore();
    const goalsStore = useGoalsStore();
    const settingsStore = useSettingsStore();
    const recurringStore = useRecurringStore();

    await Promise.all([
      familyStore.loadMembers(),
      accountsStore.loadAccounts(),
      transactionsStore.loadTransactions(),
      assetsStore.loadAssets(),
      goalsStore.loadGoals(),
      settingsStore.loadSettings(),
      recurringStore.loadRecurringItems(),
    ]);
  }

  /**
   * Setup auto-sync watchers for all data stores
   */
  function setupAutoSync(): void {
    if (!supportsAutoSync.value) return;

    const settingsStore = useSettingsStore();

    // Watch for changes in all data stores
    watch(
      () => [
        useFamilyStore().members,
        useAccountsStore().accounts,
        useTransactionsStore().transactions,
        useAssetsStore().assets,
        useGoalsStore().goals,
        useRecurringStore().recurringItems,
      ],
      () => {
        // Only auto-sync if configured and enabled
        if (
          isConfigured.value &&
          !needsPermission.value &&
          settingsStore.settings.autoSyncEnabled
        ) {
          syncService.triggerDebouncedSave();
        }
      },
      { deep: true }
    );
  }

  /**
   * Clear any error state
   */
  function clearError(): void {
    error.value = null;
  }

  return {
    // State
    isInitialized,
    isConfigured,
    fileName,
    isSyncing,
    error,
    lastSync,
    needsPermission,
    pendingEncryptedFile,
    // Computed
    capabilities,
    supportsAutoSync,
    syncStatus,
    isEncryptionEnabled,
    hasSessionPassword,
    hasPendingEncryptedFile,
    // Actions
    initialize,
    requestPermission,
    configureSyncFile,
    syncNow,
    forceSyncNow,
    checkForConflicts,
    loadFromFile,
    loadFromNewFile,
    decryptPendingFile,
    clearPendingEncryptedFile,
    enableEncryption,
    disableEncryption,
    setSessionPassword,
    clearSessionPassword,
    disconnect,
    manualExport,
    manualImport,
    reloadAllStores,
    setupAutoSync,
    clearError,
  };
});
