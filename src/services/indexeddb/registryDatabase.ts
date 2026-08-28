import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Family,
  UserFamilyMapping,
  GlobalSettings,
  PasskeyRegistration,
  RosterCacheEntry,
  DeviceUnlockRecord,
  DeviceSecretRecord,
} from '@/types/models';

const REGISTRY_DB_NAME = 'beanies-registry';
const REGISTRY_DB_VERSION = 5;

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
}

let registryInstance: IDBPDatabase<RegistryDB> | null = null;

export async function getRegistryDatabase(): Promise<IDBPDatabase<RegistryDB>> {
  if (registryInstance) {
    return registryInstance;
  }

  // v4 upgrade hazard: a still-open OLD-bundle tab holds a v3 connection with no
  // `blocking` handler, so this openDB can sit in 'blocked' FOREVER (idb neither
  // resolves nor rejects) — hanging boot and the whole login flow silently. We cannot
  // fix already-deployed bundles, but we (a) surface the stall to CloudWatch after 5s
  // so it is diagnosable blind, and (b) ship the handlers so every FUTURE bump closes
  // our own connection instead of blocking the new tab.
  const blockedTimer = setTimeout(() => {
    void import('@/services/telemetry/logEvent').then(({ logEvent }) =>
      logEvent({
        level: 'warn',
        surface: 'login-flow',
        message: 'registry_open_blocked',
        context: { action: 'open_blocked', error_code: 'VersionBlocked' },
      })
    );
  }, 5000);

  registryInstance = await openDB<RegistryDB>(REGISTRY_DB_NAME, REGISTRY_DB_VERSION, {
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
    },
  });

  clearTimeout(blockedTimer);
  return registryInstance;
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
