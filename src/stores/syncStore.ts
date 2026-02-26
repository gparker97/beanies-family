import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

// Import other stores for auto-sync watching
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useSettingsStore } from './settingsStore';
import { useFamilyContextStore } from './familyContextStore';
import { useTransactionsStore } from './transactionsStore';
import { saveSettings } from '@/services/indexeddb/repositories/settingsRepository';
import { invalidatePasskeysForPasswordChange } from '@/services/auth/passkeyService';
import { getSyncCapabilities, canAutoSync } from '@/services/sync/capabilities';
import { exportToFile, importFromFile } from '@/services/sync/fileSync';
import { readSettingsWAL, clearSettingsWAL, isWALStale } from '@/services/sync/settingsWAL';
import * as registry from '@/services/registry/registryService';
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
  const currentSessionPassword = computed(() => sessionPassword.value);

  // DEK-based encryption for passkey PRF sessions
  const sessionDEK = ref<CryptoKey | null>(null);

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

  // Register encryption check callback so syncService can guard against plaintext writes
  syncService.setEncryptionRequiredCallback(() => isEncryptionEnabled.value);

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
      const loadResult = await syncService.loadAndImport();
      if (loadResult.success) {
        lastSync.value = toISODateString(new Date());
        await reloadAllStores();
        // Only set up auto-sync after data is fully loaded (password not needed)
        setupAutoSync();
      } else if (loadResult.needsPassword && loadResult.fileHandle && loadResult.rawSyncData) {
        // File is encrypted — store for later decryption.
        // Do NOT set up auto-sync yet — we don't have the password,
        // and any store changes would trigger a plaintext write.
        pendingEncryptedFile.value = {
          fileHandle: loadResult.fileHandle,
          rawSyncData: loadResult.rawSyncData,
        };
      }
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
      // Arm auto-sync so future changes are saved to the file
      setupAutoSync();
      // Fire-and-forget: register family in cloud registry
      const ctx = useFamilyContextStore();
      if (ctx.activeFamilyId) {
        registry
          .registerFamily(ctx.activeFamilyId, {
            provider: 'local',
            displayPath: fileName.value,
            familyName: ctx.activeFamilyName,
          })
          .catch(() => {});
      }
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
  async function loadFromFile(): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.loadAndImport();

    // If file needs password, store it for later decryption
    if (result.needsPassword && result.fileHandle && result.rawSyncData) {
      pendingEncryptedFile.value = {
        fileHandle: result.fileHandle,
        rawSyncData: result.rawSyncData,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      lastSync.value = toISODateString(new Date());
      // Reload all stores after import
      await reloadAllStores();
    }
    return { success: result.success };
  }

  /**
   * Open file picker to select a new file, load its data, and set it as sync target.
   * This replaces both local data AND the sync file connection.
   * Returns: { success, needsPassword } - if needsPassword is true, call decryptPendingFile with password
   */
  async function loadFromNewFile(): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.openAndLoadFile();

    // If file needs password, store it for later decryption
    // On mobile there's no fileHandle, so we use an empty placeholder
    if (result.needsPassword && result.rawSyncData) {
      pendingEncryptedFile.value = {
        fileHandle: result.fileHandle ?? ({} as FileSystemFileHandle),
        rawSyncData: result.rawSyncData,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Reload all stores after import
      await reloadAllStores();

      // Update settings — preserve encryption state from the loaded file
      await saveSettings({
        syncEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });

      // Arm auto-sync so future changes are saved to the file
      setupAutoSync();
    }
    return { success: result.success };
  }

  /**
   * Load a file that was dropped onto the drop zone (drag-and-drop).
   */
  async function loadFromDroppedFile(
    file: File,
    fileHandle?: FileSystemFileHandle
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.loadDroppedFile(file, fileHandle);

    if (result.needsPassword && result.rawSyncData) {
      pendingEncryptedFile.value = {
        fileHandle: result.fileHandle ?? ({} as FileSystemFileHandle),
        rawSyncData: result.rawSyncData,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      await saveSettings({
        syncEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });
      // Arm auto-sync so future changes are saved to the file
      setupAutoSync();
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

      // Set the session password for future saves BEFORE reloading stores
      // so auto-sync (if armed) will have the password available
      sessionPassword.value = password;
      syncService.setSessionPassword(password);

      // Update settings to reflect sync is enabled with encryption
      // Do this BEFORE reloading stores to ensure encryptionEnabled is true
      // before any auto-sync watcher fires
      await saveSettings({
        syncEnabled: true,
        encryptionEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });

      // Cache password on trusted devices so it survives page refresh
      const settingsStore = useSettingsStore();
      await settingsStore.cacheEncryptionPassword(password);

      // Reload all stores after import
      await reloadAllStores();

      // Now that password is set and encryption is enabled, arm auto-sync
      setupAutoSync();
    }

    return result;
  }

  /**
   * Decrypt and load the pending encrypted file using a CryptoKey (passkey PRF path).
   * Unlike decryptPendingFile, this stores the DEK for future saves instead of a password.
   */
  async function decryptPendingFileWithDEK(
    dek: CryptoKey
  ): Promise<{ success: boolean; error?: string }> {
    if (!pendingEncryptedFile.value) {
      return { success: false, error: 'No pending encrypted file' };
    }

    const { fileHandle, rawSyncData } = pendingEncryptedFile.value;
    const result = await syncService.decryptAndImportWithKey(fileHandle, rawSyncData, dek);

    if (result.success) {
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Store the DEK and salt for future saves
      sessionDEK.value = dek;
      syncService.setSessionDEK(dek, result.salt);

      // Update settings
      await saveSettings({
        syncEnabled: true,
        encryptionEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: lastSync.value,
      });

      await reloadAllStores();
      setupAutoSync();
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

    // Clear any DEK-based session (password takes over)
    sessionDEK.value = null;
    syncService.setSessionDEK(null);

    // Re-save the file encrypted - pass password directly to ensure encryption happens
    const success = await syncService.save(password);
    if (success) {
      lastSync.value = toISODateString(new Date());
      await saveSettings({ lastSyncTimestamp: lastSync.value });
      // Cache password on trusted devices
      await settingsStore.cacheEncryptionPassword(password);

      // Invalidate passkey registrations (password changed, wrapped DEKs are stale)
      const familyContextStore = useFamilyContextStore();
      if (familyContextStore.activeFamilyId) {
        await invalidatePasskeysForPasswordChange(familyContextStore.activeFamilyId, password);
      }
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
    // Fire-and-forget: remove family from cloud registry before clearing state
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      clearSettingsWAL(ctx.activeFamilyId);
      registry.removeFamily(ctx.activeFamilyId).catch(() => {});
    }

    await syncService.disconnect();
    needsPermission.value = false;
    lastSync.value = null;
    sessionPassword.value = null;
    sessionDEK.value = null;
    syncService.setSessionPassword(null);
    syncService.setSessionDEK(null);

    // Clear cached encryption password
    const settingsStore = useSettingsStore();
    await settingsStore.clearCachedEncryptionPassword();
    // Do NOT reset encryptionEnabled — it should persist as a user preference.
    // When reconnecting to the same or a new encrypted file, the setting
    // will already be correct and won't cause a plaintext write window.
    await saveSettings({
      syncEnabled: false,
      syncFilePath: undefined,
      lastSyncTimestamp: undefined,
    });
  }

  /**
   * Manual export (fallback for browsers without File System Access API)
   */
  async function manualExport(): Promise<void> {
    const password = isEncryptionEnabled.value ? (sessionPassword.value ?? undefined) : undefined;
    await exportToFile(undefined, password);
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

  // Guard: suppress auto-sync watcher triggers during store reloads.
  // Without this, each store's loadX() fires the deep watcher → triggerDebouncedSave(),
  // which can capture a half-loaded snapshot (empty arrays) and write it to file.
  let isReloading = false;

  /**
   * Reload all stores after data import
   */
  async function reloadAllStores(): Promise<void> {
    isReloading = true;
    syncService.cancelPendingSave();

    try {
      const familyStore = useFamilyStore();
      const accountsStore = useAccountsStore();
      const transactionsStore = useTransactionsStore();
      const assetsStore = useAssetsStore();
      const goalsStore = useGoalsStore();
      const settingsStore = useSettingsStore();
      const recurringStore = useRecurringStore();
      const todoStore = useTodoStore();

      await Promise.all([
        familyStore.loadMembers(),
        accountsStore.loadAccounts(),
        transactionsStore.loadTransactions(),
        assetsStore.loadAssets(),
        goalsStore.loadGoals(),
        settingsStore.loadSettings(),
        recurringStore.loadRecurringItems(),
        todoStore.loadTodos(),
      ]);

      // WAL recovery: if there's a WAL entry newer than what the file had,
      // apply it so preferred currencies (etc.) survive refresh.
      await applySettingsWAL();
    } finally {
      isReloading = false;
    }
  }

  /**
   * Apply settings from the WAL if available and valid.
   * Called after reloadAllStores to recover settings that were lost
   * because the async file write didn't complete before unload.
   */
  async function applySettingsWAL(): Promise<void> {
    const ctx = useFamilyContextStore();
    const familyId = ctx.activeFamilyId;
    if (!familyId) return;

    const walEntry = readSettingsWAL(familyId);
    if (!walEntry) return;

    // Reject stale entries (>24h) to avoid overriding file changes from another device
    if (isWALStale(walEntry)) {
      clearSettingsWAL(familyId);
      return;
    }

    // Compare WAL timestamp with the file's exportedAt.
    // Only apply WAL if it's newer than the file's last save.
    const fileTimestamp = await syncService.getFileTimestamp();
    if (fileTimestamp) {
      const fileTime = new Date(fileTimestamp).getTime();
      if (walEntry.timestamp <= fileTime) {
        // File is newer or equal — WAL is outdated, clear it
        clearSettingsWAL(familyId);
        return;
      }
    }

    // Apply WAL settings to IndexedDB
    try {
      await saveSettings(walEntry.settings);
      const settingsStore = useSettingsStore();
      await settingsStore.loadSettings();
      // Trigger a save so the recovery is persisted to the file
      syncService.triggerDebouncedSave();
    } catch (e) {
      console.warn('[syncStore] Failed to apply settings WAL:', e);
    }
  }

  // Track the stop handle so we never register duplicate watchers
  let autoSyncStopHandle: ReturnType<typeof watch> | null = null;

  /**
   * Setup auto-sync watchers for all data stores.
   * Auto-sync is always on when file is configured + has permission.
   * Safe to call multiple times — duplicate watchers are prevented.
   */
  function setupAutoSync(): void {
    if (!supportsAutoSync.value) return;

    // Guard: don't register a second watcher if one is already active
    if (autoSyncStopHandle) return;

    // Watch for changes in all data stores
    autoSyncStopHandle = watch(
      () => [
        useFamilyStore().members,
        useAccountsStore().accounts,
        useTransactionsStore().transactions,
        useAssetsStore().assets,
        useGoalsStore().goals,
        useRecurringStore().recurringItems,
        useTodoStore().todos,
        useSettingsStore().settings,
      ],
      () => {
        // Skip auto-save while stores are being reloaded from file import
        // to prevent capturing half-loaded snapshots
        if (isReloading) return;
        // Auto-save whenever file is configured and accessible
        if (isConfigured.value && !needsPermission.value) {
          syncService.triggerDebouncedSave();
        }
      },
      { deep: true }
    );
  }

  /**
   * Reset all sync state (used on sign-out)
   */
  function resetState() {
    // Clear WAL for the current family before tearing down
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      clearSettingsWAL(ctx.activeFamilyId);
    }

    // Tear down auto-sync watcher so it can be re-armed for the next session/family
    if (autoSyncStopHandle) {
      autoSyncStopHandle();
      autoSyncStopHandle = null;
    }
    syncService.reset();
    isInitialized.value = false;
    isConfigured.value = false;
    fileName.value = null;
    isSyncing.value = false;
    error.value = null;
    lastSync.value = null;
    needsPermission.value = false;
    sessionPassword.value = null;
    sessionDEK.value = null;
    pendingEncryptedFile.value = null;
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
    currentSessionPassword,
    sessionDEK,
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
    loadFromDroppedFile,
    decryptPendingFile,
    decryptPendingFileWithDEK,
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
    resetState,
    clearError,
  };
});
