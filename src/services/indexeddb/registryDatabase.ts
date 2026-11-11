import { clearStorageStall, markStorageStalled } from '@/utils/storageStall';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Family,
  UserFamilyMapping,
  GlobalSettings,
  PasskeyRegistration,
  RosterCacheEntry,
  DeviceUnlockRecord,
  DeviceSecretRecord,
  TrustedAutoOpenRecord,
} from '@/types/models';

const REGISTRY_DB_NAME = 'beanies-registry';
const REGISTRY_DB_VERSION = 6;

export interface RegistryDB extends DBSchema {
  families: {
    key: string;
    value: Family;
  };
  userFamilyMappings: {
    key: string;
    value: UserFamilyMapping;
    indexes: {
      'by-email': string;
      'by-familyId': string;
    };
  };
  globalSettings: {
    key: string;
    value: GlobalSettings;
  };
  passkeys: {
    key: string;
    value: PasskeyRegistration;
    indexes: {
      'by-memberId': string;
      'by-familyId': string;
    };
  };
  rosterCache: {
    key: string;
    value: RosterCacheEntry;
  };
  deviceUnlock: {
    key: string;
    value: DeviceUnlockRecord;
    indexes: {
      'by-familyId': string;
    };
  };
  deviceSecrets: {
    key: string;
    value: DeviceSecretRecord;
  };
  trustedAutoOpen: {
    key: string;
    value: TrustedAutoOpenRecord;
  };
}

let registryInstance: IDBPDatabase<RegistryDB> | null = null;
/** Single-flight: 38 callers share ONE pending open instead of each starting their own. */
let openInFlight: Promise<IDBPDatabase<RegistryDB>> | null = null;
/**
 * After a confirmed block, later calls fail fast until this time instead of each waiting
 * another 15 s (the sign-in flow makes many calls in a row; on 2026-11-11 that was minutes
 * of silent spinner). The blocked open keeps running in the background and clears this
 * the moment it succeeds.
 */
let blockedUntil = 0;
export const REGISTRY_FAIL_FAST_MS = 20_000;

function registryBlockedError(): Error {
  const err = new Error(
    'beanies is open in another tab or window, which is blocking a storage upgrade'
  );
  err.name = 'RegistryBlockedError';
  return err;
}

function logRegistry(message: string, action: string, errorCode?: string): void {
  void import('@/services/telemetry/logEvent')
    .then(({ logEvent }) =>
      logEvent({
        level: 'warn',
        surface: 'login-flow',
        message,
        context: { action, ...(errorCode ? { error_code: errorCode } : {}) },
      })
    )
    .catch((e: unknown) => console.warn('[registryDatabase] telemetry skipped:', e));
}

export function getRegistryDatabase(): Promise<IDBPDatabase<RegistryDB>> {
  if (registryInstance) return Promise.resolve(registryInstance);
  if (Date.now() < blockedUntil) return Promise.reject(registryBlockedError());
  if (!openInFlight) {
    const open = openRegistryDatabase().finally(() => {
      if (openInFlight === open) openInFlight = null;
    });
    openInFlight = open;
  }
  return openInFlight;
}

