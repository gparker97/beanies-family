import {
  exportAllData,
  importAllData,
  getActiveFamilyId,
  type ExportedData,
} from '@/services/indexeddb/database';
import { getFamilyById } from '@/services/familyContext';
import { getSettings } from '@/services/indexeddb/repositories/settingsRepository';
import { mergeData } from '@/services/sync/mergeService';
import { useTombstoneStore } from '@/stores/tombstoneStore';
import type { SyncFileData, DeletionTombstone, PasskeySecret } from '@/types/models';
import { SYNC_FILE_VERSION } from '@/types/models';
import { toISODateString } from '@/utils/date';

interface MergeableRecord {
  id: string;
  updatedAt: string;
}

/**
 * Compares the merged result against the file data to determine if the merge
 * incorporated any local data that the file doesn't already have.
 * Used to decide whether a save-back is needed after merge (avoids echo loops).
 */
function detectMergeChanges(
  mergedData: ExportedData,
  fileData: ExportedData,
  mergedTombstones: DeletionTombstone[],
  fileTombstones: DeletionTombstone[]
): boolean {
  const collections = [
    'familyMembers',
    'accounts',
    'transactions',
    'assets',
    'goals',
    'recurringItems',
    'todos',
    'activities',
    'budgets',
  ] as const;

  for (const key of collections) {
    const merged = (mergedData[key] ?? []) as unknown as MergeableRecord[];
    const file = (fileData[key] ?? []) as unknown as MergeableRecord[];
    if (merged.length !== file.length) return true;

    const fileMap = new Map(file.map((r) => [r.id, r.updatedAt]));
    for (const r of merged) {
      if (fileMap.get(r.id) !== r.updatedAt) return true;
    }
  }

  if (mergedTombstones.length !== fileTombstones.length) return true;

  // Settings are intentionally excluded — settings differences (e.g. from
  // saveSettings calls or WAL recovery) should NOT trigger a save-back.
  // Settings-triggered save-backs create a near-permanent echo loop where
  // each browser's save updates lastSync, masking the other browser's edits
  // within the checkForConflicts tolerance window.

  return false;
}

/**
 * Creates a SyncFileData object from current database state
 */
export async function createSyncFileData(
  encrypted = false,
  passkeySecrets?: PasskeySecret[]
): Promise<SyncFileData> {
  const data = await exportAllData();

  // Inject tombstones from the in-memory store into the export
  const tombstoneStore = useTombstoneStore();
  data.deletions = tombstoneStore.getTombstones();

  const syncData: SyncFileData = {
    version: SYNC_FILE_VERSION,
    exportedAt: toISODateString(new Date()),
    encrypted,
    data,
  };

  // Include family identity
  const familyId = getActiveFamilyId();
  if (familyId) {
    syncData.familyId = familyId;
    const family = await getFamilyById(familyId);
    if (family) {
      syncData.familyName = family.name;
    }
  }

  // Include PRF-wrapped password secrets in the envelope (outside encryption)
  if (passkeySecrets && passkeySecrets.length > 0) {
    syncData.passkeySecrets = passkeySecrets;
  }

  return syncData;
}

/**
 * Validates that the data has the correct structure for import
 */
export function validateSyncFileData(data: unknown): data is SyncFileData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check required top-level fields
  if (typeof obj.version !== 'string') return false;
  if (typeof obj.exportedAt !== 'string') return false;
  if (typeof obj.encrypted !== 'boolean') return false;

  // For encrypted files, the data field is a base64 string (not an object)
  if (obj.encrypted === true) {
    return typeof obj.data === 'string';
  }

  // Reject v2.0 and older files — v3.0 is a clean break (no prod data to migrate)
  if (obj.version !== '3.0') {
    console.warn(
      `[fileSync] Unsupported sync file version "${obj.version}". Please re-create your data file with the current app version.`
    );
    return false;
  }

  // For unencrypted files, validate the full data structure
  if (!obj.data || typeof obj.data !== 'object') return false;

  const innerData = obj.data as Record<string, unknown>;

  // Check data arrays exist
  if (!Array.isArray(innerData.familyMembers)) return false;
  if (!Array.isArray(innerData.accounts)) return false;
  if (!Array.isArray(innerData.transactions)) return false;
  if (!Array.isArray(innerData.assets)) return false;
  if (!Array.isArray(innerData.goals)) return false;
  // deletions required in v3.0
  if (!Array.isArray(innerData.deletions)) return false;
  // settings can be null or object
  if (innerData.settings !== null && typeof innerData.settings !== 'object') return false;
  // recurringItems is optional for backward compatibility with older sync files
  if (innerData.recurringItems !== undefined && !Array.isArray(innerData.recurringItems))
    return false;
  // todos is optional for backward compatibility with older sync files
  if (innerData.todos !== undefined && !Array.isArray(innerData.todos)) return false;
  // activities is optional for backward compatibility with older sync files
  if (innerData.activities !== undefined && !Array.isArray(innerData.activities)) return false;
  // budgets is optional for backward compatibility with older sync files
  if (innerData.budgets !== undefined && !Array.isArray(innerData.budgets)) return false;

  return true;
}

