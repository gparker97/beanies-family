import { defineStore } from 'pinia';
import { ref, computed, watch, nextTick } from 'vue';

// Import other stores for auto-sync watching
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useActivityStore } from './activityStore';
import { useBudgetStore } from './budgetStore';
import { useTombstoneStore } from './tombstoneStore';
import { useSettingsStore, suppressSettingsWAL, resumeSettingsWAL } from './settingsStore';
import { useFamilyContextStore } from './familyContextStore';
import { useTransactionsStore } from './transactionsStore';
import { useSyncHighlightStore } from './syncHighlightStore';
import { saveSettings } from '@/services/indexeddb/repositories/settingsRepository';
import { invalidatePasskeysForPasswordChange } from '@/services/auth/passkeyService';
import {
  getSyncCapabilities,
  canAutoSync,
  supportsGoogleDrive,
} from '@/services/sync/capabilities';
import { exportToFile, importFromFile } from '@/services/sync/fileSync';
import { readSettingsWAL, clearSettingsWAL, isWALStale } from '@/services/sync/settingsWAL';
import * as registry from '@/services/registry/registryService';
import * as syncService from '@/services/sync/syncService';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import {
  loadGIS,
  requestAccessToken,
  onTokenExpired,
  isTokenValid,
  fetchGoogleUserEmail,
} from '@/services/google/googleAuth';
import {
  getOrCreateAppFolder,
  listBeanpodFiles,
  clearFolderCache,
  getAppFolderId,
  DriveApiError,
} from '@/services/google/driveService';
import { clearQueue } from '@/services/sync/offlineQueue';
import type { SyncFileData, PasskeySecret } from '@/types/models';
import type { StorageProviderType } from '@/services/sync/storageProvider';
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
    driveFileId?: string;
    driveFileName?: string;
    driveAccountEmail?: string;
  } | null>(null);

  // PRF-wrapped password secrets (stored in .beanpod envelope, outside encryption)
  const passkeySecrets = ref<PasskeySecret[]>([]);

  // Google Drive state
  const storageProviderType = ref<StorageProviderType | null>(null);
  const providerAccountEmail = ref<string | null>(null);
  const isGoogleDriveConnected = computed(() => storageProviderType.value === 'google_drive');
  const driveFileId = computed(() => syncService.getProvider()?.getFileId() ?? null);
  const driveFolderId = computed(() => getAppFolderId());
  const showGoogleReconnect = ref(false);
  const driveFileNotFound = ref(false);

  // Save failure state (mirrors syncService failure tracking)
  const saveFailureLevel = ref<'none' | 'warning' | 'critical'>('none');
  const lastSaveError = ref<string | null>(null);
  const showSaveFailureBanner = ref(false);

  // Capabilities
  const capabilities = computed(() => getSyncCapabilities());
  const supportsAutoSync = computed(() => canAutoSync());
  const isGoogleDriveAvailable = computed(() => supportsGoogleDrive());

  // Encryption computed
  const isEncryptionEnabled = computed(() => {
    const settingsStore = useSettingsStore();
    return settingsStore.settings.encryptionEnabled;
  });

  const hasSessionPassword = computed(() => sessionPassword.value !== null);
  const currentSessionPassword = computed(() => sessionPassword.value);

  const hasPendingEncryptedFile = computed(() => pendingEncryptedFile.value !== null);

  /**
   * Extract passkeySecrets from a raw sync file envelope (if present).
   * Called whenever a file is loaded, before decryption.
   */
  function extractPasskeySecrets(rawSyncData: SyncFileData | undefined): void {
    if (rawSyncData?.passkeySecrets && rawSyncData.passkeySecrets.length > 0) {
      passkeySecrets.value = rawSyncData.passkeySecrets;
      syncPasskeySecretsToService();
    }
  }

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
    storageProviderType.value = syncService.getProviderType();
    providerAccountEmail.value = syncService.getProvider()?.getAccountEmail() ?? null;
    error.value = state.lastError;
  });

  // Subscribe to save-complete to keep lastSync accurate without manual updates
  syncService.onSaveComplete((timestamp) => {
    lastSync.value = timestamp;
  });

  // Subscribe to save failure level changes for UI escalation
  syncService.onSaveFailureChange((level, failError) => {
    saveFailureLevel.value = level;
    lastSaveError.value = failError;
    if (level === 'critical') {
      showSaveFailureBanner.value = true;
    } else if (level === 'none') {
      showSaveFailureBanner.value = false;
    }
  });

  // Register encryption check callback so syncService can guard against plaintext writes
  syncService.setEncryptionRequiredCallback(() => isEncryptionEnabled.value);

  /**
   * Initialize sync - restore file handle if available.
   *
   * For local files: checks File System Access API permission (needs user gesture).
   * For Google Drive: attempts silent token re-acquisition. The `needsPermission`
   * flag is NOT set for Google Drive because token refresh happens automatically
   * inside read()/write() via getValidToken(). Setting it would cause loadFamilyData()
   * to skip the file-load path and fall to an IndexedDB cache fallback, potentially
   * loading stale or wrong-family data.
   */
  async function initialize(): Promise<void> {
    const restored = await syncService.initialize();

    if (restored) {
      const providerType = syncService.getProviderType();

      if (providerType === 'google_drive') {
        // Google Drive: don't set needsPermission — that flag is only for
        // local File System Access API permission grants (user gesture required).
        needsPermission.value = false;

        // Pre-load GIS library (non-interactive script load).
        // Do NOT call requestAccessToken() here — after a PWA force-close
        // sessionStorage is cleared and requestAccessToken() would trigger
        // Google's account chooser popup before the login screen renders.
        // Token acquisition happens on-demand in provider.read()/write().
        try {
          await loadGIS();
        } catch {
          console.warn('[syncStore] Failed to pre-load Google Identity Services');
        }
        // Only set up expiry handler if a valid token already exists
        // (e.g., normal page refresh within the same tab session)
        if (isTokenValid()) {
          setupTokenExpiryHandler();
        }
      } else {
        // Local file: check if we have File System Access API permission
        const hasPermission = await syncService.hasPermission();
        needsPermission.value = !hasPermission;
      }
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
      } else if (loadResult.needsPassword && loadResult.rawSyncData) {
        // File is encrypted — store for later decryption.
        // Do NOT set up auto-sync yet — we don't have the password,
        // and any store changes would trigger a plaintext write.
        // fileHandle may be undefined for Google Drive — use placeholder
        const provider = syncService.getProvider();
        pendingEncryptedFile.value = {
          fileHandle: loadResult.fileHandle ?? ({} as FileSystemFileHandle),
          rawSyncData: loadResult.rawSyncData,
          driveFileId: provider?.getFileId() ?? undefined,
          driveFileName: provider?.getDisplayName(),
          driveAccountEmail: provider?.getAccountEmail() ?? undefined,
        };
        extractPasskeySecrets(loadResult.rawSyncData);
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

    // Compare timestamps with 2-second tolerance to avoid false positives
    // from upload latency (file timestamp may lag slightly behind local save)
    const TOLERANCE_MS = 2000;
    const hasConflict =
      new Date(fileTimestamp).getTime() > new Date(localTimestamp).getTime() + TOLERANCE_MS;
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
      // lastSync is updated by the onSaveComplete callback
      await saveSettings({ lastSyncTimestamp: lastSync.value ?? undefined });
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
   * Load data from the currently configured sync file.
   * @param options.merge - If true, merge with local data instead of full replace.
   */
  async function loadFromFile(
    options: { merge?: boolean } = {}
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    const merging = !!options.merge;

    // When merging, suppress the auto-sync watcher BEFORE loadAndImport
    // so that tombstone mutations inside importSyncFileData don't trigger
    // a save with half-loaded state.
    if (merging) {
      isReloading = true;
      syncService.cancelPendingSave();
    }

    try {
      const result = await syncService.loadAndImport({ merge: options.merge });

      // If file needs password, store it for later decryption
      // fileHandle may be undefined for Google Drive — use placeholder (consistent with loadFromNewFile)
      if (result.needsPassword && result.rawSyncData) {
        const provider = syncService.getProvider();
        pendingEncryptedFile.value = {
          fileHandle: result.fileHandle ?? ({} as FileSystemFileHandle),
          rawSyncData: result.rawSyncData,
          driveFileId: provider?.getFileId() ?? undefined,
          driveFileName: provider?.getDisplayName(),
          driveAccountEmail: provider?.getAccountEmail() ?? undefined,
        };
        extractPasskeySecrets(result.rawSyncData);
        return { success: false, needsPassword: true };
      }

      if (result.success) {
        // Use the file's exportedAt (not new Date()) so that checkForConflicts
        // compares against the file's own timestamp. Using new Date() inflates
        // lastSync beyond the file timestamp, causing the 2-second tolerance
        // to mask subsequent saves from the other browser.
        lastSync.value = result.fileExportedAt ?? toISODateString(new Date());
        // Reload all stores after import (sets isReloading=true again, then false at end)
        await reloadAllStores();
        // Only save-back if merge produced data the file doesn't have.
        // This prevents the ping-pong echo loop where two devices each
        // create a "newer" timestamp that triggers the other to merge again.
        if (merging && result.hasLocalChanges) {
          syncService.triggerDebouncedSave();
        }
        // For Google Drive: set up token expiry handler now that we have a valid token
        if (syncService.getProviderType() === 'google_drive') {
          setupTokenExpiryHandler();
          // Update account email after fire-and-forget fetchGoogleUserEmail completes
          updateProviderEmailAfterLoad();
        }
        // Ensure auto-sync is armed after loading from file, regardless of caller.
        // setupAutoSync guards against double-setup internally.
        setupAutoSync();
      } else if (!result.needsPassword && syncService.getProviderType() === 'google_drive') {
        if (result.fileNotFound) {
          // File was deleted/moved on Drive — show file-not-found banner
          driveFileNotFound.value = true;
          showSaveFailureBanner.value = true;
          stopFilePolling();
        } else {
          // Google Drive read failed (e.g., expired token after force-close) —
          // show reconnect toast so user can re-authenticate when ready.
          showGoogleReconnect.value = true;
        }
      }
      return { success: result.success };
    } finally {
      // Safety reset for failure paths where reloadAllStores() wasn't called
      if (merging && isReloading) {
        isReloading = false;
      }
    }
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
      extractPasskeySecrets(result.rawSyncData);
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Reload all stores after import
      await reloadAllStores();

      // Update sync metadata — housekeeping only, don't bump updatedAt
      await saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

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
      extractPasskeySecrets(result.rawSyncData);
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      // Update sync metadata — housekeeping only, don't bump updatedAt
      await saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );
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

    const { fileHandle, rawSyncData, driveFileId, driveFileName, driveAccountEmail } =
      pendingEncryptedFile.value;
    const result = await syncService.decryptAndImport(fileHandle, rawSyncData, password);

    if (result.success) {
      // decryptAndImport may have adopted a new family identity at the DB level
      // (via createFamilyWithId) without updating the Pinia store. Sync them now
      // so that authStore.signIn() later captures the correct familyId in the session.
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      const activeFamilyId = getActiveFamilyId();
      const familyCtx = useFamilyContextStore();
      if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
        await familyCtx.switchFamily(activeFamilyId);
      }

      // If loaded from Google Drive, persist the config directly here.
      // We do this explicitly because the provider reference doesn't survive
      // Vue's reactive Proxy or LoginPage re-mounts that reset syncService.
      if (driveFileId && driveFileName) {
        const { storeProviderConfig, clearFileHandleForFamily } =
          await import('@/services/sync/fileHandleStore');
        if (activeFamilyId) {
          await clearFileHandleForFamily(activeFamilyId);
          await storeProviderConfig(activeFamilyId, {
            type: 'google_drive',
            driveFileId,
            driveFileName,
            driveAccountEmail,
          });
          console.warn('[syncStore] Persisted Google Drive config for family', activeFamilyId);
        }
        // Re-establish the Google Drive provider in syncService
        const provider = GoogleDriveProvider.fromExisting(
          driveFileId,
          driveFileName,
          driveAccountEmail
        );
        syncService.setProvider(provider);
      }

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
      // before any auto-sync watcher fires. Housekeeping — don't bump updatedAt.
      await saveSettings(
        {
          syncEnabled: true,
          encryptionEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

      // Cache password on trusted devices so it survives page refresh
      const settingsStore = useSettingsStore();
      if (familyCtx.activeFamilyId) {
        await settingsStore.cacheEncryptionPassword(password, familyCtx.activeFamilyId);
      }

      // Reload all stores after import
      await reloadAllStores();

      // Now that password is set and encryption is enabled, arm auto-sync
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

    // Re-save the file encrypted - pass password directly to ensure encryption happens
    const success = await syncService.save(password);
    if (success) {
      // lastSync is updated by the onSaveComplete callback
      await saveSettings({ lastSyncTimestamp: lastSync.value ?? undefined });
      // Cache password on trusted devices
      const familyContextStore = useFamilyContextStore();
      if (familyContextStore.activeFamilyId) {
        await settingsStore.cacheEncryptionPassword(password, familyContextStore.activeFamilyId);
      }

      // Update cached password in passkey registrations
      if (familyContextStore.activeFamilyId) {
        await invalidatePasskeysForPasswordChange(familyContextStore.activeFamilyId, password);
      }

      // Invalidate PRF-wrapped secrets — they're encrypted with the old password.
      // Devices with stale secrets will fall back to Level 1 (password entry).
      clearAllPasskeySecrets();
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
    // Clear session password and passkey secrets (no password = nothing to wrap)
    sessionPassword.value = null;
    syncService.setSessionPassword(null);
    clearAllPasskeySecrets();

    // Update settings in DB
    await saveSettings({ encryptionEnabled: false });

    // Also update the settings store
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    // Re-save the file unencrypted (no password = unencrypted)
    const success = await syncService.save(undefined);
    if (success) {
      // lastSync is updated by the onSaveComplete callback
      await saveSettings({ lastSyncTimestamp: lastSync.value ?? undefined });
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
    stopFilePolling();

    // Fire-and-forget: remove family from cloud registry before clearing state
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      clearSettingsWAL(ctx.activeFamilyId);
      registry.removeFamily(ctx.activeFamilyId).catch(() => {});
    }

    // Clear offline queue if disconnecting from Google Drive
    if (storageProviderType.value === 'google_drive') {
      clearQueue();
      clearFolderCache();
    }

    await syncService.disconnect();
    needsPermission.value = false;
    lastSync.value = null;
    sessionPassword.value = null;
    storageProviderType.value = null;
    providerAccountEmail.value = null;
    showGoogleReconnect.value = false;
    driveFileNotFound.value = false;
    syncService.setSessionPassword(null);

    // Clear cached encryption password for this family
    const settingsStore = useSettingsStore();
    await settingsStore.clearCachedEncryptionPassword(ctx.activeFamilyId ?? undefined);
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
    suppressSettingsWAL();
    syncService.cancelPendingSave();

    // Snapshot current IDs before reload so we can detect new/modified items
    const highlightStore = useSyncHighlightStore();
    if (isCrossDeviceReload) {
      highlightStore.snapshotBeforeReload();
    }

    try {
      const familyStore = useFamilyStore();
      const accountsStore = useAccountsStore();
      const transactionsStore = useTransactionsStore();
      const assetsStore = useAssetsStore();
      const goalsStore = useGoalsStore();
      const settingsStore = useSettingsStore();
      const recurringStore = useRecurringStore();
      const todoStore = useTodoStore();
      const activityStore = useActivityStore();
      const budgetStore = useBudgetStore();

      await Promise.all([
        familyStore.loadMembers(),
        accountsStore.loadAccounts(),
        transactionsStore.loadTransactions(),
        assetsStore.loadAssets(),
        goalsStore.loadGoals(),
        settingsStore.loadSettings(),
        recurringStore.loadRecurringItems(),
        todoStore.loadTodos(),
        activityStore.loadActivities(),
        budgetStore.loadBudgets(),
      ]);

      // WAL recovery: if there's a WAL entry newer than what the file had,
      // apply it so preferred currencies (etc.) survive refresh.
      await applySettingsWAL();
    } finally {
      resumeSettingsWAL();
      // Flush deferred watcher callbacks while isReloading is still true,
      // so the auto-sync watcher sees the guard and no-ops.
      await nextTick();
      isReloading = false;
    }

    // Detect which items are new/modified after stores have reloaded
    if (isCrossDeviceReload) {
      highlightStore.detectChanges();
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

  // File polling for cross-device sync detection
  const FILE_POLL_INTERVAL = 10_000; // 10 seconds
  let filePollingTimer: ReturnType<typeof setInterval> | null = null;
  let isCheckingFile = false;
  let isCrossDeviceReload = false;

  /**
   * Check if the sync file has been modified externally and reload if so.
   * Used by both visibility-change detection and background polling.
   * Returns true if data was reloaded.
   */
  async function reloadIfFileChanged(): Promise<boolean> {
    // Guards: skip if not ready, already checking, or mid-reload
    if (!isConfigured.value || needsPermission.value || isReloading || isCheckingFile) return false;

    isCheckingFile = true;
    try {
      const { hasConflict } = await checkForConflicts();
      if (!hasConflict) return false;

      // File is newer — cancel any pending local save to avoid overwriting
      // the newer remote data. Merge preserves unique records from both sides.
      syncService.cancelPendingSave();

      isCrossDeviceReload = true;
      try {
        const loadResult = await loadFromFile({ merge: true });
        if (loadResult.success) return true;

        // Handle encrypted file — try session password, then cached password.
        // Keep isCrossDeviceReload true so decryptPendingFile → reloadAllStores
        // correctly triggers sync highlight detection.
        if (loadResult.needsPassword) {
          // Try session password (set during initial sign-in)
          if (sessionPassword.value) {
            const result = await decryptPendingFile(sessionPassword.value);
            return result.success;
          }

          // Try cached password from trusted device
          const familyCtx = useFamilyContextStore();
          const settingsStore = useSettingsStore();
          const familyId = familyCtx.activeFamilyId;
          const cachedPw = familyId ? settingsStore.getCachedEncryptionPassword(familyId) : null;
          if (cachedPw) {
            const result = await decryptPendingFile(cachedPw);
            return result.success;
          }

          // Can't auto-decrypt — clear the pending file to avoid stale state
          pendingEncryptedFile.value = null;
        }

        return false;
      } finally {
        isCrossDeviceReload = false;
      }
    } catch (e) {
      // 404 from Drive — file was deleted/moved
      if (e instanceof DriveApiError && e.status === 404) {
        driveFileNotFound.value = true;
        showSaveFailureBanner.value = true;
        stopFilePolling();
        return false;
      }
      console.warn('[syncStore] reloadIfFileChanged failed:', e);
      return false;
    } finally {
      isCheckingFile = false;
    }
  }

  /**
   * Start polling the sync file for external changes (cross-device sync).
   * Polls every 10 seconds using the lightweight getFileTimestamp() check.
   * Safe to call multiple times — duplicate timers are prevented.
   */
  function startFilePolling(): void {
    if (filePollingTimer) return;
    filePollingTimer = setInterval(() => {
      reloadIfFileChanged().catch(console.warn);
    }, FILE_POLL_INTERVAL);
  }

  /**
   * Stop file polling (called on sign-out / disconnect).
   */
  function stopFilePolling(): void {
    if (filePollingTimer) {
      clearInterval(filePollingTimer);
      filePollingTimer = null;
    }
  }

  /**
   * Pause file polling while the tab is hidden to avoid wasted API calls.
   */
  function pauseFilePolling(): void {
    stopFilePolling();
  }

  /**
   * Resume file polling when the tab becomes visible again.
   */
  function resumeFilePolling(): void {
    if (isConfigured.value && !needsPermission.value && autoSyncStopHandle) {
      startFilePolling();
    }
  }

  /**
   * Setup auto-sync watchers for all data stores.
   * Auto-sync is always on when file is configured + has permission.
   * Safe to call multiple times — duplicate watchers are prevented.
   */
  function setupAutoSync(): void {
    if (!supportsAutoSync.value) return;

    // Guard: don't register a second watcher if one is already active
    if (autoSyncStopHandle) return;

    // Watch for changes in all data stores (including tombstones)
    autoSyncStopHandle = watch(
      () => [
        useFamilyStore().members,
        useAccountsStore().accounts,
        useTransactionsStore().transactions,
        useAssetsStore().assets,
        useGoalsStore().goals,
        useRecurringStore().recurringItems,
        useTodoStore().todos,
        useActivityStore().activities,
        useBudgetStore().budgets,
        useTombstoneStore().tombstones,
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

    // Start polling for external file changes (cross-device sync)
    startFilePolling();
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
    stopFilePolling();
    syncService.reset();
    useTombstoneStore().resetState();
    useSyncHighlightStore().clearHighlights();
    isInitialized.value = false;
    isConfigured.value = false;
    fileName.value = null;
    isSyncing.value = false;
    error.value = null;
    lastSync.value = null;
    needsPermission.value = false;
    sessionPassword.value = null;
    storageProviderType.value = null;
    providerAccountEmail.value = null;
    showGoogleReconnect.value = false;
    driveFileNotFound.value = false;
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;
    showSaveFailureBanner.value = false;
    pendingEncryptedFile.value = null;
    clearQueue();
  }

  /**
   * Clear any error state
   */
  function clearError(): void {
    error.value = null;
  }

  /**
   * Handle successful Google Drive reconnection.
   * Resets failure state, triggers an immediate save to flush pending data,
   * and reloads data from Drive.
   */
  async function handleGoogleReconnected(): Promise<void> {
    // If file was deleted/moved, reconnecting won't help — leave banner visible
    if (driveFileNotFound.value) {
      return;
    }

    showGoogleReconnect.value = false;
    showSaveFailureBanner.value = false;
    syncService.resetSaveFailures();
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;

    // Reload data from Drive and re-arm auto-sync
    await reloadIfFileChanged();
    setupAutoSync();

    // Flush any pending data to Drive immediately
    syncService.triggerDebouncedSave();
  }

  // --- Google Drive actions ---

  /**
   * Configure Google Drive as the storage backend for a new pod.
   * Creates a new .beanpod file on Google Drive.
   */
  async function configureSyncFileGoogleDrive(podFileName: string): Promise<boolean> {
    try {
      const provider = await GoogleDriveProvider.createNew(podFileName);
      syncService.setProvider(provider);

      // Persist provider config
      const ctx = useFamilyContextStore();
      if (ctx.activeFamilyId) {
        await provider.persist(ctx.activeFamilyId);
      }

      needsPermission.value = false;
      storageProviderType.value = 'google_drive';

      // Save initial data
      await syncNow();

      // Update settings — suppress auto-sync watcher during setup to avoid
      // redundant writes (auto-sync is armed later by the caller)
      isReloading = true;
      try {
        await saveSettings({
          syncEnabled: true,
          syncFilePath: provider.getDisplayName(),
          lastSyncTimestamp: toISODateString(new Date()),
        });
      } finally {
        isReloading = false;
      }

      // Register with cloud registry
      if (ctx.activeFamilyId) {
        registry
          .registerFamily(ctx.activeFamilyId, {
            provider: 'google_drive',
            fileId: provider.getFileId(),
            displayPath: provider.getDisplayName(),
            familyName: ctx.activeFamilyName,
          })
          .catch(() => {});
      }

      // Subscribe to token expiry
      setupTokenExpiryHandler();

      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  /**
   * Load an existing .beanpod file from Google Drive.
   */
  async function loadFromGoogleDrive(
    fileId: string,
    driveFileName: string
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    try {
      // Authenticate if needed
      await loadGIS();
      const token = await requestAccessToken();

      // Fetch account email before creating provider so it's available immediately
      await fetchGoogleUserEmail(token);

      const provider = GoogleDriveProvider.fromExisting(fileId, driveFileName);

      // Read file content
      const text = await provider.read();
      if (!text) {
        error.value = 'File is empty';
        return { success: false };
      }

      // Parse and validate
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        error.value = 'Invalid JSON file';
        return { success: false };
      }

      const obj = data as Record<string, unknown>;
      if (
        typeof obj.version !== 'string' ||
        typeof obj.exportedAt !== 'string' ||
        typeof obj.encrypted !== 'boolean'
      ) {
        error.value = 'Invalid sync file format';
        return { success: false };
      }

      // If encrypted, store for later decryption
      if (obj.encrypted === true) {
        pendingEncryptedFile.value = {
          fileHandle: {} as FileSystemFileHandle, // Placeholder — not used for Drive
          rawSyncData: data as SyncFileData,
          driveFileId: fileId,
          driveFileName,
          driveAccountEmail: provider.getAccountEmail() ?? undefined,
        };
        extractPasskeySecrets(data as SyncFileData);
        storageProviderType.value = 'google_drive';
        return { success: false, needsPassword: true };
      }

      // Import unencrypted data
      const { importSyncFileData, validateSyncFileData } = await import('@/services/sync/fileSync');
      if (!validateSyncFileData(data)) {
        error.value = 'Invalid sync file format';
        return { success: false };
      }

      const syncData = data as SyncFileData;

      // Adopt family identity
      const { createFamilyWithId } = await import('@/services/familyContext');
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      let activeFamilyId = getActiveFamilyId();
      if (syncData.familyId) {
        if (syncData.familyId !== activeFamilyId) {
          await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
          activeFamilyId = syncData.familyId;
        }
      }

      await importSyncFileData(syncData);

      // Set as current provider
      syncService.setProvider(provider);
      storageProviderType.value = 'google_drive';
      if (activeFamilyId) {
        await provider.persist(activeFamilyId);
      }

      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Reload stores and setup auto-sync
      await reloadAllStores();
      await saveSettings({
        syncEnabled: true,
        syncFilePath: provider.getDisplayName(),
        lastSyncTimestamp: lastSync.value ?? undefined,
      });
      setupAutoSync();
      setupTokenExpiryHandler();

      // Register with cloud registry
      if (activeFamilyId) {
        registry
          .registerFamily(activeFamilyId, {
            provider: 'google_drive',
            fileId,
            displayPath: driveFileName,
            familyName: syncData.familyName,
          })
          .catch(() => {});
      }

      return { success: true };
    } catch (e) {
      error.value = (e as Error).message;
      return { success: false };
    }
  }

  /**
   * List .beanpod files available on Google Drive.
   * Auto-retries once with cleared folder cache if the first attempt returns empty.
   * @param options.forceNewAccount - When true, forces Google's account chooser
   */
  async function listGoogleDriveFiles(options?: {
    forceNewAccount?: boolean;
  }): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
    await loadGIS();
    const token = await requestAccessToken({
      forceConsent: options?.forceNewAccount,
    });
    const folderId = await getOrCreateAppFolder(token);
    const files = await listBeanpodFiles(token, folderId);

    if (files.length > 0) return files;

    // First attempt returned empty — clear folder cache and retry once
    // (listBeanpodFiles already tried Drive-wide fallback, so this retries
    // the entire folder discovery from scratch)
    console.warn('[syncStore] No files found, retrying with cleared folder cache...');
    clearFolderCache();
    const retryFolderId = await getOrCreateAppFolder(token);
    return listBeanpodFiles(token, retryFolderId);
  }

  /**
   * Subscribe to Google OAuth token expiry notifications.
   */
  let tokenExpiryUnsub: (() => void) | null = null;

  /**
   * After a Google Drive load, the email fetch is fire-and-forget.
   * Poll briefly for the email to become available, then update refs and re-persist.
   */
  function updateProviderEmailAfterLoad(): void {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const provider = syncService.getProvider();
      if (provider instanceof GoogleDriveProvider && provider.updateAccountEmailIfAvailable()) {
        providerAccountEmail.value = provider.getAccountEmail();
        const ctx = useFamilyContextStore();
        if (ctx.activeFamilyId) {
          await provider.persist(ctx.activeFamilyId);
        }
        clearInterval(interval);
      } else if (attempts >= 10) {
        clearInterval(interval);
      }
    }, 500);
  }

  function setupTokenExpiryHandler(): void {
    if (tokenExpiryUnsub) return;
    tokenExpiryUnsub = onTokenExpired(() => {
      if (storageProviderType.value === 'google_drive') {
        showGoogleReconnect.value = true;
      }
    });
  }

  // --- Passkey secret management ---

  function syncPasskeySecretsToService(): void {
    syncService.setPasskeySecrets(passkeySecrets.value);
  }

  function addPasskeySecret(secret: PasskeySecret): void {
    // Replace existing secret for same credentialId
    passkeySecrets.value = [
      ...passkeySecrets.value.filter((s) => s.credentialId !== secret.credentialId),
      secret,
    ];
    syncPasskeySecretsToService();
  }

  function removePasskeySecretsForCredential(credentialId: string): void {
    passkeySecrets.value = passkeySecrets.value.filter((s) => s.credentialId !== credentialId);
    syncPasskeySecretsToService();
  }

  function clearAllPasskeySecrets(): void {
    passkeySecrets.value = [];
    syncPasskeySecretsToService();
  }

  /**
   * Ensure the current family is registered in the cloud registry.
   * Idempotent PUT — safe to call on every sign-in. Fire-and-forget.
   */
  function ensureRegistered(): void {
    const ctx = useFamilyContextStore();
    if (!ctx.activeFamilyId) return;
    const provider = syncService.getProvider();
    registry
      .registerFamily(ctx.activeFamilyId, {
        provider: storageProviderType.value ?? 'local',
        fileId: provider?.getFileId() ?? undefined,
        displayPath: provider?.getDisplayName() ?? fileName.value,
        familyName: ctx.activeFamilyName,
      })
      .catch(() => {});
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
    hasPendingEncryptedFile,
    storageProviderType,
    providerAccountEmail,
    isGoogleDriveConnected,
    driveFileId,
    driveFolderId,
    isGoogleDriveAvailable,
    showGoogleReconnect,
    driveFileNotFound,
    saveFailureLevel,
    lastSaveError,
    showSaveFailureBanner,
    // Actions
    initialize,
    requestPermission,
    configureSyncFile,
    configureSyncFileGoogleDrive,
    syncNow,
    forceSyncNow,
    checkForConflicts,
    loadFromFile,
    loadFromNewFile,
    loadFromDroppedFile,
    loadFromGoogleDrive,
    listGoogleDriveFiles,
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
    reloadIfFileChanged,
    handleGoogleReconnected,
    pauseFilePolling,
    resumeFilePolling,
    resetState,
    clearError,
    ensureRegistered,
    // Passkey secrets
    passkeySecrets,
    addPasskeySecret,
    removePasskeySecretsForCredential,
    clearAllPasskeySecrets,
  };
});
