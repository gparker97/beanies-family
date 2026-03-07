/**
 * Sync Service — low-level sync engine with storage provider abstraction.
 *
 * V4 architecture: the Automerge document is the source of truth in memory.
 * This service handles reading/writing the encrypted .beanpod V4 envelope
 * to/from the storage provider (local file or Google Drive).
 *
 * The family key (AES-256-GCM) encrypts the payload — no more password-based
 * encryption at the sync layer. The syncStore manages the family key lifecycle.
 */

import { supportsFileSystemAccess } from './capabilities';
import { getFileHandle, verifyPermission, getProviderConfig } from './fileHandleStore';
import { GoogleDriveProvider } from './providers/googleDriveProvider';
import {
  parseBeanpodV4,
  reEncryptEnvelope,
  openFilePicker,
  detectFileVersion,
  decryptBeanpodPayload,
} from './fileSync';
import { mergeDoc } from '@/services/automerge/docService';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { createFamilyWithId } from '@/services/familyContext';
import { onDocPersistNeeded } from '@/services/automerge/docService';
import { persistDoc, persistEnvelope, isCacheReady } from '@/services/automerge/persistenceService';
import type { StorageProvider, StorageProviderType } from './storageProvider';
import { LocalStorageProvider } from './providers/localProvider';
import { DriveApiError } from '@/services/google/driveService';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

