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
  /**
   * Native (Capacitor) local-file path, relative to Directory.Data. Set only by
   * `CapacitorFileProvider` — the native local-file restore pointer (the web
   * local provider restores from a `FileSystemFileHandle` instead). See ADR-029.
   */
  localPath?: string;
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
// Dual-write: IndexedDB (primary) + localStorage (fallback), mirroring the
// refresh-token durability strategy below. On PWA/mobile the `beanies-file-handles`
// IndexedDB origin can be evicted under storage pressure / iOS's eviction policy,
// which used to strand an established owner on the "unconfigured" card because
// `syncService.initialize()` had nothing else to restore from. The localStorage
// mirror lets a same-origin IDB eviction that spares localStorage self-heal with
// no network round-trip; the durable remote registry is the deeper fallback (see
// syncStore.attemptSilentConfigHeal). All provider-config writes/deletes flow
// through storeProviderConfig/clearProviderConfig, so the mirror stays in lockstep
// automatically (incl. resurrection-safety: localProvider.persist + deleteLocalFamily
// both call clearProviderConfig). See docs/plans/2026-07-15-native-data-connection-resilience.md.
const LS_PROVIDER_CONFIG_PREFIX = 'beanies_pcfg_';

function isPersistedProviderConfig(v: unknown): v is PersistedProviderConfig {
  return !!v && typeof v === 'object' && 'type' in v;
}

/**
 * Store provider config for a family (e.g. google_drive with fileId).
 * Writes to IndexedDB (primary) and a JSON mirror in localStorage (fallback).
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
  // localStorage mirror — best-effort (private browsing / quota may reject).
  try {
    localStorage.setItem(`${LS_PROVIDER_CONFIG_PREFIX}${familyId}`, JSON.stringify(config));
  } catch (e) {
    console.warn('[fileHandleStore] localStorage provider-config write failed', e);
  }
}

/**
 * Retrieve the stored provider config for a family. Tries IndexedDB first, then
 * the localStorage mirror if IndexedDB was evicted or the read throws.
 *
 * A thrown IDB read is reported (not swallowed) so an eviction is distinguishable
 * from a genuine absence — the silent bare-`catch` this replaces made the two
 * indistinguishable, which masked the native data-connection-loss incident.
 */
export async function getProviderConfig(familyId: string): Promise<PersistedProviderConfig | null> {
  try {
    const db = await getHandleDatabase();
    const config = await db.get(HANDLE_STORE, `providerConfig-${familyId}`);
    if (isPersistedProviderConfig(config)) {
      return config as unknown as PersistedProviderConfig;
    }
    // Present but unknown shape, or genuinely absent → try the mirror below.
  } catch (e) {
    console.error('[fileHandleStore] Failed to read provider config from IndexedDB:', e);
    reportError({
      surface: 'provider-config-idb-read',
      message: 'Failed to read provider config from IndexedDB',
      error: e instanceof Error ? e : new Error(String(e)),
      context: { family_id: familyId },
    });
  }
  // Fallback: the localStorage mirror. Never swallow a parse/read error silently.
  try {
    const raw = localStorage.getItem(`${LS_PROVIDER_CONFIG_PREFIX}${familyId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedProviderConfig(parsed) ? (parsed as PersistedProviderConfig) : null;
  } catch (e) {
    console.warn('[fileHandleStore] localStorage provider-config read failed', e);
    return null;
  }
}

/**
 * Clear the stored provider config for a family — from both IndexedDB and the
 * localStorage mirror, so a disconnected/deleted pod can never resurrect from a
 * stale mirror on the next boot.
 */
export async function clearProviderConfig(familyId: string): Promise<void> {
  try {
    const db = await getHandleDatabase();
    await db.delete(HANDLE_STORE, `providerConfig-${familyId}`);
  } finally {
    // ALWAYS remove the localStorage mirror, even if the IndexedDB delete threw
    // (blocked/quota/corrupt IDB — the exact failure class the mirror defends
    // against). Otherwise a broken IDB leaves a stale mirror that resurrects the
    // disconnected/deleted pod on the next boot (getProviderConfig falls back to it).
    try {
      localStorage.removeItem(`${LS_PROVIDER_CONFIG_PREFIX}${familyId}`);
    } catch (e) {
      console.warn('[fileHandleStore] localStorage provider-config clear failed', e);
    }
  }
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

// --- Last authenticated Google account breadcrumb (tracker #62) --------------
// A NON-authoritative hint: which Google account last authenticated, and the
// family id its refresh token is stored under. Used at sign-in to detect a
// different-account login and tear down the departed account's stale token
// state (see `reconcileDepartedAccount` in googleAuth). Survives sign-out (it is
// not a token key), holds NO secret (email + family id only), and is best-effort
// — a lost/corrupt record just means one missed teardown, self-healing on the
// next write. The token stores remain the source of truth.

const LS_LAST_GOOGLE_ACCOUNT = 'beanies_last_google_account';

export interface LastGoogleAccount {
  email: string;
  familyId: string;
}

export function getLastGoogleAccount(): LastGoogleAccount | null {
  try {
    const raw = localStorage.getItem(LS_LAST_GOOGLE_ACCOUNT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastGoogleAccount>;
    if (typeof parsed?.email === 'string' && typeof parsed?.familyId === 'string') {
      return { email: parsed.email, familyId: parsed.familyId };
    }
    return null; // malformed → treat as absent (next write overwrites)
  } catch (e) {
    console.warn('[fileHandleStore] last-google-account read failed', e);
    return null;
  }
}

export function setLastGoogleAccount(email: string, familyId: string): void {
  try {
    localStorage.setItem(LS_LAST_GOOGLE_ACCOUNT, JSON.stringify({ email, familyId }));
  } catch (e) {
    console.warn('[fileHandleStore] last-google-account write failed', e);
  }
}

export function clearLastGoogleAccount(): void {
  try {
    localStorage.removeItem(LS_LAST_GOOGLE_ACCOUNT);
  } catch (e) {
    console.warn('[fileHandleStore] last-google-account clear failed', e);
  }
}
