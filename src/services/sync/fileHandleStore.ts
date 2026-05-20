import { openDB, type IDBPDatabase } from 'idb';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { reportError } from '@/utils/errorReporter';
import type { StorageProviderType } from './storageProvider';

const HANDLE_DB_NAME = 'beanies-file-handles';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = 'handles';

// Provider config persistence — stores which backend a family uses
export interface PersistedProviderConfig {
  type: StorageProviderType;
  driveFileId?: string;
  driveFileName?: string;
  driveAccountEmail?: string;
}

interface HandleDB {
  handles: {
    key: string;
    value: FileSystemFileHandle;
  };
}

let handleDb: IDBPDatabase<HandleDB> | null = null;

async function getHandleDatabase(): Promise<IDBPDatabase<HandleDB>> {
  if (handleDb) {
    return handleDb;
  }

  handleDb = await openDB<HandleDB>(HANDLE_DB_NAME, HANDLE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    },
  });

  return handleDb;
}

/**
 * Get the storage key for the current family's sync file handle.
 */
function getSyncFileKey(): string {
  const familyId = getActiveFamilyId();
  if (!familyId) throw new Error('No active family — cannot access sync file handle');
  return `syncFile-${familyId}`;
}

/**
 * Store a file handle for later retrieval
 */
export async function storeFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await getHandleDatabase();
  await db.put(HANDLE_STORE, handle, getSyncFileKey());
}

/**
 * Retrieve the stored file handle for the current family.
 * Only returns a handle stored under the family-specific key.
 */
export async function getFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await getHandleDatabase();
    const key = getSyncFileKey();
    const handle = await db.get(HANDLE_STORE, key);
    console.log('[fileHandleStore] getFileHandle key:', key, 'found:', !!handle);
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear the stored file handle
 */
export async function clearFileHandle(): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, getSyncFileKey());
}

/**
 * Clear the stored file handle for a specific family by ID.
 * Used when switching providers (e.g. local → Google Drive) to prevent
 * stale local handles from being restored on page refresh.
 */
export async function clearFileHandleForFamily(familyId: string): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, `syncFile-${familyId}`);
}

/**
 * Check if we have permission to read/write the file
 */
export async function verifyPermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  const options = { mode };

  // Check if permission is already granted
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  // Request permission from user
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/**
 * Check if we have a stored handle and permission to use it
 */
export async function hasValidFileHandle(): Promise<boolean> {
  const handle = await getFileHandle();
  if (!handle) {
    return false;
  }

  // Just check if permission is granted (don't request)
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted';
  } catch {
    return false;
  }
}

// --- Provider config persistence ---

/**
 * Store provider config for a family (e.g. google_drive with fileId)
 */
export async function storeProviderConfig(
  familyId: string,
  config: PersistedProviderConfig
): Promise<void> {
  const db = await getHandleDatabase();
  await db.put(
    HANDLE_STORE,
    config as unknown as FileSystemFileHandle,
    `providerConfig-${familyId}`
  );
}

/**
 * Retrieve the stored provider config for a family
 */