// Result type for openAndLoadFile
export interface OpenFileResult {
  success: boolean;
  envelope?: BeanpodFileV4;
  needsPassword?: boolean;
  fileHandle?: FileSystemFileHandle;
  provider?: StorageProvider;
  rawText?: string; // raw file text for V3 fallback detection
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

// Write mutex — prevents concurrent save() calls from interleaving writes
let saveInProgress: Promise<boolean> | null = null;

// Current storage provider (in-memory for session) and the family it belongs to
let currentProvider: StorageProvider | null = null;
let currentProviderFamilyId: string | null = null;

// Family key + envelope — set by syncStore after unlock
let currentFamilyKey: CryptoKey | null = null;
let currentEnvelope: BeanpodFileV4 | null = null;

// Drive-reported modifiedTime of the last file we read or wrote
let lastKnownFileTimestamp: string | null = null;

// When true, mergeDoc → schedulePersist → triggerDebouncedSave is suppressed
// (we're already inside doSave, so scheduling another save would be redundant)
let suppressAutoSave = false;

// Callbacks for state changes
type StateCallback = (state: SyncServiceState) => void;
const stateCallbacks: StateCallback[] = [];

// Callbacks for save completion (timestamp updates)
type SaveCompleteCallback = (timestamp: string) => void;
const saveCompleteCallbacks: SaveCompleteCallback[] = [];

// --- Save failure tracking ---
export type SaveFailureLevel = 'none' | 'warning' | 'critical';
type SaveFailureCallback = (level: SaveFailureLevel, error: string | null) => void;
const saveFailureCallbacks: SaveFailureCallback[] = [];

let consecutiveFailures = 0;
let lastSaveError: string | null = null;
let saveFailureLevel: SaveFailureLevel = 'none';

function updateSaveFailureLevel(): void {
  const prev = saveFailureLevel;
  if (consecutiveFailures === 0) {
    saveFailureLevel = 'none';
  } else if (consecutiveFailures < 3) {
    saveFailureLevel = 'warning';
  } else {
    saveFailureLevel = 'critical';
  }
  if (saveFailureLevel !== prev) {
    saveFailureCallbacks.forEach((cb) => cb(saveFailureLevel, lastSaveError));
  }
}

function recordSaveSuccess(): void {
  consecutiveFailures = 0;
  lastSaveError = null;
  updateSaveFailureLevel();
}

function recordSaveFailure(error: string): void {
  consecutiveFailures++;
  lastSaveError = error;
  updateSaveFailureLevel();
}

/** Get the current save failure level. */
export function getSaveFailureLevel(): SaveFailureLevel {
  return saveFailureLevel;
}

/** Get the last save error message. */
export function getLastSaveError(): string | null {
  return lastSaveError;
}

/** Reset save failure state (call after successful reconnect). */
export function resetSaveFailures(): void {
  consecutiveFailures = 0;
  lastSaveError = null;
  updateSaveFailureLevel();
}

/** Subscribe to save failure level changes. Returns unsubscribe function. */
export function onSaveFailureChange(callback: SaveFailureCallback): () => void {
  saveFailureCallbacks.push(callback);
  return () => {
    const index = saveFailureCallbacks.indexOf(callback);
    if (index > -1) saveFailureCallbacks.splice(index, 1);
  };
}

// --- Cache persistence failure tracking ---
let cachePersistFailed = false;
type CacheFailureCallback = (failed: boolean) => void;
const cacheFailureCallbacks: CacheFailureCallback[] = [];

function setCachePersistFailed(failed: boolean): void {
  if (cachePersistFailed !== failed) {
    cachePersistFailed = failed;
    cacheFailureCallbacks.forEach((cb) => cb(failed));
  }
}

export function isCachePersistFailed(): boolean {
  return cachePersistFailed;
}

export function onCacheFailureChange(callback: CacheFailureCallback): () => void {
  cacheFailureCallbacks.push(callback);
  return () => {
    const idx = cacheFailureCallbacks.indexOf(callback);
    if (idx > -1) cacheFailureCallbacks.splice(idx, 1);
  };
}

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
 * Register a callback invoked after every successful save with the file's timestamp.
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
 * Get the current storage provider
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
 * Set the family key and envelope for the current session.
 * Called by syncStore after successful unlock.
 */
export function setFamilyKey(familyKey: CryptoKey, envelope: BeanpodFileV4): void {
  currentFamilyKey = familyKey;
  currentEnvelope = envelope;
}

/**
 * Get the current family key (if set).
 */
export function getFamilyKey(): CryptoKey | null {
  return currentFamilyKey;
}

/**
 * Get the current envelope (if set).
 */
export function getEnvelope(): BeanpodFileV4 | null {
  return currentEnvelope;
}

/**
 * Update the current envelope (e.g. after adding a new wrapped key).
 */
export function setEnvelope(envelope: BeanpodFileV4): void {
  currentEnvelope = envelope;
}

/**
 * Set the last known file timestamp (called by syncStore after loading).
 * Prevents the next doSave() from re-fetching what was just loaded.
 */
export function setLastKnownFileTimestamp(timestamp: string | null): void {
  lastKnownFileTimestamp = timestamp;
}

/**
 * Get the current session file handle (for reading encrypted blob during passkey registration).
 */
export function getSessionFileHandle(): FileSystemFileHandle | null {
  if (currentProvider instanceof LocalStorageProvider) {
    return currentProvider.getHandle();
  }
  return null;
}

/**
 * Reset the sync service state.
 */
export function reset(): void {
  cancelPendingSave();
  currentProvider = null;
  currentProviderFamilyId = null;
  currentFamilyKey = null;
  currentEnvelope = null;
  lastKnownFileTimestamp = null;
  resetSaveFailures();
  setCachePersistFailed(false);
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
 */
export async function initialize(): Promise<boolean> {
  reset();

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
          config.driveFileName,
          config.driveAccountEmail
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
 * Request permission to use the stored file handle (user gesture required)
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
 * Open file picker to select/create a sync file (user gesture required)
 */
export async function selectSyncFile(): Promise<boolean> {
  if (!supportsFileSystemAccess()) {
    updateState({ lastError: 'File System Access API not supported' });
    return false;
  }

  try {
    const provider = await LocalStorageProvider.fromSavePicker();
    if (!provider) return false;

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
    if ((e as Error).name === 'AbortError') {
      return false;
    }
    updateState({ lastError: (e as Error).message });
    return false;
  }
}

/**
 * Save the current Automerge document to the sync file.
 * Encrypts with the family key and writes the V4 envelope.
 */
export async function save(): Promise<boolean> {
  if (saveInProgress) {
    try {
      await saveInProgress;
    } catch {
      // Previous save failed — proceed with ours
    }
  }

  const promise = doSave();
  saveInProgress = promise;

  try {
    return await promise;
  } finally {
    if (saveInProgress === promise) {
      saveInProgress = null;
    }
  }
}

/**
 * Fetch remote file from Drive and merge into local doc if it has changed.
 * Called by doSave() before writing to prevent overwriting remote changes.
 * Only applies to Google Drive provider (local files don't have this race).
 */
async function fetchAndMergeRemote(): Promise<void> {
  if (!currentProvider || currentProvider.type !== 'google_drive') return;
  if (!currentFamilyKey || !currentEnvelope) return;

  // Fast path: check if remote has changed since we last read/wrote
  const remoteTimestamp = await currentProvider.getLastModified();
  if (
    !remoteTimestamp ||
    (lastKnownFileTimestamp &&
      new Date(remoteTimestamp).getTime() <= new Date(lastKnownFileTimestamp).getTime())
  ) {
    return; // No change — skip the full read
  }

  // Remote has newer data — fetch, decrypt, and merge
  const text = await currentProvider.read();
  if (!text) return;

  const remoteEnvelope = parseBeanpodV4(text);
  const remoteDoc = await decryptBeanpodPayload(remoteEnvelope, currentFamilyKey);

  // Suppress auto-save during merge to avoid re-entrant save scheduling
  suppressAutoSave = true;
  try {
    mergeDoc(remoteDoc);
  } finally {
    suppressAutoSave = false;
  }

  // Update envelope with remote's key material (may have new wrapped keys).
  // Merge local-only envelope fields (inviteKeys, wrappedKeys, passkeySecrets)
  // into the remote envelope to avoid losing locally-added keys when the remote
  // file was written before the local change (e.g. invite generated between saves).
  if (currentEnvelope) {
    if (currentEnvelope.inviteKeys) {
      remoteEnvelope.inviteKeys = { ...currentEnvelope.inviteKeys, ...remoteEnvelope.inviteKeys };
    }
    if (currentEnvelope.wrappedKeys) {
      remoteEnvelope.wrappedKeys = {
        ...currentEnvelope.wrappedKeys,
        ...remoteEnvelope.wrappedKeys,
      };
    }
    if (currentEnvelope.passkeyWrappedKeys) {
      remoteEnvelope.passkeyWrappedKeys = {
        ...currentEnvelope.passkeyWrappedKeys,
        ...remoteEnvelope.passkeyWrappedKeys,
      };
    }
  }
  currentEnvelope = remoteEnvelope;
  lastKnownFileTimestamp = remoteTimestamp;
}

/**
 * Internal save implementation
 */
async function doSave(): Promise<boolean> {
  if (!currentProvider) {
    updateState({ lastError: 'No file configured' });
    return false;
  }

  if (!currentFamilyKey || !currentEnvelope) {
    console.warn('[syncService] save() blocked: no family key or envelope set');
    return false;
  }

  // Guard: ensure provider belongs to the active family
  const activeFamilyId = getActiveFamilyId();
  if (currentProviderFamilyId && activeFamilyId && currentProviderFamilyId !== activeFamilyId) {
    console.warn(
      `[syncService] save() blocked: provider belongs to family ${currentProviderFamilyId} but active family is ${activeFamilyId}`
    );
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

    // Fetch-merge-save: merge any remote changes before writing to prevent overwrites.
    // Non-fatal — if merge fails, we still save local state (better than losing it).
    try {
      await fetchAndMergeRemote();
    } catch (e) {
      console.warn('[syncService] fetchAndMergeRemote failed (non-fatal):', e);
    }

    // Re-encrypt the Automerge doc with the family key and update the envelope
    const fileContent = await reEncryptEnvelope(currentEnvelope, currentFamilyKey);

    // Write via the storage provider abstraction
    await currentProvider.write(fileContent);

    // Update timestamp after successful write
    try {
      const postWriteTimestamp = await currentProvider.getLastModified();
      if (postWriteTimestamp) {
        lastKnownFileTimestamp = postWriteTimestamp;
      }
    } catch {
      // Non-critical — worst case we re-fetch on next save
    }

    updateState({ isSyncing: false, lastError: null });

    // Track save success
    recordSaveSuccess();

    // Notify subscribers of save timestamp
    const timestamp = new Date().toISOString();
    saveCompleteCallbacks.forEach((cb) => cb(timestamp));

    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    updateState({ isSyncing: false, lastError: errorMsg });
    recordSaveFailure(errorMsg);
    return false;
  }
}

/**
 * Get the timestamp from the sync file (lightweight check for polling)
 */
export async function getFileTimestamp(): Promise<string | null> {
  if (!currentProvider) {
    return null;
  }
  return currentProvider.getLastModified();
}

/**
 * Load the raw file content from the storage provider.
 * Returns the raw text, or null if the file is empty/missing.
 */
export async function load(): Promise<string | null> {
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

    const text = await currentProvider.read();

    if (!text) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }

    // Track the file's timestamp so doSave() can detect remote changes
    try {
      const fileTs = await currentProvider.getLastModified();
      if (fileTs) lastKnownFileTimestamp = fileTs;
    } catch {
      // Non-critical
    }

    updateState({ isSyncing: false, lastError: null });
    return text;
  } catch (e) {
    if ((e as Error).name === 'NotFoundError' || (e as Error).message.includes('JSON')) {
      updateState({ isSyncing: false, lastError: null });
      return null;
    }
    if (e instanceof DriveApiError && e.status === 404) {
      updateState({ isSyncing: false, lastError: `DriveApiError:404:${(e as Error).message}` });
      return null;
    }
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return null;
  }
}

/**
 * Load file and parse as V4 envelope.
 * Returns the envelope (caller decrypts with family key), or flags for needsPassword.
 */
export async function loadAndParseV4(): Promise<{
  success: boolean;
  envelope?: BeanpodFileV4;
  needsPassword?: boolean;
  fileNotFound?: boolean;
}> {
  const text = await load();
  if (!text) {
    const lastError = getState().lastError;
    if (lastError?.startsWith('DriveApiError:404:')) {
      return { success: false, fileNotFound: true };
    }
    return { success: false };
  }

  try {
    const envelope = parseBeanpodV4(text);

    // Guard: familyId must match active family
    let activeFamilyId = getActiveFamilyId();
    if (envelope.familyId && activeFamilyId && envelope.familyId !== activeFamilyId) {
      console.warn(
        `[syncService] File familyId (${envelope.familyId}) does not match active family (${activeFamilyId}). Skipping.`
      );
      updateState({ lastError: 'Sync file belongs to a different family', isConfigured: false });
      return { success: false };
    }

    // If no active family, adopt from file
    if (!activeFamilyId && envelope.familyId) {
      await createFamilyWithId(envelope.familyId, envelope.familyName ?? 'My Family');
      activeFamilyId = envelope.familyId;
    }

    // File is V4 and encrypted — needs family key to decrypt
    return { success: true, envelope, needsPassword: true };
  } catch (e) {
    updateState({ lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Open file picker to select an existing sync file, read it, and configure as sync target.
 */
export async function openAndLoadFile(): Promise<OpenFileResult> {
  cancelPendingSave();

  if (!supportsFileSystemAccess()) {
    return openAndLoadFileFallback();
  }

  try {
    const handles = await window.showOpenFilePicker({ multiple: false });
    const handle = handles[0];
    if (!handle) return { success: false };

    const provider = LocalStorageProvider.fromHandle(handle);
    updateState({ isSyncing: true, lastError: null });

    const text = await provider.read();
    if (!text) {
      updateState({ isSyncing: false, lastError: 'File is empty' });
      return { success: false };
    }

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        fileHandle: handle,
        provider,
        envelope,
      };
    }

    // V3 or unknown format
    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
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
 */
async function openAndLoadFileFallback(): Promise<OpenFileResult> {
  try {
    cancelPendingSave();
    const file = await openFilePicker();
    if (!file) return { success: false };

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

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        envelope,
      };
    }

    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Load a file that was dropped onto the drop zone (drag-and-drop).
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

    const version = detectFileVersion(text);

    if (version === '4.0') {
      const envelope = parseBeanpodV4(text);
      const provider = fileHandle ? LocalStorageProvider.fromHandle(fileHandle) : undefined;
      updateState({ isSyncing: false, lastError: null });
      return {
        success: false,
        needsPassword: true,
        fileHandle,
        provider,
        envelope,
      };
    }

    updateState({
      isSyncing: false,
      lastError: `Unsupported file version: ${version ?? 'unknown'}`,
    });
    return { success: false, rawText: text };
  } catch (e) {
    updateState({ isSyncing: false, lastError: (e as Error).message });
    return { success: false };
  }
}

/**
 * Register the docService persist callback to trigger debounced saves.
 * Called once at startup by syncStore.
 *
 * Also updates the local IndexedDB persistence cache on every change,
 * ensuring the cache is always fresh for fast startup on page refresh.
 */
export function registerDocPersistCallback(): void {
  onDocPersistNeeded(() => {
    // Update local persistence cache immediately (fire-and-forget).
    // This ensures the cache survives page refresh even if the file
    // save (below) hasn't completed yet.
    if (currentFamilyKey && isCacheReady()) {
      persistDoc(currentFamilyKey)
        .then(() => setCachePersistFailed(false))
        .catch((err) => {
          console.warn('[syncService] persistDoc failed:', err);
          setCachePersistFailed(true);
        });
      if (currentEnvelope) {
        persistEnvelope(currentEnvelope).catch((err) => {
          console.warn('[syncService] persistEnvelope failed:', err);
        });
      }
    }

    // Schedule file save (debounced, slower)
    triggerDebouncedSave();
  });
}

/**
 * Trigger a debounced save (for auto-sync).
 */
export function triggerDebouncedSave(): void {
  // When merging inside doSave(), suppress redundant save scheduling
  if (suppressAutoSave) return;

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    if (!currentFamilyKey || !currentEnvelope) {
      console.warn('[syncService] Auto-save skipped: no family key or envelope');
      return;
    }
    save().catch((err) => {
      console.warn('[syncService] Auto-save failed:', err);
      recordSaveFailure((err as Error).message ?? 'Auto-save failed');
    });
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending debounced save and perform an immediate save.
 */
export async function saveNow(): Promise<boolean> {
  cancelPendingSave();
  if (!currentFamilyKey || !currentEnvelope) {
    console.warn('[syncService] saveNow skipped: no family key or envelope');
    return false;
  }
  return save();
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
 */
export async function flushPendingSave(): Promise<void> {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    if (!currentFamilyKey || !currentEnvelope) {
      console.warn('[syncService] Flush skipped: no family key or envelope');
      return;
    }
    await save();
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
  currentFamilyKey = null;
  currentEnvelope = null;
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
