import { supportsFileSystemAccess } from './capabilities';
import { getFileHandle, verifyPermission, getProviderConfig } from './fileHandleStore';
import { GoogleDriveProvider } from './providers/googleDriveProvider';
import {
  createSyncFileData,
  validateSyncFileData,
  importSyncFileData,
  openFilePicker,
} from './fileSync';
import { encryptSyncData, decryptSyncData } from '@/services/crypto/encryption';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { createFamilyWithId } from '@/services/familyContext';
import { clearSettingsWAL } from '@/services/sync/settingsWAL';
import type { StorageProvider, StorageProviderType } from './storageProvider';
import { LocalStorageProvider } from './providers/localProvider';
import type { SyncFileData } from '@/types/models';
import { generateUUID } from '@/utils/id';

// Result type for openAndLoadFile that can indicate encrypted file needs password
export interface OpenFileResult {
  success: boolean;
  data?: SyncFileData;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
  provider?: StorageProvider;
  rawSyncData?: SyncFileData; // The unprocessed sync data (with encrypted flag)
}

export interface SyncServiceState {
  isInitialized: boolean;
  isConfigured: boolean;
  fileName: string | null;
  isSyncing: boolean;
  lastError: string | null;
}

// Debounce timer for auto-save
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

// Write mutex — prevents concurrent save() calls from interleaving writes.
// Without this, two overlapping saves can corrupt the file: if the second write
// is shorter than the first, the tail of the first write remains as trailing bytes
// (e.g. a shorter familyName leaves stale JSON after the closing brace).
let saveInProgress: Promise<boolean> | null = null;

// Current storage provider (in-memory for session) and the family it belongs to
let currentProvider: StorageProvider | null = null;
let currentProviderFamilyId: string | null = null;

// Callbacks for state changes
type StateCallback = (state: SyncServiceState) => void;
const stateCallbacks: StateCallback[] = [];

// Callbacks for save completion (timestamp updates)
type SaveCompleteCallback = (timestamp: string) => void;
const saveCompleteCallbacks: SaveCompleteCallback[] = [];

// Current state
let state: SyncServiceState = {
  isInitialized: false,
  isConfigured: false,
  fileName: null,
  isSyncing: false,
  lastError: null,
};

function updateState(updates: Partial<SyncServiceState>): void {
  state = { ...state, ...updates };
  stateCallbacks.forEach((cb) => cb(state));
}

/**
 * Subscribe to state changes
 */
export function onStateChange(callback: StateCallback): () => void {
  stateCallbacks.push(callback);
  // Return unsubscribe function
  return () => {
    const index = stateCallbacks.indexOf(callback);
    if (index > -1) {
      stateCallbacks.splice(index, 1);
    }
  };
}

/**
 * Get current sync service state
 */
export function getState(): SyncServiceState {
  return { ...state };
}

/**
 * Register a callback invoked after every successful save with the file's exportedAt timestamp.
 * Used by syncStore to keep lastSync in sync without manual updates scattered throughout.
 */
export function onSaveComplete(callback: SaveCompleteCallback): () => void {
  saveCompleteCallbacks.push(callback);
  return () => {
    const index = saveCompleteCallbacks.indexOf(callback);
    if (index > -1) saveCompleteCallbacks.splice(index, 1);
  };
}

/**
 * Get the current storage provider type, or null if none configured
 */
export function getProviderType(): StorageProviderType | null {
  return currentProvider?.type ?? null;
}

/**
 * Get the current storage provider (for external use, e.g. Google Drive file ID)
 */
export function getProvider(): StorageProvider | null {
  return currentProvider;
}

/**
 * Set the storage provider directly (used by Google Drive flow)
 */
export function setProvider(provider: StorageProvider): void {
  currentProvider = provider;
  currentProviderFamilyId = getActiveFamilyId();
  updateState({
    isConfigured: true,
    fileName: provider.getDisplayName(),
    lastError: null,
  });
}

/**
 * Reset the sync service state.
 * Must be called before re-initializing for a different family to prevent
 * stale file handles or auto-sync state from the previous family carrying over.
 */
