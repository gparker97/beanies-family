import { openDB, type IDBPDatabase } from 'idb';
import type { CountryCode, HolidayCacheEntry } from '@/types/models';

/**
 * Dedicated IndexedDB for **bundled reference data** caches — currently just
 * the per-country public-holiday files (`public/holidays/<ISO2>.json`). Like
 * the translation cache, this is separate from the Automerge data layer: it's
 * a local cache of static data that ships with the app and never syncs.
 *
 * Future bundled-reference-data caches belong here too — add an object store
 * and bump `DB_VERSION` rather than creating yet another database.
 *
 * Every operation is fail-soft: IndexedDB can be unavailable (private mode,
 * quota, locked) and a cache is just a cache — on any error we log a
 * `[holidays]`-prefixed warning and behave as a cache miss (return null) or a
 * no-op (writes), never throwing to the caller.
 */
interface ReferenceDataCacheDB {
  holidays: {
    key: CountryCode; // keyPath: 'country'
    value: HolidayCacheEntry;
  };
}

const DB_NAME = 'beanies-reference-data';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<ReferenceDataCacheDB> | null = null;

async function getDatabase(): Promise<IDBPDatabase<ReferenceDataCacheDB> | null> {
  if (dbInstance) return dbInstance;
  try {
    dbInstance = await openDB<ReferenceDataCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('holidays')) {
          db.createObjectStore('holidays', { keyPath: 'country' });
        }
      },
    });
    return dbInstance;
  } catch (e) {
    console.warn(
      `[holidays] could not open the reference-data cache (IndexedDB unavailable) — holidays will be re-fetched each session:`,
      e
    );
    return null;
  }
}

/** Returns the cached holiday entry for a country if present (caller applies any TTL). */
export async function getCachedHolidays(country: CountryCode): Promise<HolidayCacheEntry | null> {
  try {
    const db = await getDatabase();
    if (!db) return null;
    return (await db.get('holidays', country)) ?? null;
  } catch (e) {
    console.warn(`[holidays] could not read cached holidays for "${country}":`, e);
    return null;
  }
}

/** Writes/replaces the cached holiday entry for a country. No-op (logged) on failure. */
export async function saveCachedHolidays(entry: HolidayCacheEntry): Promise<void> {
  try {
    const db = await getDatabase();
    if (!db) return;
    await db.put('holidays', entry);
  } catch (e) {
    console.warn(`[holidays] could not cache holidays for "${entry.country}":`, e);
  }
}

/** Clears all cached reference data (e.g. a Settings → "clear local caches" action). No-op (logged) on failure. */
export async function clearAll(): Promise<void> {
  try {
    const db = await getDatabase();
    if (!db) return;
    await db.clear('holidays');
  } catch (e) {
    console.warn('[holidays] could not clear the reference-data cache:', e);
  }
}
