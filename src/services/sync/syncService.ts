import { supportsFileSystemAccess } from './capabilities';
import {
  storeFileHandle,
  getFileHandle,
  clearFileHandle,
  verifyPermission,
} from './fileHandleStore';
import { createSyncFileData, validateSyncFileData, importSyncFileData } from './fileSync';
import { encryptSyncData, decryptSyncData } from '@/services/crypto/encryption';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { createFamilyWithId } from '@/services/familyContext';
import type { SyncFileData } from '@/types/models';

// Result type for openAndLoadFile that can indicate encrypted file needs password
export interface OpenFileResult {
  success: boolean;
  data?: SyncFileData;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
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

// Current file handle (in-memory for session) and the family it belongs to
let currentFileHandle: FileSystemFileHandle | null = null;
let currentFileHandleFamilyId: string | null = null;

// Callbacks for state changes
type StateCallback = (state: SyncServiceState) => void;
const stateCallbacks: StateCallback[] = [];

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
 * Reset the sync service state.
 * Must be called before re-initializing for a different family to prevent
 * stale file handles or auto-sync state from the previous family carrying over.
 */
export function reset(): void {
  cancelPendingSave();
  currentFileHandle = null;
  currentFileHandleFamilyId = null;
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

  if (!supportsFileSystemAccess()) {
    updateState({
      isInitialized: true,
      isConfigured: false,
      lastError: null,
    });
    return false;
  }

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

  try {
    const handle = await getFileHandle();
    if (handle) {
      currentFileHandle = handle;
      currentFileHandleFamilyId = getActiveFamilyId();
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
  if (!currentFileHandle) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  try {
    const granted = await verifyPermission(currentFileHandle, 'readwrite');
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
    // Show save file picker (allows creating new or selecting existing)
    const handle = await window.showSaveFilePicker({
      suggestedName: 'gp-family-finance-sync.json',
      types: [
        {
          description: 'Finance Data',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });

    // Store handle for persistence
    await storeFileHandle(handle);
    currentFileHandle = handle;
    currentFileHandleFamilyId = getActiveFamilyId();

    updateState({
      isConfigured: true,
      fileName: handle.name,
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
 * Save current data to the sync file
 * @param password - If provided, the data will be encrypted with this password
 */
export async function save(password?: string): Promise<boolean> {
  if (!currentFileHandle) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  // Guard: ensure the file handle belongs to the currently active family.
  // This prevents auto-sync from writing to a different family's sync file
  // after a family switch within the same SPA session.
  const activeFamilyId = getActiveFamilyId();
  if (currentFileHandleFamilyId && activeFamilyId && currentFileHandleFamilyId !== activeFamilyId) {
    console.warn(
      `[syncService] save() blocked: handle belongs to family ${currentFileHandleFamilyId} but active family is ${activeFamilyId}`
    );
    return false;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // Verify we have permission
    const permissionGranted = await verifyPermission(currentFileHandle, 'readwrite');
    if (!permissionGranted) {
      updateState({ isSyncing: false, lastError: 'Permission denied' });
      return false;
    }

    // Create sync data
    const syncData = await createSyncFileData(!!password);

    let fileContent: string;

    if (password) {
      // Encrypt the data section
      const dataJson = JSON.stringify(syncData.data);
      const encryptedData = await encryptSyncData(dataJson, password);

      // Create encrypted file format - store encrypted data as string in data field
      const encryptedSyncData = {
        version: syncData.version,
        exportedAt: syncData.exportedAt,
        encrypted: true,
        data: encryptedData, // This is now a string (base64 encrypted)
      };
      fileContent = JSON.stringify(encryptedSyncData, null, 2);
    } else {
      fileContent = JSON.stringify(syncData, null, 2);
    }

    // Write to file
    const writable = await currentFileHandle.createWritable();
    await writable.write(fileContent);
    await writable.close();

    updateState({ isSyncing: false, lastError: null });
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
  if (!currentFileHandle) {
    return null;
  }

  try {
    // Verify we have permission
    const hasPermission = await verifyPermission(currentFileHandle, 'read');
    if (!hasPermission) {
      return null;
    }

    // Read file
    const file = await currentFileHandle.getFile();
    const text = await file.text();

    // Handle empty file
    if (!text.trim()) {
      return null;
    }

    const data = JSON.parse(text);

    // Return the exportedAt timestamp
    if (data && typeof data.exportedAt === 'string') {
      return data.exportedAt;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Load data from the sync file
 */
export async function load(): Promise<SyncFileData | null> {
  if (!currentFileHandle) {
    updateState({ lastError: 'No file configured' });
    return null;
  }

  updateState({ isSyncing: true, lastError: null });

  try {
    // Verify we have permission
    const hasPermission = await verifyPermission(currentFileHandle, 'read');
    if (!hasPermission) {
      updateState({ isSyncing: false, lastError: 'Permission denied' });
      return null;
    }

    // Read file
    const file = await currentFileHandle.getFile();
    const text = await file.text();

    // Handle empty file (new sync file)
    if (!text.trim()) {
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
 */
export async function loadAndImport(): Promise<{
  success: boolean;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
  rawSyncData?: SyncFileData;
}> {
  const syncData = await load();
  if (!syncData) {
    // No data or error - state already updated by load()
    return { success: false };
  }

  if (syncData.encrypted) {
    updateState({ lastError: 'Encrypted file - password required' });
    return {
      success: false,
      needsPassword: true,
      fileHandle: currentFileHandle ?? undefined,
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
    await importSyncFileData(syncData);
    return { success: true };
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return { success: false };
  }
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
 * Trigger a debounced save (for auto-sync)
 * Uses the session password if set
 */
export function triggerDebouncedSave(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    save(sessionPassword ?? undefined).catch(console.error);
  }, DEBOUNCE_MS);
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
 */
export async function flushPendingSave(): Promise<void> {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    await save(sessionPassword ?? undefined);
  }
}

/**
 * Disconnect from sync file
 */
export async function disconnect(): Promise<void> {
  cancelPendingSave();
  await clearFileHandle();
  currentFileHandle = null;
  currentFileHandleFamilyId = null;
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
  if (!currentFileHandle) {
    return false;
  }

  try {
    const permission = await currentFileHandle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Open file picker to select an existing sync file, load its data, and configure it as the sync target.
 * Must be called from a user gesture.
 * Returns OpenFileResult with:
 * - success: true if file was loaded and imported successfully
 * - needsPassword: true if file is encrypted and requires password
 * - fileHandle: the file handle (needed for decryption flow)
 * - rawSyncData: the raw sync data structure (for encrypted files, data is a string)
 */
export async function openAndLoadFile(): Promise<OpenFileResult> {
  if (!supportsFileSystemAccess()) {
    updateState({ lastError: 'File System Access API not supported' });
    return { success: false };
  }

  try {
    // Show open file picker to select existing file
    const handles = await window.showOpenFilePicker({
      types: [
        {
          description: 'Finance Data',
          accept: { 'application/json': ['.json'] },
        },
      ],
      multiple: false,
    });

    const handle = handles[0];
    if (!handle) {
      return { success: false };
    }

    updateState({ isSyncing: true, lastError: null });

    // Read and validate the file
    const file = await handle.getFile();
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
        rawSyncData: data as SyncFileData,
      };
    }

    // For unencrypted files, do full validation
    if (!validateSyncFileData(data)) {
      updateState({ isSyncing: false, lastError: 'Invalid sync file format' });
      return { success: false };
    }

    const syncData = data as SyncFileData;

    // Guard: if sync file has a familyId (v2.0+), it must match the active family
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId && activeFamilyId && syncData.familyId !== activeFamilyId) {
      console.warn(
        `[syncService] openAndLoadFile: sync file familyId (${syncData.familyId}) does not match active family (${activeFamilyId}). Skipping import.`
      );
      updateState({
        isSyncing: false,
        lastError: 'Sync file belongs to a different family',
      });
      return { success: false };
    }

    // If no active family (e.g. sign-in flow), activate from file's familyId
    if (!activeFamilyId && syncData.familyId) {
      await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
      activeFamilyId = syncData.familyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // Store handle for persistence and set as sync target
    await storeFileHandle(handle);
    currentFileHandle = handle;
    currentFileHandleFamilyId = activeFamilyId;

    updateState({
      isConfigured: true,
      fileName: handle.name,
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
 * Decrypt and import data from an encrypted file.
 * Call this after openAndLoadFile returns needsPassword: true
 */
export async function decryptAndImport(
  fileHandle: FileSystemFileHandle,
  rawSyncData: SyncFileData,
  password: string
): Promise<{ success: boolean; error?: string }> {
  updateState({ isSyncing: true, lastError: null });

  try {
    // The data field is actually a base64 encrypted string for encrypted files
    const encryptedData = rawSyncData.data as unknown as string;

    // Decrypt the data
    const decryptedJson = await decryptSyncData(encryptedData, password);
    const decryptedData = JSON.parse(decryptedJson);

    // Reconstruct the sync data with decrypted content
    const syncData: SyncFileData = {
      version: rawSyncData.version,
      exportedAt: rawSyncData.exportedAt,
      encrypted: false, // Mark as decrypted for import
      data: decryptedData,
    };

    // Validate the decrypted data structure
    if (!validateSyncFileData(syncData)) {
      updateState({ isSyncing: false, lastError: 'Invalid data structure after decryption' });
      return { success: false, error: 'Invalid data structure after decryption' };
    }

    // Guard: if sync file has a familyId (v2.0+), it must match the active family
    let activeFamilyId = getActiveFamilyId();
    if (syncData.familyId && activeFamilyId && syncData.familyId !== activeFamilyId) {
      console.warn(
        `[syncService] decryptAndImport: sync file familyId (${syncData.familyId}) does not match active family (${activeFamilyId}). Skipping import.`
      );
      updateState({
        isSyncing: false,
        lastError: 'Sync file belongs to a different family',
      });
      return { success: false, error: 'Sync file belongs to a different family' };
    }

    // If no active family (e.g. sign-in flow), activate from file's familyId
    if (!activeFamilyId && syncData.familyId) {
      await createFamilyWithId(syncData.familyId, syncData.familyName ?? 'My Family');
      activeFamilyId = syncData.familyId;
    }

    // Import the data
    await importSyncFileData(syncData);

    // Store handle for persistence and set as sync target
    await storeFileHandle(fileHandle);
    currentFileHandle = fileHandle;
    currentFileHandleFamilyId = activeFamilyId;

    updateState({
      isConfigured: true,
      fileName: fileHandle.name,
      isSyncing: false,
      lastError: null,
    });

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