export function reset(): void {
  cancelPendingSave();
  currentProvider = null;
  currentProviderFamilyId = null;
  sessionPassword = null;
  updateState({
    isInitialized: false,
    isConfigured: false,
    fileName: null,
    isSyncing: false,
    lastError: null,
  });
}

/**
 * Initialize the sync service - try to restore file handle from storage.
 * Resets previous state first to prevent cross-family data leakage.
 * Requires an active family to be set (prevents loading a legacy/wrong family's handle).
 */
export async function initialize(): Promise<boolean> {
  // Always reset previous state — prevents stale handles from a previous
  // family's session from being reused (critical for multi-family isolation)
  reset();

  // Guard: don't initialize sync without an active family
  // (prevents getSyncFileKey from falling back to legacy key)
  if (!getActiveFamilyId()) {
    console.warn('[syncService] No active family — skipping sync initialization');
    updateState({
      isInitialized: true,
      isConfigured: false,
      lastError: null,
    });
    return false;
  }

  // Check for persisted provider config (Google Drive or local)
  const familyId = getActiveFamilyId();
  if (familyId) {
    try {
      const config = await getProviderConfig(familyId);
      console.warn('[syncService] Provider config for', familyId, ':', config?.type ?? 'none');
      if (config?.type === 'google_drive' && config.driveFileId && config.driveFileName) {
        currentProvider = GoogleDriveProvider.fromExisting(
          config.driveFileId,
          config.driveFileName
        );
        currentProviderFamilyId = familyId;
        updateState({
          isInitialized: true,
          isConfigured: true,
          fileName: config.driveFileName,
          lastError: null,
        });
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore provider config:', e);
    }
  }

  // Try to restore a local file handle (File System Access API)
  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle();
      console.warn(
        '[syncService] Local file handle for',
        familyId,
        ':',
        handle ? handle.name : 'none'
      );
      if (handle) {
        currentProvider = LocalStorageProvider.fromHandle(handle);
        currentProviderFamilyId = getActiveFamilyId();
        updateState({
          isInitialized: true,
          isConfigured: true,
          fileName: handle.name,
          lastError: null,
        });
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore file handle:', e);
    }
  }

  updateState({
    isInitialized: true,
    isConfigured: false,
    lastError: null,
  });
  return false;
}

/**
 * Request permission to use the stored file handle
 * Must be called from a user gesture (click handler)
 */