/**
 * Downloads data as a .beanpod file (fallback for browsers without File System Access API)
 */
export function downloadAsFile(data: SyncFileData, filename?: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().split('T')[0];
  const defaultFilename = `my-family-${date}.beanpod`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Reads and parses a JSON file selected by the user
 */
export async function readFileAsJson(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        resolve(json);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Imports data from a SyncFileData object into the database.
 * @param options.merge - If true, merge file data with local data by record ID.
 *   Used for cross-device reload (polling/visibility). If false (default),
 *   full-replace for initial load (empty local → load from file).
 */
export async function importSyncFileData(
  syncFile: SyncFileData,
  options: { merge?: boolean } = {}
): Promise<{ hasLocalChanges: boolean }> {
  if (!validateSyncFileData(syncFile)) {
    throw new Error('Invalid sync file format');
  }

  // Read local-only preferences before import overwrites them
  const localSettings = await getSettings();

  // Clean incoming settings to preserve local sync config
  const cleanedFileData: ExportedData = {
    ...syncFile.data,
    settings: syncFile.data.settings
      ? {
          ...syncFile.data.settings,
          // Preserve these fields from local settings (don't overwrite sync config)
          syncFilePath: undefined,
          lastSyncTimestamp: undefined,
          // Preserve local encryption setting — never import this from the file,
          // as it could propagate a corrupted false value from a buggy session
          encryptionEnabled: localSettings.encryptionEnabled,
        }
      : null,
  };

  if (options.merge) {
    // Record-level merge: export local data, merge with file data, import result
    const localData = await exportAllData();
    const tombstoneStore = useTombstoneStore();
    const localTombstones = tombstoneStore.getTombstones();
    const fileTombstones = syncFile.data.deletions ?? [];

    const { data: mergedData, tombstones: mergedTombstones } = mergeData(
      localData,
      cleanedFileData,
      localTombstones,
      fileTombstones
    );

    // Preserve local sync-specific settings in the merged result
    if (mergedData.settings && localSettings) {
      mergedData.settings.syncFilePath = undefined;
      mergedData.settings.lastSyncTimestamp = undefined;
      mergedData.settings.encryptionEnabled = localSettings.encryptionEnabled;
    }

    // Check if the merge incorporated any local data the file doesn't have
    const hasLocalChanges = detectMergeChanges(
      mergedData,
      cleanedFileData,
      mergedTombstones,
      fileTombstones
    );

    await importAllData(mergedData);
    tombstoneStore.setTombstones(mergedTombstones);
    return { hasLocalChanges };
  } else {
    // Full replace: initial load path
    await importAllData(cleanedFileData);

    // Hydrate tombstone store from file
    const tombstoneStore = useTombstoneStore();
    tombstoneStore.setTombstones(syncFile.data.deletions ?? []);
    return { hasLocalChanges: false };
  }
}

/**
 * Opens a file picker for selecting a .beanpod or .json file (fallback)
 */
export function openFilePicker(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Mobile browsers don't recognise .beanpod (no registered MIME type),
    // so we accept all files and validate the extension at runtime instead.
    input.accept = '';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Full export flow: create sync data and download as file.
 * If a password is provided, the exported file will be encrypted.
 */
export async function exportToFile(filename?: string, password?: string): Promise<void> {
  if (password) {
    const syncData = await createSyncFileData(true);
    const dataJson = JSON.stringify(syncData.data);
    const { encryptSyncData } = await import('@/services/crypto/encryption');
    const encryptedData = await encryptSyncData(dataJson, password);
    const encryptedSyncData: SyncFileData = {
      version: syncData.version,
      exportedAt: syncData.exportedAt,
      encrypted: true,
      data: encryptedData as unknown as ExportedData,
      familyId: syncData.familyId,
      familyName: syncData.familyName,
    };
    downloadAsFile(encryptedSyncData, filename);
  } else {
    const syncData = await createSyncFileData(false);
    downloadAsFile(syncData, filename);
  }
}

/**
 * Full import flow: open picker, read file, validate, import
 */
export async function importFromFile(): Promise<{ success: boolean; error?: string }> {
  try {
    const file = await openFilePicker();
    if (!file) {
      return { success: false, error: 'No file selected' };
    }

    const data = await readFileAsJson(file);

    if (!validateSyncFileData(data)) {
      return { success: false, error: 'Invalid sync file format' };
    }

    if (data.encrypted) {
      return { success: false, error: 'Encrypted files not supported in basic import' };
    }

    await importSyncFileData(data);
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
