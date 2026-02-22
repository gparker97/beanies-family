import {
  exportAllData,
  importAllData,
  getActiveFamilyId,
  type ExportedData,
} from '@/services/indexeddb/database';
import { getFamilyById } from '@/services/familyContext';
import { getSettings } from '@/services/indexeddb/repositories/settingsRepository';
import type { SyncFileData } from '@/types/models';
import { SYNC_FILE_VERSION } from '@/types/models';
import { toISODateString } from '@/utils/date';

/**
 * Creates a SyncFileData object from current database state
 */
export async function createSyncFileData(encrypted = false): Promise<SyncFileData> {
  const data = await exportAllData();
  const syncData: SyncFileData = {
    version: SYNC_FILE_VERSION,
    exportedAt: toISODateString(new Date()),
    encrypted,
    data,
  };

  // v2.0: include family identity
  const familyId = getActiveFamilyId();
  if (familyId) {
    syncData.familyId = familyId;
    const family = await getFamilyById(familyId);
    if (family) {
      syncData.familyName = family.name;
    }
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

  // For unencrypted files, validate the full data structure
  if (!obj.data || typeof obj.data !== 'object') return false;

  const innerData = obj.data as Record<string, unknown>;

  // Check data arrays exist
  if (!Array.isArray(innerData.familyMembers)) return false;
  if (!Array.isArray(innerData.accounts)) return false;
  if (!Array.isArray(innerData.transactions)) return false;
  if (!Array.isArray(innerData.assets)) return false;
  if (!Array.isArray(innerData.goals)) return false;
  // settings can be null or object
  if (innerData.settings !== null && typeof innerData.settings !== 'object') return false;
  // recurringItems is optional for backward compatibility with older sync files
  if (innerData.recurringItems !== undefined && !Array.isArray(innerData.recurringItems))
    return false;

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
 * Imports data from a SyncFileData object into the database
 */
export async function importSyncFileData(syncFile: SyncFileData): Promise<void> {
  if (!validateSyncFileData(syncFile)) {
    throw new Error('Invalid sync file format');
  }

  // Read local-only preferences before import overwrites them
  const localSettings = await getSettings();
  const localPreferredCurrencies = localSettings.preferredCurrencies;

  // Remove sync-related settings from imported data to preserve local sync config
  const importData: ExportedData = {
    ...syncFile.data,
    settings: syncFile.data.settings
      ? {
          ...syncFile.data.settings,
          // Preserve these fields from local settings (don't overwrite sync config)
          syncFilePath: undefined,
          lastSyncTimestamp: undefined,
          // Preserve local-only UI preferences
          preferredCurrencies: localPreferredCurrencies,
        }
      : null,
  };

  await importAllData(importData);
}

/**
 * Opens a file picker for selecting a .beanpod or .json file (fallback)
 */
export function openFilePicker(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.beanpod,.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Full export flow: create sync data and download as file
 */
export async function exportToFile(filename?: string): Promise<void> {
  const syncData = await createSyncFileData(false);
  downloadAsFile(syncData, filename);
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