export async function requestPermission(): Promise<boolean> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  try {
    const granted = await currentProvider.requestAccess();
    if (!granted) {
      updateState({ lastError: 'Permission denied' });
      return false;
    }
    updateState({ lastError: null });
    return true;
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Open file picker to select/create a sync file
 * Must be called from a user gesture
 */
export async function selectSyncFile(): Promise<boolean> {
  if (!supportsFileSystemAccess()) {
    updateState({ lastError: 'File System Access API not supported' });
    return false;
  }

  try {
    const provider = await LocalStorageProvider.fromSavePicker();
    if (!provider) return false;

    // Store handle for persistence
    const familyId = getActiveFamilyId();
    if (familyId) {
      await provider.persist(familyId);
    }
    currentProvider = provider;
    currentProviderFamilyId = familyId;

    updateState({
      isConfigured: true,
      fileName: provider.getDisplayName(),
      lastError: null,
    });

    return true;
  } catch (e) {
    // User cancelled is not an error
    if ((e as Error).name === 'AbortError') {
      return false;
    }
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Save current data to the sync file.
 * Serialized via a write mutex to prevent concurrent saves from corrupting
 * the file (see saveInProgress). If a save is already running, this call
 * waits for it to finish before starting its own write.
 * @param password - If provided, the data will be encrypted with this password
 */
export async function save(password?: string): Promise<boolean> {
  // Wait for any in-flight save to complete before starting a new one.
  // This prevents two overlapping createWritable/write/close sequences
  // from interleaving, which can leave stale trailing bytes in the file.
  if (saveInProgress) {
    try {
      await saveInProgress;
    } catch {
      // Previous save failed — proceed with ours regardless
    }
  }

  const promise = doSave(password);
  saveInProgress = promise;

  try {
    return await promise;
  } finally {
    // Only clear if we're still the active save (another may have queued)
    if (saveInProgress === promise) {
      saveInProgress = null;
    }
  }
}

/**
 * Internal save implementation — callers must go through save() which
 * serializes access via the write mutex.
 */
async function doSave(password?: string): Promise<boolean> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  // Guard: ensure the provider belongs to the currently active family.
  // This prevents auto-sync from writing to a different family's sync file
  // after a family switch within the same SPA session.
  const activeFamilyId = getActiveFamilyId();
  if (currentProviderFamilyId && activeFamilyId && currentProviderFamilyId !== activeFamilyId) {
    console.warn(
      `[syncService] save() blocked: provider belongs to family ${currentProviderFamilyId} but active family is ${activeFamilyId}`
    );
    return false;
  }

  // Guard: if encryption is required but no password provided, refuse to write plaintext.
  if (!password && isEncryptionRequiredFn && isEncryptionRequiredFn()) {
    console.warn('[syncService] save() blocked: encryption is enabled but no password provided');
    return false;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // For local provider, verify we have permission before writing
    if (currentProvider.type === 'local') {
      const localProvider = currentProvider as LocalStorageProvider;
      const permissionGranted = await verifyPermission(localProvider.getHandle(), 'readwrite');
      if (!permissionGranted) {
        console.warn('[syncService] doSave: file permission denied — save skipped');
        updateState({ isSyncing: false, lastError: 'Permission denied' });
        return false;
      }
    }

    // Create sync data — mark as encrypted if password is provided
    const needsEncryption = !!password;
    const syncData = await createSyncFileData(needsEncryption);

    let fileContent: string;

    if (password) {
      // Password-based encryption (standard path)
      const dataJson = JSON.stringify(syncData.data);
      const encryptedData = await encryptSyncData(dataJson, password);

      // Create encrypted file format - store encrypted data as string in data field
      // Preserve envelope fields (familyId, familyName) so the file can be identified
      // without decryption (e.g., for family resolution on a new device)
      const encryptedSyncData: Record<string, unknown> = {
        version: syncData.version,
        exportedAt: syncData.exportedAt,
        encrypted: true,
        data: encryptedData,
      };
      if (syncData.familyId) {
        encryptedSyncData.familyId = syncData.familyId;
      }
      if (syncData.familyName) {
        encryptedSyncData.familyName = syncData.familyName;
      }
      fileContent = JSON.stringify(encryptedSyncData, null, 2);
    } else {
      fileContent = JSON.stringify(syncData, null, 2);
    }

    // Write via the storage provider abstraction
    await currentProvider.write(fileContent);

    // File write succeeded — clear the WAL so it doesn't override on next reload
    const savedFamilyId = getActiveFamilyId();
    if (savedFamilyId) {
      clearSettingsWAL(savedFamilyId);
    }

    updateState({ isSyncing: false, lastError: null });

    // Notify subscribers (syncStore) of the save timestamp
    saveCompleteCallbacks.forEach((cb) => cb(syncData.exportedAt));

    return true;
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return false;
  }
}

/**
 * Get the timestamp from the sync file without fully loading/importing data
 * Returns null if file doesn't exist or is empty/invalid
 */
export async function getFileTimestamp(): Promise<string | null> {
  if (!currentProvider) {
    return null;
  }

  return currentProvider.getLastModified();
}

/**
 * Load data from the sync file
 */
export async function load(): Promise<SyncFileData | null> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return null;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // For local provider, verify permission before reading
    if (currentProvider.type === 'local') {
      const localProvider = currentProvider as LocalStorageProvider;
      const hasPermission = await verifyPermission(localProvider.getHandle(), 'read');
      if (!hasPermission) {
        updateState({ isSyncing: false, lastError: 'Permission denied' });
        return null;
      }
    }

    // Read file via provider
    const text = await currentProvider.read();

    // Handle empty file (new sync file)
    if (!text) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }

    const data = JSON.parse(text);

    if (!validateSyncFileData(data)) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return null;
    }

    updateState({ isSyncing: false, lastError: null });
    return data;
  } catch (e) {
    // If file doesn't exist yet or is empty, that's okay
    if ((e as Error).name === 'NotFoundError' || (e as Error).message.includes('JSON')) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return null;
  }
}