async function openRegistryDatabase(): Promise<IDBPDatabase<RegistryDB>> {
  // Upgrade hazard: a still-open OLD-bundle tab/PWA window holds an older-version
  // connection with no `blocking` handler, so this openDB can sit in 'blocked' FOREVER
  // (idb neither resolves nor rejects) — hanging boot until the 35s watchdog shows a
  // generic fatal screen (observed live on the 0.13 deploy, 2026-08-28). We cannot fix
  // already-deployed bundles, so: (a) surface the stall after 5s, to CloudWatch AND to the
  // person (`markStorageStalled` raises the one banner that says what to do), (b) ship
  // handlers so every FUTURE bump closes our own connection, and (c) BOUND the wait —
  // after 15s of confirmed 'blocked', reject with a typed error the boot surface renders
  // as the actionable "close your other beanies tabs" message instead of a mystery stall.
  let blockedFired = false;
  let rejectedAsBlocked = false;
  const blockedTimer = setTimeout(() => {
    blockedFired = true;
    markStorageStalled();
    logRegistry('registry_open_blocked', 'open_blocked', 'VersionBlocked');
  }, 5000);

  try {
    const blockedRejection = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (blockedFired) reject(registryBlockedError());
        // Not blocked — never reject; a merely-slow open keeps waiting.
      }, 15_000);
    });
    const raw = openDB<RegistryDB>(REGISTRY_DB_NAME, REGISTRY_DB_VERSION, {
      blocked() {
        // An older-version connection elsewhere refuses to close; the timer above reports.
      },
      blocking() {
        // A NEWER version wants to open in another tab — close our connection so that tab
        // can proceed; the next call here reopens at whatever version wins.
        registryInstance?.close();
        registryInstance = null;
      },
      terminated() {
        registryInstance = null;
      },
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('families')) {
          db.createObjectStore('families', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('userFamilyMappings')) {
          const mappingStore = db.createObjectStore('userFamilyMappings', { keyPath: 'id' });
          mappingStore.createIndex('by-email', 'email', { unique: false });
          mappingStore.createIndex('by-familyId', 'familyId', { unique: false });
        }

        // v2: remove cachedSessions store (Cognito removed)
        // Cast to native IDBDatabase to access stores not in the typed schema
        const rawDb = db as unknown as IDBDatabase;
        if (oldVersion < 2 && rawDb.objectStoreNames.contains('cachedSessions')) {
          rawDb.deleteObjectStore('cachedSessions');
        }

        if (!db.objectStoreNames.contains('globalSettings')) {
          db.createObjectStore('globalSettings', { keyPath: 'id' });
        }

        // v3: add passkeys store for WebAuthn/biometric credentials
        if (!db.objectStoreNames.contains('passkeys')) {
          const passkeyStore = db.createObjectStore('passkeys', { keyPath: 'credentialId' });
          passkeyStore.createIndex('by-memberId', 'memberId', { unique: false });
          passkeyStore.createIndex('by-familyId', 'familyId', { unique: false });
        }

        // v4: device-local roster cache for the pre-decrypt person picker (2026-08-28
        // login rethink). Display data only — see RosterCacheEntry in models.ts.
        if (!db.objectStoreNames.contains('rosterCache')) {
          db.createObjectStore('rosterCache', { keyPath: 'familyId' });
        }

        // v5: PIN device-unlock wraps + the per-device secret (login rethink Phase 2).
        // See DeviceUnlockRecord / DeviceSecretRecord in models.ts.
        if (!db.objectStoreNames.contains('deviceUnlock')) {
          const unlockStore = db.createObjectStore('deviceUnlock', { keyPath: 'id' });
          unlockStore.createIndex('by-familyId', 'familyId', { unique: false });
        }
        if (!db.objectStoreNames.contains('deviceSecrets')) {
          db.createObjectStore('deviceSecrets', { keyPath: 'id' });
        }

        // v6 (Phase 4): trusted-device auto-open wraps — the family key wrapped
        // under the device secret (NO user secret; this is deliberately a TRUST
        // wrap for silent open). Replaces the plaintext `cachedFamilyKeys` in
        // globalSettings: a registry-DB dump no longer yields the FK without also
        // executing code in the origin. See TrustedAutoOpenRecord in models.ts.
        if (!db.objectStoreNames.contains('trustedAutoOpen')) {
          db.createObjectStore('trustedAutoOpen', { keyPath: 'familyId' });
        }
      },
    });
    // The open outlives a 15s rejection: when the other tab finally closes it resolves,
    // and that is the recovery. Adopt the connection and take the banner down.
    raw.then(
      (db) => {
        if (!rejectedAsBlocked) return;
        registryInstance = db;
        blockedUntil = 0;
        clearStorageStall();
        logRegistry('registry_open_recovered', 'open_recovered');
      },
      () => {
        // Observed by the race below; a late rejection after a block needs no second report.
      }
    );
    registryInstance = await Promise.race([raw, blockedRejection]);
    clearStorageStall();
    return registryInstance;
  } catch (e) {
    if (e instanceof Error && e.name === 'RegistryBlockedError') {
      rejectedAsBlocked = true;
      blockedUntil = Date.now() + REGISTRY_FAIL_FAST_MS;
    }
    throw e;
  } finally {
    // Cleared on BOTH outcomes — a rejected open must not leave the 5s timer to fire a
    // spurious VersionBlocked into the firehose.
    clearTimeout(blockedTimer);
  }
}

export async function closeRegistryDatabase(): Promise<void> {
  if (registryInstance) {
    registryInstance.close();
    registryInstance = null;
  }
}

export function getRegistryDatabaseName(): string {
  return REGISTRY_DB_NAME;
}

/**
 * Whether an error from opening/writing this IndexedDB registry indicates the
 * browser is BLOCKING storage rather than a transient/logic failure. The
 * canonical case is iOS Safari Private Browsing (and Firefox private mode),
 * which throw on IndexedDB access; quota exhaustion surfaces the same way.
 * Callers use this to show a specific "storage is blocked" message instead of
 * a generic failure. (Distinct from `classifyFileError`, which is specific to
 * the File System Access API.)
 */
export function isStorageBlockedError(e: unknown): boolean {
  return (
    e instanceof Error &&
    ['InvalidStateError', 'SecurityError', 'QuotaExceededError'].includes(e.name)
  );
}
