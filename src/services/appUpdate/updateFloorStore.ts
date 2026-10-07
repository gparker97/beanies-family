/**
 * The last fetched update floor, kept on the device so it can be read synchronously.
 *
 * `fetchUpdateFloor` is async and memoised per process; the KDF write gate
 * (`services/crypto/kdfWriteGate.ts`) has to answer synchronously, mid-unlock, before
 * this launch's fetch may have settled. So the fetch persists every floor it reads
 * successfully, and the gate reads the persisted value. Device-local, never in the pod.
 *
 * A stale persisted floor only ever lags UPWARD (the floor is raised, never lowered),
 * which reads as "gate closed longer", never "open early". `null` is never persisted:
 * a failed fetch keeps whatever this device last knew.
 *
 * ⚠️ CAPACITOR-FREE ON PURPOSE. The crypto layer imports this module through the gate,
 * so it must not drag `@capacitor/core` (or `versionPolicy.ts`) into that graph.
 * Mirrors `counterWritesPolicy.readPersisted/persist`.
 */
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { logEvent } from '@/services/telemetry/logEvent';
import { isComparableVersion } from '@/utils/compareAppVersions';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';

const SURFACE = 'app-update';

/**
 * The last persisted floor, or `null` when none was ever stored. A corrupt or
 * non-version record is removed (so the warning fires once, not on every boot) and
 * treated as never fetched.
 */
export function readPersistedUpdateFloor(): string | null {
  const read = readStoredJson(STORAGE_KEYS.UPDATE_FLOOR, SURFACE);
  if (read.kind === 'missing') return null;
  if (read.kind === 'ok' && typeof read.value === 'string' && isComparableVersion(read.value)) {
    return read.value;
  }
  const removed = removeStoredJson(STORAGE_KEYS.UPDATE_FLOOR, SURFACE);
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'persisted_invalid',
    context: {
      action: 'persisted_invalid',
      detail: read.kind === 'corrupt' ? 'corrupt' : 'not_version',
    },
    error: removed.ok ? undefined : removed.error,
  });
  return null;
}

/**
 * Store a fetched floor for synchronous reads. Called only on `fetchUpdateFloor`'s
 * success path, so `v` is already screened by `isComparableVersion`. A refused write
 * only means the gate keeps reading the previous value (or `null`, i.e. closed), so it
 * is a warning, not an error.
 */
export function persistUpdateFloor(v: string): void {
  const written = writeStoredJson(STORAGE_KEYS.UPDATE_FLOOR, v, SURFACE);
  if (!written.ok) {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'persist_refused',
      context: { action: 'persist_refused' },
      error: written.error,
    });
  }
}