/**
 * Load data from sync file and import into database.
 * Checks that the sync file's familyId matches the active family to prevent
 * cross-family data leakage (e.g., loading one family's sync file into another's DB).
 * @param options.merge - If true, merge file data with local data instead of full replace.
 */
export async function loadAndImport(options: { merge?: boolean } = {}): Promise<{
  success: boolean;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
  rawSyncData?: SyncFileData;
  hasLocalChanges?: boolean;
}> {
  const syncData = await load();
  if (!syncData) {
    // No data or error - state already updated by load()
    return { success: false };
  }

  if (syncData.encrypted) {
    updateState({ lastError: 'Encrypted file - password required' });
    // Return the local file handle if available (for backward compat with syncStore)
    const localHandle =
      currentProvider instanceof LocalStorageProvider ? currentProvider.getHandle() : undefined;
    return {
      success: false,
      needsPassword: true,
      fileHandle: localHandle,
      rawSyncData: syncData,
    };
  }

  // Guard: if sync file has a familyId (v2.0+), it must match the active family
  let activeFamilyId = getActiveFamilyId();
  if (syncData.familyId && activeFamilyId && syncData.familyId !== activeFamilyId) {
    console.warn(
      `[syncService] Sync file familyId (${syncData.familyId}) does not match active family (${activeFamilyId}). Skipping import.`
    );
    updateState({
      lastError: 'Sync file belongs to a different family',
      isConfigured: false,
    });
    return { success: false };
  }

  // If no active family (e.g. sign-in flow), activate from file's familyId
  if (!activeFamilyId && syncData.familyId) {
    await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
    activeFamilyId = syncData.familyId;
  }

  try {
    const importResult = await importSyncFileData(syncData, { merge: options.merge });
    return { success: true, hasLocalChanges: importResult.hasLocalChanges };
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return { success: false };
  }
}

// Callback to check if encryption is required (set by syncStore)
let isEncryptionRequiredFn: (() => boolean) | null = null;

/**
 * Register a callback that returns whether encryption is currently enabled.
 * Used by triggerDebouncedSave and flushPendingSave to prevent plaintext writes.
 */
export function setEncryptionRequiredCallback(fn: () => boolean): void {
  isEncryptionRequiredFn = fn;
}

// Store the current session password for auto-sync
let sessionPassword: string | null = null;

/**
 * Set the session password for encryption (used by auto-sync)
 */
export function setSessionPassword(password: string | null): void {
  sessionPassword = password;
}

/**
 * Get the current session password
 */
export function getSessionPassword(): string | null {
  return sessionPassword;
}

/**
 * Get the current session file handle (for reading encrypted blob during passkey registration).
 * Returns null if the current provider is not a local filesystem provider.
 */
export function getSessionFileHandle(): FileSystemFileHandle | null {
  if (currentProvider instanceof LocalStorageProvider) {
    return currentProvider.getHandle();
  }
  return null;
}

/**
 * Trigger a debounced save (for auto-sync).
 * If encryption is enabled (via callback) but no session password is available,
 * the save is skipped entirely to prevent writing plaintext to an encrypted file.
 */
