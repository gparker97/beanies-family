/**
 * The served Counter-write policy on the main thread (#117 writer flip).
 *
 * The registry Lambda serves `dataPolicy.counterWrites` (Terraform `counter_writes_enabled`) on
 * every 200 GET. This module observes those GETs, keeps the last served value in `localStorage`
 * (device-local, never in the pod) so a boot before the registry answers already knows it, and
 * hands it to `docClient`, which retains it and delivers it to the doc worker.
 *
 * Resolution order, as the worker sees it: the registry's value, else the persisted value, else
 * `COUNTER_WRITES_DEFAULT` (`null` is handed over for "never served").
 *
 * Imports no store, like `registryService`: it is installed once from `App.vue`.
 */
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { setCounterWrites } from '@/services/automerge/worker/docClient';
import { addRegistryEntryObserver } from '@/services/registry/registryService';
import { logEvent } from '@/services/telemetry/logEvent';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';
import type { RegistryEntry } from '@/types/models';

const SURFACE = 'counter-policy';

/** The value last handed to `docClient` this session; the observer hands over only a change. */
let lastValue: boolean | null = null;
/** `missing` (an old Lambda) is a warning once per session, not once per GET. */
let missingLogged = false;
/** The installed observer's remover; non-null means installed. */
let removeObserver: (() => void) | null = null;

/**
 * The last served value, or `null` when none was ever stored. A corrupt or non-boolean record is
 * removed (so the warning fires once, not on every boot) and treated as never served.
 */
export function readPersisted(): boolean | null {
  const read = readStoredJson(STORAGE_KEYS.COUNTER_WRITES, SURFACE);
  if (read.kind === 'missing') return null;
  if (read.kind === 'ok' && typeof read.value === 'boolean') return read.value;
  const removed = removeStoredJson(STORAGE_KEYS.COUNTER_WRITES, SURFACE);
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'persisted counter-write policy unreadable; removed and treated as never served',
    context: {
      action: 'persisted_invalid',
      detail: read.kind === 'corrupt' ? 'corrupt' : 'not_boolean',
    },
    error: removed.ok ? undefined : removed.error,
  });
  return null;
}

/**
 * Store the served value for the next boot. A refused write only costs the next cold boot (it
 * starts on the default until its registry GET answers), so it is a warning, not an error.
 */
export function persist(on: boolean): void {
  const written = writeStoredJson(STORAGE_KEYS.COUNTER_WRITES, on, SURFACE);
  if (!written.ok) {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'counter-write policy could not be persisted; the next boot starts on the default',
      context: { action: 'persist_failed' },
      error: written.error,
    });
  }
}

/** The registry observer. Runs for every successful GET, whichever caller made it. */
function onRegistryEntry(entry: RegistryEntry): void {
  const served = entry.dataPolicy?.counterWrites;
  if (typeof served !== 'boolean') {
    // A registry Lambda older than the writer flip. Keep whatever this device already holds.
    if (!missingLogged) {
      missingLogged = true;
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'registry answered without a dataPolicy; keeping the current counter policy',
        context: { action: 'missing' },
      });
    }
    return;
  }
  if (served === lastValue) return;
  lastValue = served;
  persist(served);
  void setCounterWrites(served, 'registry');
}

/**
 * Hand the persisted policy to `docClient` once, then follow the registry. Call where the
 * session's stores are first created, before `setFamilyKey` can run. Idempotent: a second call
 * (a remount, HMR) does nothing.
 */
export function installCounterWritesPolicy(): void {
  if (removeObserver) return;
  const persisted = readPersisted();
  lastValue = persisted;
  void setCounterWrites(persisted, persisted === null ? 'default' : 'persisted');
  removeObserver = addRegistryEntryObserver(onRegistryEntry);
}

/** Test-only: forget the session's state and remove the observer. */
export function __resetCounterWritesPolicyForTesting(): void {
  removeObserver?.();
  removeObserver = null;
  lastValue = null;
  missingLogged = false;
}
