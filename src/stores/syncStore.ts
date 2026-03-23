import { defineStore } from 'pinia';
import { ref, computed, shallowRef, nextTick } from 'vue';

// Import stores for auto-sync and reload
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useActivityStore } from './activityStore';
import { useVacationStore } from './vacationStore';
import { useBudgetStore } from './budgetStore';
import { useSettingsStore } from './settingsStore';
import { useFamilyContextStore } from './familyContextStore';
import { useTransactionsStore } from './transactionsStore';
import { useSyncHighlightStore } from './syncHighlightStore';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import {
  getSyncCapabilities,
  canAutoSync,
  supportsGoogleDrive,
} from '@/services/sync/capabilities';
import { downloadAsFile } from '@/services/sync/fileSync';
import * as registry from '@/services/registry/registryService';
import * as syncService from '@/services/sync/syncService';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import {
  initializeAuth,
  migratePendingRefreshToken,
  requestAccessToken,
  onTokenExpired,
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
import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  decryptBeanpodPayload,
  reEncryptEnvelope,
  detectFileVersion,
} from '@/services/sync/fileSync';
import {
  generateFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import { replaceDoc, mergeDoc } from '@/services/automerge/docService';
import {
  initPersistenceDB,
  persistDoc,
  persistEnvelope,
  loadCachedDoc,
  loadCachedEnvelope,
} from '@/services/automerge/persistenceService';
import { bufferToBase64 } from '@/utils/encoding';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';
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

  // Family key state — the unwrapped AES-GCM key for the active .beanpod envelope
  const familyKey = shallowRef<CryptoKey | null>(null);
  const envelope = shallowRef<BeanpodFileV4 | null>(null);

  // Pending encrypted file — V4 envelope that needs password to unlock
  const pendingEncryptedFile = ref<{
    envelope: BeanpodFileV4;
    fileHandle?: FileSystemFileHandle;
    provider?: import('@/services/sync/storageProvider').StorageProvider;
    driveFileId?: string;
    driveFileName?: string;
    driveAccountEmail?: string;
  } | null>(null);

  // Google Drive state
  const storageProviderType = ref<StorageProviderType | null>(null);
  const providerAccountEmail = ref<string | null>(null);
  const isGoogleDriveConnected = computed(() => storageProviderType.value === 'google_drive');
  const driveFileId = computed(() => syncService.getProvider()?.getFileId() ?? null);
  const driveFolderId = computed(() => getAppFolderId());
  const showGoogleReconnect = ref(false);
  const driveFileNotFound = ref(false);

  // Save failure state
  const saveFailureLevel = ref<'none' | 'warning' | 'critical'>('none');
  const lastSaveError = ref<string | null>(null);
  const showSaveFailureBanner = ref(false);

  // Capabilities
  const capabilities = computed(() => getSyncCapabilities());
  const supportsAutoSync = computed(() => canAutoSync());
  const isGoogleDriveAvailable = computed(() => supportsGoogleDrive());

  // Encryption is always on in V4 — backward compat computed
  const hasSessionPassword = computed(() => familyKey.value !== null);
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
    storageProviderType.value = syncService.getProviderType();
    providerAccountEmail.value = syncService.getProvider()?.getAccountEmail() ?? null;
    error.value = state.lastError;
  });

  // Subscribe to save-complete
  syncService.onSaveComplete((timestamp) => {
    lastSync.value = timestamp;
  });

  // Subscribe to save failure level changes
  syncService.onSaveFailureChange((level, failError) => {
    saveFailureLevel.value = level;
    lastSaveError.value = failError;
    if (level === 'critical') {
      showSaveFailureBanner.value = true;
    } else if (level === 'none') {
      showSaveFailureBanner.value = false;
    }
  });

  // Subscribe to cache persistence failure changes
  const cachePersistFailed = ref(false);
  syncService.onCacheFailureChange((failed) => {
    cachePersistFailed.value = failed;
  });

  // Register docService persist callback → triggers debounced save
  syncService.registerDocPersistCallback();

  /**
   * Initialize sync - restore file handle if available.
   */
  async function initialize(): Promise<void> {
    const restored = await syncService.initialize();

    if (restored) {
      const providerType = syncService.getProviderType();

      if (providerType === 'google_drive') {
        needsPermission.value = false;
        try {
          const ctx = useFamilyContextStore();
          if (ctx.activeFamilyId) {
            await initializeAuth(ctx.activeFamilyId);
          }
        } catch {
          console.warn('[syncStore] Failed to initialize Google auth');
        }
        setupTokenExpiryHandler();
      } else {
        const hasPermission = await syncService.hasPermission();
        needsPermission.value = !hasPermission;
      }
    }
  }

  /**
   * Request permission to access the sync file (user gesture required).
   * If permission is granted, automatically loads from file and sets up auto-sync.
   */
  async function requestPermission(): Promise<boolean> {
    const granted = await syncService.requestPermission();
    needsPermission.value = !granted;

    if (granted) {
      const loadResult = await loadFromFile();
      if (loadResult.success) {
        setupAutoSync();
      }
    }

    return granted;
  }

  /**
   * Configure a sync file (opens file picker).
   * Creates a new V4 file with the current family key.
   */
  async function configureSyncFile(): Promise<boolean> {
    const success = await syncService.selectSyncFile();
    if (success) {
      needsPermission.value = false;
      await syncNow();
      await settingsRepo.saveSettings({
        syncEnabled: true,
        syncFilePath: fileName.value ?? undefined,
        lastSyncTimestamp: toISODateString(new Date()),
      });
      setupAutoSync();
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
   */
  async function checkForConflicts(): Promise<{
    hasConflict: boolean;
    fileTimestamp: string | null;
    localTimestamp: string | null;
  }> {
    const fileTimestamp = await syncService.getFileTimestamp();
    const localTimestamp = lastSync.value;

    if (!fileTimestamp) {
      return { hasConflict: false, fileTimestamp: null, localTimestamp };
    }

    if (!localTimestamp) {
      return { hasConflict: true, fileTimestamp, localTimestamp: null };
    }

    const hasConflict = new Date(fileTimestamp).getTime() > new Date(localTimestamp).getTime();
    return { hasConflict, fileTimestamp, localTimestamp };
  }

  /**
   * Sync now - save current data to file
   */
  async function syncNow(force = false): Promise<boolean> {
    if (!force) {
      const { hasConflict } = await checkForConflicts();
      if (hasConflict) {
        error.value = 'File has newer data. Load from file first or force sync.';
        return false;
      }
    }

    const success = await syncService.save();
    if (success) {
      await settingsRepo.saveSettings(
        { lastSyncTimestamp: lastSync.value ?? undefined },
        { preserveTimestamp: true }
      );
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
   * Replace the in-memory doc with a remote doc, merging any unsynced
   * changes from the local IndexedDB cache to prevent data loss.
   *
   * If the cache has changes not present in the remote doc (e.g. the
   * previous save to Drive failed), Automerge CRDT merge preserves both.
   * If the cache matches the remote, the merge is a no-op.
   */
  async function replaceDocWithCacheRecovery(
    remoteDoc: Parameters<typeof replaceDoc>[0],
    fk: CryptoKey,
    familyId: string
  ): Promise<void> {
    await initPersistenceDB(familyId);

    let cachedDoc: Awaited<ReturnType<typeof loadCachedDoc>> = null;
    try {
      cachedDoc = await loadCachedDoc(fk);
    } catch (e) {
      console.warn('[syncStore] Cache recovery failed — proceeding with remote only:', e);
    }

    replaceDoc(remoteDoc);

    if (cachedDoc) {
      mergeDoc(cachedDoc);
      // Persist merged result so the cache reflects the merge
      persistDoc(fk).catch(console.warn);
      // Save merged result back to remote file (debounced)
      syncService.triggerDebouncedSave();
    }
  }

  /**
   * Load data from the currently configured sync file.
   * For V4 files: parses envelope, tries to unlock with cached FK or password.
   * @param options.merge - If true, CRDT merge remote doc with local doc.
   */
  async function loadFromFile(
    options: { merge?: boolean } = {}
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    const merging = !!options.merge;

    if (merging) {
      isReloading = true;
      syncService.cancelPendingSave();
    }

    try {
      console.log('[syncStore.loadFromFile] calling syncService.load()...');
      const text = await syncService.load();
      console.log('[syncStore.loadFromFile] load returned', text ? `${text.length} chars` : 'null');
      if (!text) {
        const lastError = syncService.getState().lastError;
        if (lastError?.startsWith('DriveApiError:404:')) {
          if (syncService.getProviderType() === 'google_drive') {
            driveFileNotFound.value = true;
            showSaveFailureBanner.value = true;
            stopFilePolling();
          }
          return { success: false };
        }
        if (!text && syncService.getProviderType() === 'google_drive') {
          showGoogleReconnect.value = true;
        }
        return { success: false };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false };
      }

      const remoteEnvelope = parseBeanpodV4(text);

      // If we already have a family key, try to decrypt directly
      if (familyKey.value) {
        try {
          const remoteDoc = await decryptBeanpodPayload(remoteEnvelope, familyKey.value);

          if (merging) {
            // CRDT merge
            mergeDoc(remoteDoc);
          } else {
            // Replace local doc, merging any unsynced cache to prevent data loss
            const famId = useFamilyContextStore().activeFamilyId;
            if (famId && familyKey.value) {
              await replaceDocWithCacheRecovery(remoteDoc, familyKey.value, famId);
            } else {
              replaceDoc(remoteDoc);
            }
          }

          // Update envelope and ensure syncService has the family key
          envelope.value = remoteEnvelope;
          syncService.setFamilyKey(familyKey.value!, remoteEnvelope);

          // Prevent next doSave() from re-fetching what we just loaded
          const loadedTs = await syncService.getFileTimestamp();
          if (loadedTs) syncService.setLastKnownFileTimestamp(loadedTs);

          lastSync.value = toISODateString(new Date());
          await reloadAllStores();

          if (merging) {
            // After merge, save back to persist our local changes
            syncService.triggerDebouncedSave();
          }

          if (syncService.getProviderType() === 'google_drive') {
            setupTokenExpiryHandler();
            updateProviderEmailAfterLoad();
          }

          setupAutoSync();
          return { success: true };
        } catch (e) {
          console.warn('[syncStore] Failed to decrypt with current FK, may need re-auth:', e);
        }
      }

      // No family key or decryption failed — store as pending
      const provider = syncService.getProvider();
      pendingEncryptedFile.value = {
        envelope: remoteEnvelope,
        driveFileId: provider?.getFileId() ?? undefined,
        driveFileName: provider?.getDisplayName(),
        driveAccountEmail: provider?.getAccountEmail() ?? undefined,
      };
      return { success: false, needsPassword: true };
    } finally {
      if (merging && isReloading) {
        isReloading = false;
      }
    }
  }

  /**
   * Open file picker to select a new file, load its data, and set it as sync target.
   */
  async function loadFromNewFile(): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.openAndLoadFile();

    if (result.needsPassword && result.envelope) {
      pendingEncryptedFile.value = {
        envelope: result.envelope,
        fileHandle: result.fileHandle,
        provider: result.provider,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );
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

    if (result.needsPassword && result.envelope) {
      pendingEncryptedFile.value = {
        envelope: result.envelope,
        fileHandle: result.fileHandle,
        provider: result.provider,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );
      setupAutoSync();
    }
    return { success: result.success };
  }

  /**
   * Unlock a pending encrypted file with a password.
   * This is the V4 equivalent of decryptPendingFile.
   *
   * The password is used to derive a member wrapping key, which unwraps the
   * family key. The family key then decrypts the Automerge binary payload.
   */
  async function decryptPendingFile(
    password: string
  ): Promise<{ success: boolean; error?: string; memberId?: string }> {
    const pending = pendingEncryptedFile.value;
    if (!pending) {
      return { success: false, error: 'No pending encrypted file' };
    }

    try {
      // Try to unwrap the family key using the password
      const { familyKey: fk, memberId } = await tryUnwrapFamilyKey(pending.envelope, password);

      // Decrypt the Automerge payload
      const doc = await decryptBeanpodPayload(pending.envelope, fk);

      // Replace doc with cache recovery to prevent data loss from failed saves
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(doc, fk, famId);
      } else {
        replaceDoc(doc);
      }

      // Set the family key and envelope
      familyKey.value = fk;
      envelope.value = pending.envelope;
      syncService.setFamilyKey(fk, pending.envelope);

      // Adopt family identity — ensure the file's family is registered and active
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      let activeFamilyId = getActiveFamilyId();
      const familyCtx = useFamilyContextStore();
      const fileFamilyId = pending.envelope.familyId;

      if (fileFamilyId) {
        // Register the family if it's not yet in the local registry
        const isKnown = familyCtx.allFamilies.some((f) => f.id === fileFamilyId);
        if (!isKnown) {
          await familyCtx.createFamilyWithId(
            fileFamilyId,
            pending.envelope.familyName ?? 'My Family'
          );
        } else if (fileFamilyId !== familyCtx.activeFamilyId) {
          await familyCtx.switchFamily(fileFamilyId);
        }
        activeFamilyId = fileFamilyId;
      } else if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
        await familyCtx.switchFamily(activeFamilyId);
      }

      // Bind Google Auth to this family and migrate any pending refresh token
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
        await migratePendingRefreshToken(activeFamilyId);
      }

      // If loaded from Google Drive, persist the config
      if (pending.driveFileId && pending.driveFileName) {
        const { storeProviderConfig, clearFileHandleForFamily } =
          await import('@/services/sync/fileHandleStore');
        if (activeFamilyId) {
          await clearFileHandleForFamily(activeFamilyId);
          await storeProviderConfig(activeFamilyId, {
            type: 'google_drive',
            driveFileId: pending.driveFileId,
            driveFileName: pending.driveFileName,
            driveAccountEmail: pending.driveAccountEmail,
          });
        }
        const provider = GoogleDriveProvider.fromExisting(
          pending.driveFileId,
          pending.driveFileName,
          pending.driveAccountEmail
        );
        syncService.setProvider(provider);
      }

      // If file was opened with a provider (local file picker), persist it
      if (pending.provider) {
        if (activeFamilyId) {
          await pending.provider.persist(activeFamilyId);
        }
        syncService.setProvider(pending.provider);
      }

      // Clear pending
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Initialize persistence cache (doc + envelope)
      if (familyCtx.activeFamilyId) {
        await initPersistenceDB(familyCtx.activeFamilyId);
        persistDoc(fk).catch(console.warn);
        persistEnvelope(pending.envelope).catch(console.warn);
      }

      // Update settings
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          encryptionEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

      // Cache exported family key so auto-decrypt works after page refresh.
      // Force-cache when decrypting a pending file (user entered password on this device).
      const settingsStore = useSettingsStore();
      if (familyCtx.activeFamilyId && fk) {
        const exported = await getExportedFamilyKey();
        if (exported) {
          await settingsStore.cacheFamilyKey(exported, familyCtx.activeFamilyId, { force: true });
        }
      }

      // Reload all stores
      await reloadAllStores();

      // Arm auto-sync
      setupAutoSync();

      return { success: true, memberId };
    } catch (e) {
      const errorMessage = (e as Error).message;
      if (errorMessage.includes('Incorrect password')) {
        return { success: false, error: 'Incorrect password' };
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Load data from the local persistence cache (IndexedDB).
   * Used as a fallback when the beanpod file needs permission on page refresh.
   * Imports the family key directly from a base64-encoded raw key.
   */
  async function loadFromPersistenceCache(
    keyB64: string,
    activeFamilyId: string
  ): Promise<{ success: boolean }> {
    try {
      await initPersistenceDB(activeFamilyId);

      // Load cached envelope (needed for syncService.setFamilyKey)
      const cachedEnvelope = await loadCachedEnvelope();
      if (!cachedEnvelope) return { success: false };

      // Import family key directly from base64 (not password-derived)
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));

      // Load cached Automerge doc
      const doc = await loadCachedDoc(fk);
      if (!doc) return { success: false };

      // Set up state
      replaceDoc(doc);
      familyKey.value = fk;
      envelope.value = cachedEnvelope;
      syncService.setFamilyKey(fk, cachedEnvelope);
      isConfigured.value = true; // Data is loaded — show configured UI
      needsPermission.value = true; // Still need file permission for future saves
      lastSync.value = toISODateString(new Date());

      await reloadAllStores();
      return { success: true };
    } catch (e) {
      console.warn('[syncStore] loadFromPersistenceCache failed:', e);
      return { success: false };
    }
  }

  /**
   * Clear the pending encrypted file (user cancelled)
   */
  function clearPendingEncryptedFile(): void {
    pendingEncryptedFile.value = null;
  }

  /**
   * Create a new V4 beanpod file.
   * Called by CreatePodView when setting up a new family.
   */
  async function createNewFile(
    _podFileName: string,
    password: string,
    memberId: string,
    familyId: string,
    familyName: string
  ): Promise<boolean> {
    try {
      // 1. Generate family key
      const fk = await generateFamilyKey();

      // 2. Derive member wrapping key from password
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const memberKey = await deriveMemberKey(password, salt);

      // 3. Wrap the family key
      const wrapped = await wrapFamilyKey(fk, memberKey);

      // 4. Build wrappedKeys record
      const wrappedKeys: Record<string, WrappedMemberKey> = {
        [memberId]: {
          salt: bufferToBase64(salt),
          wrapped,
        },
      };

      // 5. Automerge doc is already initialized by authStore.signUp() (which calls
      // initDoc before creating the owner member). Do NOT call initDoc() here —
      // it would wipe the member data already written to the doc.

      // 6. Create V4 envelope
      const envelopeJson = await createBeanpodV4(familyId, familyName, fk, wrappedKeys);

      // 7. Write to provider
      const provider = syncService.getProvider();
      if (provider) {
        await provider.write(envelopeJson);
      }

      // 8. Set state
      const env = parseBeanpodV4(envelopeJson);
      familyKey.value = fk;
      envelope.value = env;
      syncService.setFamilyKey(fk, env);

      // 9. Initialize persistence cache (doc + envelope)
      await initPersistenceDB(familyId);
      persistDoc(fk).catch(console.warn);
      persistEnvelope(env).catch(console.warn);

      lastSync.value = toISODateString(new Date());

      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  /**
   * Clear session key material
   */
  function clearSessionPassword(): void {
    familyKey.value = null;
    envelope.value = null;
  }

  /**
   * Export the current family key as base64 string.
   * Used for trusted device caching and passkey registration.
   */
  async function getExportedFamilyKey(): Promise<string | null> {
    if (!familyKey.value) return null;
    const { exportFamilyKey } = await import('@/services/crypto/familyKeyService');
    const { bufferToBase64 } = await import('@/utils/encoding');
    const raw = await exportFamilyKey(familyKey.value);
    return bufferToBase64(raw);
  }

  /**
   * Decrypt a pending file using a pre-obtained family key (skips password derivation).
   * Used by passkey/biometric flows that already have the family key.
   */
  async function decryptPendingFileWithKey(
    fk: CryptoKey
  ): Promise<{ success: boolean; error?: string }> {
    const pending = pendingEncryptedFile.value;
    if (!pending) return { success: false, error: 'No pending file' };

    try {
      // Decrypt the Automerge payload with the family key
      const doc = await decryptBeanpodPayload(pending.envelope, fk);

      // Replace doc with cache recovery to prevent data loss from failed saves
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(doc, fk, famId);
      } else {
        replaceDoc(doc);
      }

      familyKey.value = fk;
      envelope.value = pending.envelope;
      syncService.setFamilyKey(fk, pending.envelope);
      isConfigured.value = true;

      // Adopt family identity — ensure the file's family is registered and active
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      let activeFamilyId = getActiveFamilyId();
      const familyCtx = useFamilyContextStore();
      const fileFamilyId = pending.envelope.familyId;

      if (fileFamilyId) {
        // Register the family if it's not yet in the local registry
        const isKnown = familyCtx.allFamilies.some((f) => f.id === fileFamilyId);
        if (!isKnown) {
          await familyCtx.createFamilyWithId(
            fileFamilyId,
            pending.envelope.familyName ?? 'My Family'
          );
        } else if (fileFamilyId !== familyCtx.activeFamilyId) {
          await familyCtx.switchFamily(fileFamilyId);
        }
        activeFamilyId = fileFamilyId;
      } else if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
        await familyCtx.switchFamily(activeFamilyId);
      }

      // Bind Google Auth to this family and migrate any pending refresh token
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
        await migratePendingRefreshToken(activeFamilyId);
      }

      // If loaded from Google Drive, persist the config
      if (pending.driveFileId && pending.driveFileName) {
        const { storeProviderConfig, clearFileHandleForFamily } =
          await import('@/services/sync/fileHandleStore');
        if (activeFamilyId) {
          await clearFileHandleForFamily(activeFamilyId);
          await storeProviderConfig(activeFamilyId, {
            type: 'google_drive',
            driveFileId: pending.driveFileId,
            driveFileName: pending.driveFileName,
            driveAccountEmail: pending.driveAccountEmail,
          });
        }
        const provider = GoogleDriveProvider.fromExisting(
          pending.driveFileId,
          pending.driveFileName,
          pending.driveAccountEmail
        );
        syncService.setProvider(provider);
      }

      // If file was opened with a provider (local file picker), persist it
      if (pending.provider) {
        if (activeFamilyId) {
          await pending.provider.persist(activeFamilyId);
        }
        syncService.setProvider(pending.provider);
      }

      // Clear pending
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Initialize persistence cache
      if (familyCtx.activeFamilyId) {
        await initPersistenceDB(familyCtx.activeFamilyId);
        persistDoc(fk).catch(console.warn);
        persistEnvelope(pending.envelope).catch(console.warn);
      }

      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          encryptionEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

      // Cache exported family key so auto-decrypt works after page refresh.
      // Force-cache during join/decrypt flow (driveFileId present) since the user
      // just created a password on this device — it's clearly their personal device.
      const settingsStore = useSettingsStore();
      if (familyCtx.activeFamilyId) {
        const exported = await getExportedFamilyKey();
        if (exported) {
          const forceCache = !!pending.driveFileId || !!pending.provider;
          await settingsStore.cacheFamilyKey(exported, familyCtx.activeFamilyId, {
            force: forceCache,
          });
        }
      }

      await reloadAllStores();
      setupAutoSync();

      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * Derive a wrapping key from a password and wrap the family key for a member.
   * Adds the wrappedKey entry to the envelope so the member can decrypt from any browser/device.
   */
  async function wrapFamilyKeyForMember(memberId: string, password: string): Promise<void> {
    if (!familyKey.value) throw new Error('No family key loaded');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const memberKey = await deriveMemberKey(password, salt);
    const wrapped = await wrapFamilyKey(familyKey.value, memberKey);
    const { bufferToBase64 } = await import('@/utils/encoding');
    await addMemberWrappedKey(memberId, {
      wrapped,
      salt: bufferToBase64(salt),
    });
  }

  /**
   * Add a wrapped key entry to the envelope for a new member (joinFamily flow).
   */
  async function addMemberWrappedKey(
    memberId: string,
    wrappedKey: { wrapped: string; salt: string }
  ): Promise<void> {
    if (!envelope.value) throw new Error('No envelope loaded');
    const env = { ...envelope.value };
    env.wrappedKeys = {
      ...env.wrappedKeys,
      [memberId]: { wrapped: wrappedKey.wrapped, salt: wrappedKey.salt },
    };
    envelope.value = env;
    syncService.setEnvelope(env);

    // Persist updated envelope
    if (familyKey.value) {
      persistEnvelope(env).catch(console.warn);
    }
  }

  /**
   * Add an invite key package to the envelope and persist.
   * Returns the token hash (storage key) so the caller can verify storage.
   */
  async function addInvitePackage(
    tokenHash: string,
    pkg: { salt: string; wrapped: string; expiresAt: string }
  ): Promise<void> {
    if (!envelope.value) throw new Error('No envelope loaded');
    const env = { ...envelope.value };
    env.inviteKeys = {
      ...env.inviteKeys,
      [tokenHash]: { salt: pkg.salt, wrapped: pkg.wrapped, expiresAt: pkg.expiresAt },
    };
    envelope.value = env;
    syncService.setEnvelope(env);

    console.warn(
      '[syncStore] addInvitePackage: added key',
      tokenHash.slice(0, 8) + '...',
      'inviteKeys count:',
      Object.keys(env.inviteKeys).length
    );

    // Persist updated envelope and sync
    if (familyKey.value) {
      persistEnvelope(env).catch(console.warn);
    }
    const saved = await syncNow(true);
    if (!saved) {
      console.error(
        '[syncStore] addInvitePackage: syncNow failed — invite key may not be on Drive'
      );
    }
  }

  /**
   * Disconnect from sync file
   */
  async function disconnect(): Promise<void> {
    stopFilePolling();

    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      registry.removeFamily(ctx.activeFamilyId).catch(() => {});
    }

    if (storageProviderType.value === 'google_drive') {
      clearQueue();
      clearFolderCache();
    }

    await syncService.disconnect();
    needsPermission.value = false;
    lastSync.value = null;
    familyKey.value = null;
    envelope.value = null;
    storageProviderType.value = null;
    providerAccountEmail.value = null;
    showGoogleReconnect.value = false;
    driveFileNotFound.value = false;

    const settingsStore = useSettingsStore();
    await settingsStore.clearCachedFamilyKey(ctx.activeFamilyId ?? undefined);
    await settingsRepo.saveSettings({
      syncEnabled: false,
      syncFilePath: undefined,
      lastSyncTimestamp: undefined,
    });
  }

  /**
   * Manual export (fallback for browsers without File System Access API)
   */
  async function manualExport(): Promise<void> {
    if (!familyKey.value || !envelope.value) {
      error.value = 'No family key — cannot export';
      return;
    }
    const envelopeJson = await reEncryptEnvelope(envelope.value, familyKey.value);
    downloadAsFile(envelopeJson);
    lastSync.value = toISODateString(new Date());
  }

  /**
   * Manual import — opens picker, validates V4, prompts for password
   */
  async function manualImport(): Promise<{ success: boolean; error?: string }> {
    const result = await loadFromNewFile();
    if (result.needsPassword) {
      return { success: false, error: 'Encrypted file requires password' };
    }
    return { success: result.success };
  }

  // Guard: suppress auto-sync during store reloads
  let isReloading = false;

  /**
   * Reload all stores from the in-memory Automerge document.
   */
  async function reloadAllStores(): Promise<void> {
    isReloading = true;
    syncService.cancelPendingSave();

    const highlightStore = useSyncHighlightStore();
    if (isCrossDeviceReload) {
      highlightStore.snapshotBeforeReload();
    }

    try {
      const familyStoreInst = useFamilyStore();
      const accountsStore = useAccountsStore();
      const transactionsStore = useTransactionsStore();
      const assetsStore = useAssetsStore();
      const goalsStore = useGoalsStore();
      const settingsStore = useSettingsStore();
      const recurringStore = useRecurringStore();
      const todoStore = useTodoStore();
      const activityStore = useActivityStore();
      const vacationStore = useVacationStore();
      const budgetStore = useBudgetStore();

      // Snapshot permission state before reload for diagnostics
      const prevMember = familyStoreInst.currentMember;
      const prevMemberId = familyStoreInst.currentMemberId;

      await Promise.all([
        familyStoreInst.loadMembers(),
        accountsStore.loadAccounts(),
        transactionsStore.loadTransactions(),
        assetsStore.loadAssets(),
        goalsStore.loadGoals(),
        settingsStore.loadSettings(),
        recurringStore.loadRecurringItems(),
        todoStore.loadTodos(),
        activityStore.loadActivities(),
        vacationStore.loadVacations(),
        budgetStore.loadBudgets(),
      ]);

      // Diagnostic: detect permission changes after reload
      const newMember = familyStoreInst.currentMember;
      if (prevMember && prevMemberId === familyStoreInst.currentMemberId) {
        if (prevMember.canViewFinances !== newMember?.canViewFinances) {
          console.warn(
            '[reloadAllStores] canViewFinances changed during reload:',
            prevMember.canViewFinances,
            '→',
            newMember?.canViewFinances,
            'member:',
            prevMemberId,
            'crossDevice:',
            isCrossDeviceReload
          );
        }
      } else if (prevMemberId !== familyStoreInst.currentMemberId) {
        console.warn(
          '[reloadAllStores] currentMemberId changed during reload:',
          prevMemberId,
          '→',
          familyStoreInst.currentMemberId
        );
      }
    } finally {
      await nextTick();
      isReloading = false;
    }

    if (isCrossDeviceReload) {
      useSyncHighlightStore().detectChanges();
    }
  }

  // Track the stop handle so we never register duplicate watchers
  let autoSyncStopHandle: (() => void) | null = null;

  // File polling for cross-device sync detection
  const FILE_POLL_INTERVAL = 10_000;
  let filePollingTimer: ReturnType<typeof setInterval> | null = null;
  let isCheckingFile = false;
  let isCrossDeviceReload = false;

  /**
   * Check if the sync file has been modified externally and reload if so.
   */
  async function reloadIfFileChanged(): Promise<boolean> {
    if (!isConfigured.value || needsPermission.value || isReloading || isCheckingFile) return false;

    isCheckingFile = true;
    try {
      const { hasConflict } = await checkForConflicts();
      if (!hasConflict) return false;

      syncService.cancelPendingSave();

      isCrossDeviceReload = true;
      try {
        const loadResult = await loadFromFile({ merge: true });
        if (loadResult.success) return true;

        if (loadResult.needsPassword) {
          // Try existing family key first (should work unless key was rotated)
          if (familyKey.value && pendingEncryptedFile.value) {
            try {
              const doc = await decryptBeanpodPayload(
                pendingEncryptedFile.value.envelope,
                familyKey.value
              );
              mergeDoc(doc);
              envelope.value = pendingEncryptedFile.value.envelope;
              syncService.setFamilyKey(familyKey.value!, pendingEncryptedFile.value.envelope);
              pendingEncryptedFile.value = null;
              await reloadAllStores();
              syncService.triggerDebouncedSave();
              return true;
            } catch {
              // Family key doesn't work — try cached password
            }
          }

          // Try cached password
          const familyCtx = useFamilyContextStore();
          const settingsStore = useSettingsStore();
          const famId = familyCtx.activeFamilyId;
          const cachedKeyB64 = famId ? settingsStore.getCachedFamilyKey(famId) : null;
          if (cachedKeyB64) {
            const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
            const { base64ToBuffer } = await import('@/utils/encoding');
            const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
            const result = await decryptPendingFileWithKey(fk);
            return result.success;
          }

          pendingEncryptedFile.value = null;
        }

        return false;
      } finally {
        isCrossDeviceReload = false;
      }
    } catch (e) {
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
   * Start polling the sync file for external changes.
   */
  function startFilePolling(): void {
    if (filePollingTimer) return;
    filePollingTimer = setInterval(() => {
      reloadIfFileChanged().catch(console.warn);
    }, FILE_POLL_INTERVAL);
  }

  function stopFilePolling(): void {
    if (filePollingTimer) {
      clearInterval(filePollingTimer);
      filePollingTimer = null;
    }
  }

  function pauseFilePolling(): void {
    stopFilePolling();
  }

  function resumeFilePolling(): void {
    if (isConfigured.value && !needsPermission.value && autoSyncStopHandle && !pollingDeferred) {
      startFilePolling();
    }
  }

  // When true, setupAutoSync marks itself ready but defers file polling
  // until startDeferredPolling() is called. Prevents the reload cascade
  // during init (processRecurringItems creates mutations → file polling
  // detects "change" → triggers reload → more mutations → loop).
  let pollingDeferred = false;

  function deferPolling(): void {
    pollingDeferred = true;
  }

  function startDeferredPolling(): void {
    pollingDeferred = false;
    if (autoSyncStopHandle && !filePollingTimer) {
      startFilePolling();
    }
  }

  /**
   * Setup auto-sync.
   * In V4, the docService persist callback drives saves automatically.
   * We only need file polling for cross-device sync detection.
   */
  function setupAutoSync(): void {
    if (!supportsAutoSync.value) return;
    if (autoSyncStopHandle) return;

    // Mark as set up (the actual save triggering comes from docService's persist callback)
    autoSyncStopHandle = () => {};

    // If polling is deferred (during init), skip starting it now —
    // startDeferredPolling() will start it once init is complete.
    if (!pollingDeferred) {
      startFilePolling();
    }
  }

  /**
   * Reset all sync state (used on sign-out)
   */
  function resetState() {
    if (autoSyncStopHandle) {
      autoSyncStopHandle();
      autoSyncStopHandle = null;
    }
    stopFilePolling();
    syncService.reset();
    useSyncHighlightStore().clearHighlights();
    isInitialized.value = false;
    isConfigured.value = false;
    fileName.value = null;
    isSyncing.value = false;
    error.value = null;
    lastSync.value = null;
    needsPermission.value = false;
    familyKey.value = null;
    envelope.value = null;
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

  function clearError(): void {
    error.value = null;
  }

  /**
   * Handle successful Google Drive reconnection.
   */
  async function handleGoogleReconnected(): Promise<void> {
    if (driveFileNotFound.value) return;

    showGoogleReconnect.value = false;
    showSaveFailureBanner.value = false;
    syncService.resetSaveFailures();
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;

    await reloadIfFileChanged();
    setupAutoSync();
    syncService.triggerDebouncedSave();
  }

  // --- Google Drive actions ---

  async function configureSyncFileGoogleDrive(podFileName: string): Promise<boolean> {
    try {
      const provider = await GoogleDriveProvider.createNew(podFileName);
      syncService.setProvider(provider);

      const ctx = useFamilyContextStore();
      if (ctx.activeFamilyId) {
        await provider.persist(ctx.activeFamilyId);
      }

      needsPermission.value = false;
      storageProviderType.value = 'google_drive';

      await syncNow();

      isReloading = true;
      try {
        await settingsRepo.saveSettings({
          syncEnabled: true,
          syncFilePath: provider.getDisplayName(),
          lastSyncTimestamp: toISODateString(new Date()),
        });
      } finally {
        isReloading = false;
      }

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

      setupTokenExpiryHandler();
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  async function loadFromGoogleDrive(
    fileId: string,
    driveFileName: string
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    try {
      const token = await requestAccessToken();
      await fetchGoogleUserEmail(token);

      const provider = GoogleDriveProvider.fromExisting(fileId, driveFileName);
      const text = await provider.read();
      if (!text) {
        error.value = 'File is empty';
        return { success: false };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false };
      }

      const env = parseBeanpodV4(text);

      const loadedInviteKeyCount = env.inviteKeys ? Object.keys(env.inviteKeys).length : 0;
      console.warn(
        '[syncStore] loadFromGoogleDrive: parsed envelope, inviteKeys:',
        loadedInviteKeyCount,
        loadedInviteKeyCount > 0
          ? 'hashes: ' +
              Object.keys(env.inviteKeys!)
                .map((h) => h.slice(0, 8) + '...')
                .join(', ')
          : '(none)'
      );

      // Store as pending — needs password
      pendingEncryptedFile.value = {
        envelope: env,
        driveFileId: fileId,
        driveFileName,
        driveAccountEmail: provider.getAccountEmail() ?? undefined,
      };
      storageProviderType.value = 'google_drive';
      return { success: false, needsPassword: true };
    } catch (e) {
      error.value = (e as Error).message;
      return { success: false };
    }
  }

  async function listGoogleDriveFiles(options?: {
    forceNewAccount?: boolean;
  }): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
    const token = await requestAccessToken({
      forceConsent: options?.forceNewAccount,
    });
    const folderId = await getOrCreateAppFolder(token);
    const files = await listBeanpodFiles(token, folderId);

    if (files.length > 0) return files;

    console.warn('[syncStore] No files found, retrying with cleared folder cache...');
    clearFolderCache();
    const retryFolderId = await getOrCreateAppFolder(token);
    return listBeanpodFiles(token, retryFolderId);
  }

  let tokenExpiryUnsub: (() => void) | null = null;

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

  // --- Passkey secret management (V4: stored in envelope's passkeyWrappedKeys) ---

  const passkeySecrets = ref<import('@/types/models').PasskeySecret[]>([]);

  /**
   * Effective passkey secrets: merge in-memory secrets with those from the
   * pending/loaded envelope. This ensures PRF unwrap works on login even
   * after a fresh session (when the in-memory ref is empty).
   */
  const effectivePasskeySecrets = computed<import('@/types/models').PasskeySecret[]>(() => {
    const fromRef = passkeySecrets.value;
    const env = pendingEncryptedFile.value?.envelope ?? envelope.value;
    if (!env?.passkeyWrappedKeys) return fromRef;

    const fromEnvelope: import('@/types/models').PasskeySecret[] = Object.entries(
      env.passkeyWrappedKeys
    ).map(([credentialId, wpk]) => ({
      credentialId,
      memberId: wpk.memberId ?? '', // Older envelopes may not have memberId
      wrappedFamilyKey: wpk.wrapped,
      hkdfSalt: wpk.hkdfSalt,
      createdAt: '' as import('@/types/models').ISODateString,
    }));

    // Merge: in-memory secrets take precedence (they have full metadata)
    const seen = new Set(fromRef.map((s) => s.credentialId));
    return [...fromRef, ...fromEnvelope.filter((s) => !seen.has(s.credentialId))];
  });

  function addPasskeySecret(secret: import('@/types/models').PasskeySecret): void {
    passkeySecrets.value = [
      ...passkeySecrets.value.filter((s) => s.credentialId !== secret.credentialId),
      secret,
    ];

    // Persist to envelope's passkeyWrappedKeys so it survives re-encryption
    if (envelope.value) {
      const env: import('@/types/syncFileV4').BeanpodFileV4 = {
        ...envelope.value,
        passkeyWrappedKeys: {
          ...envelope.value.passkeyWrappedKeys,
          [secret.credentialId]: {
            wrapped: secret.wrappedFamilyKey,
            hkdfSalt: secret.hkdfSalt,
            memberId: secret.memberId,
          },
        },
      };
      envelope.value = env;
      syncService.setEnvelope(env);
    }
  }

  function removePasskeySecretsForCredential(credentialId: string): void {
    passkeySecrets.value = passkeySecrets.value.filter((s) => s.credentialId !== credentialId);
  }

  function clearAllPasskeySecrets(): void {
    passkeySecrets.value = [];
  }

  /**
   * Ensure the current family is registered in the cloud registry.
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
    familyKey,
    envelope,
    // Computed
    capabilities,
    supportsAutoSync,
    syncStatus,
    hasSessionPassword,
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
    cachePersistFailed,
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
    loadFromPersistenceCache,
    clearPendingEncryptedFile,
    createNewFile,
    clearSessionPassword,
    getExportedFamilyKey,
    decryptPendingFileWithKey,
    wrapFamilyKeyForMember,
    addMemberWrappedKey,
    addInvitePackage,
    disconnect,
    manualExport,
    manualImport,
    reloadAllStores,
    setupAutoSync,
    deferPolling,
    startDeferredPolling,
    reloadIfFileChanged,
    handleGoogleReconnected,
    pauseFilePolling,
    resumeFilePolling,
    resetState,
    clearError,
    ensureRegistered,
    // Passkey secrets
    passkeySecrets,
    effectivePasskeySecrets,
    addPasskeySecret,
    removePasskeySecretsForCredential,
    clearAllPasskeySecrets,
  };
});
