/**
 * Record-level merge for cross-device sync.
 *
 * Instead of full-replace (last writer wins for the whole file), this merges
 * individual records by ID using `updatedAt` timestamps to resolve conflicts.
 * Deletion tombstones prevent merge from re-adding deliberately deleted records.
 */
import type { ExportedData } from '@/services/indexeddb/database';
import type { DeletionTombstone, Settings } from '@/types/models';

/** Any record with an `id` and `updatedAt` timestamp. */
interface MergeableRecord {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Merge two arrays of records by ID.
 * For each unique ID:
 * - If tombstoned (and tombstone is newer than both copies) → skip (deleted)
 * - If both sides have it → keep the one with the newer `updatedAt`
 * - If only one side has it → keep it (added on that device)
 */
export function mergeRecords<T extends MergeableRecord>(
  localRecords: T[],
  fileRecords: T[],
  tombstoneMap: Map<string, DeletionTombstone>
): T[] {
  const localMap = new Map(localRecords.map((r) => [r.id, r]));
  const fileMap = new Map(fileRecords.map((r) => [r.id, r]));

  // Union of all IDs from both sides
  const allIds = new Set([...localMap.keys(), ...fileMap.keys()]);
  const result: T[] = [];

  for (const id of allIds) {
    const tombstone = tombstoneMap.get(id);
    const local = localMap.get(id);
    const file = fileMap.get(id);

    // If tombstoned and the tombstone is newer than both copies → stay deleted
    if (tombstone) {
      const tombTime = new Date(tombstone.deletedAt).getTime();
      const localTime = local ? new Date(local.updatedAt).getTime() : 0;
      const fileTime = file ? new Date(file.updatedAt).getTime() : 0;

      if (tombTime >= localTime && tombTime >= fileTime) {
        continue; // Deleted on one device, don't resurrect
      }
      // Record was re-created after deletion — fall through to normal merge
    }

    if (local && file) {
      // Both exist — keep newer
      const localTime = new Date(local.updatedAt).getTime();
      const fileTime = new Date(file.updatedAt).getTime();
      result.push(fileTime > localTime ? file : local);
    } else if (local) {
      result.push(local);
    } else if (file) {
      result.push(file);
    }
  }

  return result;
}

/**
 * Merge settings: singleton last-write-wins by `updatedAt`.
 */
export function mergeSettings(
  localSettings: Settings | null,
  fileSettings: Settings | null
): Settings | null {
  if (!localSettings) return fileSettings;
  if (!fileSettings) return localSettings;

  const localTime = new Date(localSettings.updatedAt).getTime();
  const fileTime = new Date(fileSettings.updatedAt).getTime();
  return fileTime > localTime ? fileSettings : localSettings;
}

/**
 * Merge tombstone arrays from both sides.
 * Keeps the newest tombstone per ID and prunes entries older than 30 days.
 */
export function mergeTombstones(
  localTombstones: DeletionTombstone[],
  fileTombstones: DeletionTombstone[]
): DeletionTombstone[] {
  const map = new Map<string, DeletionTombstone>();

  // Process all tombstones, keeping newest per ID
  for (const t of [...localTombstones, ...fileTombstones]) {
    const existing = map.get(t.id);
    if (!existing || new Date(t.deletedAt) > new Date(existing.deletedAt)) {
      map.set(t.id, t);
    }
  }

  // Prune entries older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const result: DeletionTombstone[] = [];
  for (const t of map.values()) {
    if (new Date(t.deletedAt).getTime() >= cutoff) {
      result.push(t);
    }
  }

  return result;
}

/**
 * Build a tombstone lookup map from an array of tombstones.
 */
function buildTombstoneMap(tombstones: DeletionTombstone[]): Map<string, DeletionTombstone> {
  const map = new Map<string, DeletionTombstone>();
  for (const t of tombstones) {
    const existing = map.get(t.id);
    if (!existing || new Date(t.deletedAt) > new Date(existing.deletedAt)) {
      map.set(t.id, t);
    }
  }
  return map;
}

/**
 * Merge two complete ExportedData snapshots using record-level merge.
 * Returns the merged data and merged tombstones.
 */
export function mergeData(
  localData: ExportedData,
  fileData: ExportedData,
  localTombstones: DeletionTombstone[],
  fileTombstones: DeletionTombstone[]
): { data: ExportedData; tombstones: DeletionTombstone[] } {
  // Merge tombstones first (used to filter records)
  const mergedTombstones = mergeTombstones(localTombstones, fileTombstones);
  const tombstoneMap = buildTombstoneMap(mergedTombstones);

  const merged: ExportedData = {
    familyMembers: mergeRecords(localData.familyMembers, fileData.familyMembers, tombstoneMap),
    accounts: mergeRecords(localData.accounts, fileData.accounts, tombstoneMap),
    transactions: mergeRecords(localData.transactions, fileData.transactions, tombstoneMap),
    assets: mergeRecords(localData.assets, fileData.assets, tombstoneMap),
    goals: mergeRecords(localData.goals, fileData.goals, tombstoneMap),
    recurringItems: mergeRecords(
      localData.recurringItems ?? [],
      fileData.recurringItems ?? [],
      tombstoneMap
    ),
    todos: mergeRecords(localData.todos ?? [], fileData.todos ?? [], tombstoneMap),
    deletions: mergedTombstones,
    settings: mergeSettings(localData.settings, fileData.settings),
  };

  return { data: merged, tombstones: mergedTombstones };
}