export function triggerDebouncedSave(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    // Check encryption requirement via callback before saving
    if (isEncryptionRequiredFn && isEncryptionRequiredFn() && !sessionPassword) {
      console.warn(
        '[syncService] Auto-save skipped: encryption is enabled but no session password available'
      );
      return;
    }
    save(sessionPassword ?? undefined).catch((err) =>
      console.warn('[syncService] Auto-save failed:', err)
    );
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending debounced save and perform an immediate save.
 * Combines flushPendingSave + save in a single call.
 * Intended for visibilitychange → hidden and beforeunload handlers.
 */
export async function saveNow(): Promise<boolean> {
  cancelPendingSave();
  if (isEncryptionRequiredFn && isEncryptionRequiredFn() && !sessionPassword) {
    console.warn('[syncService] saveNow skipped: encryption enabled but no session password');
    return false;
  }
  return save(sessionPassword ?? undefined);
}

/**
 * Cancel any pending debounced save
 */
export function cancelPendingSave(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
}

/**
 * Flush any pending debounced save immediately.
 * Call before sign-out to ensure recent changes are persisted to file.
 * If encryption is enabled but no session password is available,
 * the save is skipped to prevent writing plaintext.
 */
export async function flushPendingSave(): Promise<void> {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    // Guard: never write plaintext when encryption is required
    if (isEncryptionRequiredFn && isEncryptionRequiredFn() && !sessionPassword) {
      console.warn(
        '[syncService] Flush skipped: encryption is enabled but no session password available'
      );
      return;
    }
    await save(sessionPassword ?? undefined);
  }
}

/**
 * Disconnect from sync file
 */
export async function disconnect(): Promise<void> {
  cancelPendingSave();
  if (currentProvider) {
    const familyId = getActiveFamilyId();
    if (familyId) {
      await currentProvider.clearPersisted(familyId);
    }
    await currentProvider.disconnect();
  }
  currentProvider = null;
  currentProviderFamilyId = null;
  updateState({
    isConfigured: false,
    fileName: null,
    lastError: null,
  });
}

/**
 * Check if sync is configured and has permission
 */
export async function hasPermission(): Promise<boolean> {
  if (!currentProvider) {
    return false;
  }

  return currentProvider.isReady();
}

/**
 * Open file picker to select an existing sync file, load its data, and configure it as the sync target.
 * Must be called from a user gesture.
 * Returns OpenFileResult with:
 * - success: true if file was loaded and imported successfully
 * - needsPassword: true if file is encrypted and requires password
 * - fileHandle: the file handle (needed for decryption flow)
 * - provider: the storage provider (preferred over fileHandle)
 * - rawSyncData: the raw sync data structure (for encrypted files, data is a string)
 */