export async function getProviderConfig(familyId: string): Promise<PersistedProviderConfig | null> {
  try {
    const db = await getHandleDatabase();
    const config = await db.get(HANDLE_STORE, `providerConfig-${familyId}`);
    if (config && typeof config === 'object' && 'type' in config) {
      return config as unknown as PersistedProviderConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear the stored provider config for a family
 */
export async function clearProviderConfig(familyId: string): Promise<void> {
  const db = await getHandleDatabase();
  await db.delete(HANDLE_STORE, `providerConfig-${familyId}`);
}

// --- Google OAuth refresh token persistence ---
// Dual-write: IndexedDB (primary) + localStorage (fallback).
// On PWA/mobile, IndexedDB can be evicted under storage pressure or
// iOS Safari's 7-day eviction policy. localStorage has different eviction
// characteristics and serves as a redundant backup.
//
// Storage shape: IDB stores `StoredRefreshToken { token, issuedAt }` so the
// invalid_grant alert path can surface a `refresh_token_age_ms` diagnostic
// (added 2026-05-20 — see `googleAuth.performSilentRefresh` and
// `silentRefreshAlertContext`). Legacy bare-string entries are tolerated:
// the reader returns `{ token, issuedAt: null }` for those, and the next
// successful write upgrades the entry to the new shape.
//
// localStorage stays bare-string — emergency-escape-hatch role; keeping it
// dead-simple avoids a JSON.parse failure mode on legacy entries that could
// reintroduce the very silent-failure shape we're fixing.

const LS_REFRESH_TOKEN_PREFIX = 'beanies_grt_';

export interface StoredRefreshToken {
  token: string;
  issuedAt: number | null;
}

function isStoredRefreshToken(v: unknown): v is StoredRefreshToken {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as StoredRefreshToken).token === 'string' &&
    'issuedAt' in v &&
    ((v as StoredRefreshToken).issuedAt === null ||
      typeof (v as StoredRefreshToken).issuedAt === 'number')
  );
}

/**
 * Store a Google OAuth refresh token for a family.
 * Writes the structured shape to IndexedDB (primary) and a bare string to
 * localStorage (fallback).
 *
 * `opts.issuedAt` semantics:
 *   - `undefined` → defaults to `Date.now()` (the common path; the caller
 *     just acquired the token).
 *   - `null`      → writes `null` explicitly (used by `migratePendingRefreshToken`
 *     when forwarding a legacy bare-string entry whose acquisition time is
 *     unknown — never invent `Date.now()` here, that would mask revocation
 *     patterns the alert is meant to surface).
 *   - `number`    → writes the explicit timestamp.
 */
export async function storeGoogleRefreshToken(
  familyId: string,
  refreshToken: string,
  opts?: { issuedAt?: number | null }
): Promise<void> {
  const issuedAt = opts && 'issuedAt' in opts ? (opts.issuedAt ?? null) : Date.now();
  const db = await getHandleDatabase();
  const record: StoredRefreshToken = { token: refreshToken, issuedAt };
  await db.put(
    HANDLE_STORE,
    record as unknown as FileSystemFileHandle,
    `googleRefreshToken-${familyId}`
  );
  // localStorage fallback — best-effort (may fail in private browsing or quota).
  // Stays bare-string so legacy code paths (and a downgrade) keep working.
  try {
    localStorage.setItem(`${LS_REFRESH_TOKEN_PREFIX}${familyId}`, refreshToken);
  } catch (e) {
    console.warn('[fileHandleStore] localStorage refresh-token write failed', e);
  }
}

/**
 * Retrieve the stored Google OAuth refresh token for a family.
 * Tries IndexedDB first, falls back to localStorage if IndexedDB was evicted
 * or fails to read.
 *
 * Returns `StoredRefreshToken | null`. Legacy bare-string IDB entries and the
 * localStorage fallback both come back as `{ token, issuedAt: null }`.
 */
export async function getGoogleRefreshToken(familyId: string): Promise<StoredRefreshToken | null> {
  try {
    const db = await getHandleDatabase();
    const stored = await db.get(HANDLE_STORE, `googleRefreshToken-${familyId}`);
    if (typeof stored === 'string') {
      // Legacy entry written before the shape migration. Treat as unknown age.
      return { token: stored, issuedAt: null };
    }
    if (isStoredRefreshToken(stored)) {
      return stored;
    }
    // Unknown shape — fall through to localStorage rather than coerce.
  } catch (e) {
    console.error('[fileHandleStore] Failed to read refresh token from IndexedDB:', e);
    reportError({
      surface: 'refresh-token-idb-read',
      message: 'Failed to read refresh token from IndexedDB',
      error: e instanceof Error ? e : new Error(String(e)),
      context: { family_id: familyId },
    });
  }
  // Fallback: try localStorage. Failure here is typically private-browsing or
  // quota — high false-positive rate, so log-only (no reportError).
  try {
    const fallback = localStorage.getItem(`${LS_REFRESH_TOKEN_PREFIX}${familyId}`);
    return fallback ? { token: fallback, issuedAt: null } : null;
  } catch (e) {
    console.warn('[fileHandleStore] localStorage refresh-token read failed', e);
    return null;
  }
}

/**
 * Clear the stored Google OAuth refresh token for a family.
 * Removes from both IndexedDB and localStorage. Both layers are best-effort
 * — failures are observed (console + reportError for the IDB layer) but
 * swallowed inside the function so callers (e.g. `performSilentRefresh`'s
 * `invalid_grant` cleanup branch) complete their diagnostics-write and
 * permanent-failure-callback chain instead of escaping through the
 * wake-listener's `.catch(() => {})` with no visible signal.
 */
export async function clearGoogleRefreshToken(familyId: string): Promise<void> {
  try {
    const db = await getHandleDatabase();
    await db.delete(HANDLE_STORE, `googleRefreshToken-${familyId}`);
  } catch (e) {
    console.error('[fileHandleStore] Failed to clear refresh token from IndexedDB:', e);
    reportError({
      surface: 'refresh-token-idb-clear',
      message: 'Failed to clear refresh token from IndexedDB',
      error: e instanceof Error ? e : new Error(String(e)),
      context: { family_id: familyId },
    });
  }
  try {
    localStorage.removeItem(`${LS_REFRESH_TOKEN_PREFIX}${familyId}`);
  } catch (e) {
    console.warn('[fileHandleStore] localStorage refresh-token clear failed', e);
  }
}
