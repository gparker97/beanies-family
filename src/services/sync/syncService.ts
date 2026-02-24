import { supportsFileSystemAccess } from './capabilities';
import {
  storeFileHandle,
  getFileHandle,
  clearFileHandle,
  verifyPermission,
} from './fileHandleStore';
import {
  createSyncFileData,
  validateSyncFileData,
  importSyncFileData,
  openFilePicker,
} from './fileSync';
import {
  encryptSyncData,
  decryptSyncData,
  encryptDataWithKey,
  decryptDataWithKey,
  extractSaltFromEncrypted,
} from '@/services/crypto/encryption';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { createFamilyWithId } from '@/services/familyContext';
import type { SyncFileData } from '@/types/models';
import { generateUUID } from '@/utils/id';

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
  sessionDEK = null;
  sessionDEKSalt = null;
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
      suggestedName: 'my-family.beanpod',
      types: [
        {
          description: 'beanies.family Data File',
          accept: { 'application/json': ['.beanpod', '.json'] },
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

  // Guard: if encryption is required but no password/DEK provided, refuse to write
  // plaintext. This is the last line of defense against all encryption bypass bugs.
  if (!password && !sessionDEK && isEncryptionRequiredFn && isEncryptionRequiredFn()) {
    console.warn(
      '[syncService] save() blocked: encryption is enabled but no password or DEK provided'
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

    // Create sync data — mark as encrypted if password or DEK is provided
    const needsEncryption = !!(password || sessionDEK);
    const syncData = await createSyncFileData(needsEncryption);

    let fileContent: string;

    if (sessionDEK && sessionDEKSalt) {
      // DEK-based encryption (passkey PRF path)
      const dataJson = JSON.stringify(syncData.data);
      const encryptedData = await encryptDataWithKey(dataJson, sessionDEK, sessionDEKSalt);

      const encryptedSyncData: Record<string, unknown> = {
        version: syncData.version,
        exportedAt: syncData.exportedAt,
        encrypted: true,
        data: encryptedData,
      };
      if (syncData.familyId) encryptedSyncData.familyId = syncData.familyId;
      if (syncData.familyName) encryptedSyncData.familyName = syncData.familyName;
      fileContent = JSON.stringify(encryptedSyncData, null, 2);
    } else if (password) {
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

    // Write to file — truncate first to prevent stale trailing bytes when
    // the new content is shorter than the previous write (e.g. shorter familyName).
    const writable = await currentFileHandle.createWritable();
    await writable.truncate(0);
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
 */
export function getSessionFileHandle(): FileSystemFileHandle | null {
  return currentFileHandle;
}

// Session DEK for PRF-based passkey sessions (CryptoKey instead of password)
let sessionDEK: CryptoKey | null = null;
let sessionDEKSalt: Uint8Array | null = null;

/**
 * Set the session DEK for PRF-based passkey sessions.
 * When set, save() will use this key for encryption instead of the password.
 */
export function setSessionDEK(dek: CryptoKey | null, salt?: Uint8Array | null): void {
  sessionDEK = dek;
  sessionDEKSalt = salt ?? null;
}

/**
 * Get the current session DEK
 */
export function getSessionDEK(): CryptoKey | null {
  return sessionDEK;
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
    // Check encryption requirement via callback before saving
    if (isEncryptionRequiredFn && isEncryptionRequiredFn() && !sessionPassword && !sessionDEK) {
      console.warn(
        '[syncService] Auto-save skipped: encryption is enabled but no session password or DEK available'
      );
      return;
    }
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
 * If encryption is enabled but no session password is available,
 * the save is skipped to prevent writing plaintext.
 */
export async function flushPendingSave(): Promise<void> {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    // Guard: never write plaintext when encryption is required
    if (isEncryptionRequiredFn && isEncryptionRequiredFn() && !sessionPassword && !sessionDEK) {
      console.warn(
        '[syncService] Flush skipped: encryption is enabled but no session password or DEK available'
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
 * Fallback for openAndLoadFile when File System Access API is not available
 * (mobile browsers, Firefox, etc.). Uses <input type="file"> instead.
 * No file handle is stored, so auto-sync won't be available.
 */
async function openAndLoadFileFallback(): Promise<OpenFileResult> {
  try {
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
      return {
        success: false,
        needsPassword: true,
        fileHandle,
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

    // If we have a file handle, store it for persistent sync
    if (fileHandle) {
      await storeFileHandle(fileHandle);
      currentFileHandle = fileHandle;
      currentFileHandleFamilyId = activeFamilyId;
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

/**
 * Decrypt and import using a CryptoKey (passkey PRF path).
 * Same as decryptAndImport but uses a pre-derived DEK instead of a password.
 */
export async function decryptAndImportWithKey(
  fileHandle: FileSystemFileHandle,
  rawSyncData: SyncFileData,
  dek: CryptoKey
): Promise<{ success: boolean; error?: string; salt?: Uint8Array }> {
  updateState({ isSyncing: true, lastError: null });

  try {
    const encryptedData = rawSyncData.data as unknown as string;

    // Decrypt using the DEK directly
    const decryptedJson = await decryptDataWithKey(encryptedData, dek);
    const decryptedData = JSON.parse(decryptedJson);

    // Extract salt for future saves with the same key
    const salt = extractSaltFromEncrypted(encryptedData);

    const syncData: SyncFileData = {
      version: rawSyncData.version,
      exportedAt: rawSyncData.exportedAt,
      encrypted: false,
      data: decryptedData,
      familyId: rawSyncData.familyId,
      familyName: rawSyncData.familyName,
    };

    if (!validateSyncFileData(syncData)) {
      updateState({ isSyncing: false, lastError: 'Invalid data structure after decryption' });
      return { success: false, error: 'Invalid data structure after decryption' };
    }

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

    await importSyncFileData(syncData);

    await storeFileHandle(fileHandle);
    currentFileHandle = fileHandle;
    currentFileHandleFamilyId = activeFamilyId;

    updateState({
      isConfigured: true,
      fileName: fileHandle.name,
      isSyncing: false,
      lastError: null,
    });

    return { success: true, salt };
  } catch (e) {
    const errorMessage = (e as Error).message;
    if (errorMessage.includes('Incorrect key') || errorMessage.includes('corrupted')) {
      updateState({ isSyncing: false, lastError: 'Incorrect key' });
      return { success: false, error: 'Incorrect key' };
    }
    updateState({ isSyncing: false, lastError: errorMessage });
    return { success: false, error: errorMessage };
  }
}