export async function openAndLoadFile(): Promise<OpenFileResult> {
  // Cancel any pending auto-save from a previously loaded file to prevent
  // it from firing after the file handle has been switched.
  cancelPendingSave();

  // Mobile / legacy browsers: fall back to <input type="file">
  if (!supportsFileSystemAccess()) {
    return openAndLoadFileFallback();
  }

  try {
    // Show open file picker to select existing file.
    // No type filter — Android's system picker filters by MIME type and doesn't
    // recognise .beanpod as application/json, greying those files out.
    // We validate file contents after reading instead.
    const handles = await window.showOpenFilePicker({
      multiple: false,
    });

    const handle = handles[0];
    if (!handle) {
      return { success: false };
    }

    const provider = LocalStorageProvider.fromHandle(handle);

    updateState({ isSyncing: true, lastError: null });

    // Read and validate the file
    const text = await provider.read();

    if (!text) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      updateState({ isSyncing: false, lastError: 'Invalid JSON file' });
      return { success: false };
    }

    // For encrypted files, the data field is a string, so we need a relaxed validation
    const obj = data as Record<string, unknown>;
    if (
      typeof obj.version !== 'string' ||
      typeof obj.exportedAt !== 'string' ||
      typeof obj.encrypted !== 'boolean'
    ) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    // If encrypted, return early with needsPassword flag
    if (obj.encrypted === true) {
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        fileHandle: handle,
        provider,
        rawSyncData: data as SyncFileData,
      };
    }

    // For unencrypted files, do full validation
    if (!validateSyncFileData(data)) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    const syncData = data as SyncFileData;

    // User explicitly picked this file — adopt its family identity
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId) {
      if (syncData.familyId !== activeFamilyId) {
        await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
        activeFamilyId = syncData.familyId;
      }
    } else if (!activeFamilyId) {
      // v1 file with no familyId and no active family — create one
      const newFamilyId = generateUUID();
      await createFamilyWithId(newFamilyId, 'My Family');
      activeFamilyId = newFamilyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // Store provider for persistence and set as sync target
    if (activeFamilyId) {
      await provider.persist(activeFamilyId);
    }
    currentProvider = provider;
    currentProviderFamilyId = activeFamilyId;

    updateState({
      isConfigured: true,
      fileName: provider.getDisplayName(),
      isSyncing: false,
      lastError: null,
    });

    return { success: true, data: syncData };
  } catch (e) {
    // User cancelled is not an error
    if ((e as Error).name === 'AbortError') {
      updateState({ isSyncing: false });
      return { success: false };
    }
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Fallback for openAndLoadFile when File System Access API is not available
 * (mobile browsers, Firefox, etc.). Uses <input type="file"> instead.
 * No file handle is stored, so auto-sync won't be available.
 */
async function openAndLoadFileFallback(): Promise<OpenFileResult> {
  try {
    cancelPendingSave();
    const file = await openFilePicker();
    if (!file) {
      return { success: false };
    }

    // Validate extension
    if (!file.name.endsWith('.beanpod') && !file.name.endsWith('.json')) {
      updateState({ isSyncing: false, lastError: 'Please select a .beanpod or .json file' });
      return { success: false };
    }

    updateState({ isSyncing: true, lastError: null });

    const text = await file.text();

    if (!text.trim()) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      updateState({ isSyncing: false, lastError: 'Invalid JSON file' });
      return { success: false };
    }

    // Relaxed validation for encrypted files
    const obj = data as Record<string, unknown>;
    if (
      typeof obj.version !== 'string' ||
      typeof obj.exportedAt !== 'string' ||
      typeof obj.encrypted !== 'boolean'
    ) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    // If encrypted, return early with needsPassword flag (no handle on mobile)
    if (obj.encrypted === true) {
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        rawSyncData: data as SyncFileData,
      };
    }

    // Full validation for unencrypted files
    if (!validateSyncFileData(data)) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    const syncData = data as SyncFileData;

    // Adopt family identity from the file
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId) {
      if (syncData.familyId !== activeFamilyId) {
        await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
        activeFamilyId = syncData.familyId;
      }
    } else if (!activeFamilyId) {
      const newFamilyId = generateUUID();
      await createFamilyWithId(newFamilyId, 'My Family');
      activeFamilyId = newFamilyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // No file handle on mobile — mark as configured but without auto-sync
    updateState({
      isConfigured: true,
      fileName: file.name,
      isSyncing: false,
      lastError: null,
    });

    return { success: true, data: syncData };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Load a file that was dropped onto the drop zone (drag-and-drop).
 * Accepts a File object and an optional FileSystemFileHandle for persistent access.
 * If a handle is provided (Chromium), the file is stored for auto-sync.
 */
export async function loadDroppedFile(
  file: File,
  fileHandle?: FileSystemFileHandle
): Promise<OpenFileResult> {
  cancelPendingSave();
  try {
    updateState({ isSyncing: true, lastError: null });

    const text = await file.text();

    if (!text.trim()) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      updateState({ isSyncing: false, lastError: 'Invalid JSON file' });
      return { success: false };
    }

    const obj = data as Record<string, unknown>;
    if (
      typeof obj.version !== 'string' ||
      typeof obj.exportedAt !== 'string' ||
      typeof obj.encrypted !== 'boolean'
    ) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    // If encrypted, return early with needsPassword flag
    if (obj.encrypted === true) {
      updateState({ isSyncing: false, lastError: null });
      const provider = fileHandle ? LocalStorageProvider.fromHandle(fileHandle) : undefined;
      return {
        success: false,
        needsPassword: true,
        fileHandle,
        provider,
        rawSyncData: data as SyncFileData,
      };
    }

    // For unencrypted files, do full validation
    if (!validateSyncFileData(data)) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    const syncData = data as SyncFileData;

    // Adopt the file's family identity
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId) {
      if (syncData.familyId !== activeFamilyId) {
        await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
        activeFamilyId = syncData.familyId;
      }
    } else if (!activeFamilyId) {
      const newFamilyId = generateUUID();
      await createFamilyWithId(newFamilyId, 'My Family');
      activeFamilyId = newFamilyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // If we have a file handle, create a provider and persist it
    if (fileHandle) {
      const provider = LocalStorageProvider.fromHandle(fileHandle);
      if (activeFamilyId) {
        await provider.persist(activeFamilyId);
      }
      currentProvider = provider;
      currentProviderFamilyId = activeFamilyId;
    }

    updateState({
      isConfigured: !!fileHandle,
      fileName: file.name,
      isSyncing: false,
      lastError: null,
    });

    return { success: true, data: syncData };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Decrypt and import data from an encrypted file.
 * Call this after openAndLoadFile returns needsPassword: true.
 * Accepts either a StorageProvider or a FileSystemFileHandle for backward compat.
 */
export async function decryptAndImport(
  handleOrProvider: FileSystemFileHandle | StorageProvider,
  rawSyncData: SyncFileData,
  password: string
): Promise<{ success: boolean; error?: string }> {
  cancelPendingSave();
  updateState({ isSyncing: true, lastError: null });

  // Normalize to a StorageProvider
  const provider =
    handleOrProvider &&
    'type' in handleOrProvider &&
    (handleOrProvider.type === 'local' || handleOrProvider.type === 'google_drive')
      ? (handleOrProvider as StorageProvider)
      : handleOrProvider instanceof FileSystemFileHandle
        ? LocalStorageProvider.fromHandle(handleOrProvider)
        : null;

  try {
    // The data field is actually a base64 encrypted string for encrypted files
    const encryptedData = rawSyncData.data as unknown as string;

    // Decrypt the data
    const decryptedJson = await decryptSyncData(encryptedData, password);
    const decryptedData = JSON.parse(decryptedJson);

    // Reconstruct the sync data with decrypted content
    // Carry over envelope fields (familyId, familyName) from the outer wrapper
    const syncData: SyncFileData = {
      version: rawSyncData.version,
      exportedAt: rawSyncData.exportedAt,
      encrypted: false, // Mark as decrypted for import
      data: decryptedData,
      familyId: rawSyncData.familyId,
      familyName: rawSyncData.familyName,
    };

    // Validate the decrypted data structure
    if (!validateSyncFileData(syncData)) {
      updateState({ isSyncing: false, lastError: 'Invalid data structure after decryption' });
      return { success: false, error: 'Invalid data structure after decryption' };
    }

    // User explicitly provided password — adopt the file's family identity
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId) {
      if (syncData.familyId !== activeFamilyId) {
        await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
        activeFamilyId = syncData.familyId;
      }
    } else if (!activeFamilyId) {
      // Encrypted file with no familyId and no active family — create one
      const newFamilyId = generateUUID();
      await createFamilyWithId(newFamilyId, 'My Family');
      activeFamilyId = newFamilyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // Set provider as sync target
    if (provider) {
      if (activeFamilyId) {
        await provider.persist(activeFamilyId);
      }
      currentProvider = provider;
      currentProviderFamilyId = activeFamilyId;

      updateState({
        isConfigured: true,
        fileName: provider.getDisplayName(),
        isSyncing: false,
        lastError: null,
      });
    } else {
      // No provider (mobile fallback) — mark configured but no auto-sync
      updateState({
        isConfigured: true,
        isSyncing: false,
        lastError: null,
      });
    }

    return { success: true };
  } catch (e) {
    const errorMessage = (e as Error).message;
    // Check for password error
    if (errorMessage.includes('Incorrect password') || errorMessage.includes('corrupted')) {
      updateState({ isSyncing: false, lastError: 'Incorrect password' });
      return { success: false, error: 'Incorrect password' };
    }
    updateState({ isSyncing: false, lastError: errorMessage });
    return { success: false, error: errorMessage };
  }
}
