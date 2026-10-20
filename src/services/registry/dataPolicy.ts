/**
 * The served data policy on the main thread (#117 Counter writes, #124 scalar strings).
 *
 * The registry Lambda serves `dataPolicy.{counterWrites,scalarWrites}` (Terraform
 * `counter_writes_enabled` / `scalar_writes_enabled`) on every 200 GET. This module observes those
 * GETs, keeps the last SERVED value of each flag in `localStorage` (device-local, never in the
 * pod) so a boot before the registry answers already knows it, and hands the EFFECTIVE values to
 * `docClient`, which retains them and delivers them to the doc worker.
 *
 * Table-driven: a flag is one row of `FLAGS`. A row with `readSince` is floor-guarded: its served
 * ON only becomes effective once the persisted update floor is at or above that version
 * (`floorVerdict`), so a tfvars flip before the floor raise does nothing and logs `held`. The
 * guard is evaluated here on main because the worker cannot telemeter and main holds the floor.
 *
 * ⚠️ Persist the SERVED value, never the effective one: the floor guard is re-evaluated at every
 * boot and registry GET, so a floor that lands later opens the writer without a new served value.
 *
 * Resolution order, as the worker sees it: the registry's value, else the persisted value, else
 * the worker default (`null` is handed over for "never served").
 *
 * Imports no store, like `registryService`: it is installed once from `App.vue`.
 */
import { SCALAR_READ_SINCE } from '@/constants/appVersion';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { applyDataPolicy } from '@/services/automerge/worker/docClient';
import type { SetDataPolicyArgs } from '@/services/automerge/worker/protocol';
import { floorVerdict, readPersistedUpdateFloor } from '@/services/appUpdate/updateFloorStore';
import { addRegistryEntryObserver } from '@/services/registry/registryService';
import { logEvent } from '@/services/telemetry/logEvent';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';
import type { RegistryEntry } from '@/types/models';

type FlagName = keyof SetDataPolicyArgs;
type Source = 'registry' | 'persisted' | 'default';

export interface FlagRow {
  name: FlagName;
  storageKey: string;
  /** Kebab-case CloudWatch surface for this flag's lifecycle events. */
  surface: string;
  /** The first build that reads what this flag's writer writes; absent = no floor guard. */
  readSince?: string;
}

/** One row per flag. A third flag is a third row. */
const FLAGS: readonly FlagRow[] = [
  { name: 'counterWrites', storageKey: STORAGE_KEYS.COUNTER_WRITES, surface: 'counter-policy' },
  {
    name: 'scalarWrites',
    storageKey: STORAGE_KEYS.SCALAR_WRITES,
    surface: 'scalar-policy',
    readSince: SCALAR_READ_SINCE,
  },
];

interface FlagState {
  /** The last served (or persisted) value; `null` = never served. */
  served: boolean | null;
  /** The effective value last handed to `docClient`; `null` = nothing handed over yet. */
  effective: boolean | null;
  missingLogged: boolean;
  heldLogged: boolean;
}

const freshState = (): Record<FlagName, FlagState> => ({
  counterWrites: { served: null, effective: null, missingLogged: false, heldLogged: false },
  scalarWrites: { served: null, effective: null, missingLogged: false, heldLogged: false },
});

let state = freshState();
/** The installed observer's remover; non-null means installed. */
let removeObserver: (() => void) | null = null;

/**
 * A flag's last served value, or `null` when none was ever stored. A corrupt or non-boolean
 * record is removed (so the warning fires once, not on every boot) and treated as never served.
 */
export function readPersisted(flag: FlagRow): boolean | null {
  const read = readStoredJson(flag.storageKey, flag.surface);
  if (read.kind === 'missing') return null;
  if (read.kind === 'ok' && typeof read.value === 'boolean') return read.value;
  const removed = removeStoredJson(flag.storageKey, flag.surface);
  logEvent({
    level: 'warn',
    surface: flag.surface,
    message: `persisted ${flag.name} policy unreadable; removed and treated as never served`,
    context: {
      action: 'persisted_invalid',
      detail: read.kind === 'corrupt' ? 'corrupt' : 'not_boolean',
    },
    error: removed.ok ? undefined : removed.error,
  });
  return null;
}

/**
 * Store a flag's served value for the next boot. A refused write only costs the next cold boot
 * (it starts on the default until its registry GET answers), so it is a warning, not an error.
 */
export function persist(flag: FlagRow, on: boolean): void {
  const written = writeStoredJson(flag.storageKey, on, flag.surface);
  if (!written.ok) {
    logEvent({
      level: 'warn',
      surface: flag.surface,
      message: `${flag.name} policy could not be persisted; the next boot starts on the default`,
      context: { action: 'persist_failed' },
      error: written.error,
    });
  }
}

/**
 * Is a flag on for this device? `null` = never served. A floor-guarded flag also needs its floor
 * open; the `held` warning (once per session per flag) says why when it is not.
 */
export function effective(flag: FlagRow, served: boolean | null): boolean | null {
  if (served === null) return null;
  if (!served || flag.readSince === undefined) return served;
  const verdict = floorVerdict(flag.readSince);
  if (verdict === 'open') return true;
  const s = state[flag.name];
  if (!s.heldLogged) {
    s.heldLogged = true;
    logEvent({
      level: 'warn',
      surface: flag.surface,
      message: `${flag.name} served ON but the update floor has not reached the readers build; writer stays closed`,
      context: {
        action: 'held',
        detail: `floor=${readPersistedUpdateFloor() ?? 'none'},since=${flag.readSince},verdict=${verdict}`,
      },
    });
  }
  return false;
}

/** Log a flag's `applied` event (the CloudWatch signal `counter-policy applied` keeps its shape). */
function logApplied(flag: FlagRow, on: boolean | null, source: Source): void {
  const served = state[flag.name].served;
  const floor = flag.readSince === undefined ? 'none' : (readPersistedUpdateFloor() ?? 'none');
  logEvent({
    level: 'info',
    surface: flag.surface,
    message: `${flag.name} policy applied`,
    context: {
      action: 'applied',
      detail: `on=${String(on)},served=${String(served)},source=${source},floor=${floor}`,
    },
  });
}

/**
 * Recompute every row's effective value; if any changed (or `force`), hand the whole policy to
 * `docClient` once and log `applied` for the rows that changed.
 */
function reconcile(source: Source, force = false): void {
  const next = {} as SetDataPolicyArgs;
  const changed: FlagRow[] = [];
  for (const flag of FLAGS) {
    const on = effective(flag, state[flag.name].served);
    next[flag.name] = on;
    if (force || on !== state[flag.name].effective) changed.push(flag);
  }
  if (changed.length === 0) return;
  for (const flag of FLAGS) state[flag.name].effective = next[flag.name];
  for (const flag of changed) logApplied(flag, next[flag.name], source);
  void applyDataPolicy(next);
}

/** The registry observer. Runs for every successful GET, whichever caller made it. */
function onRegistryEntry(entry: RegistryEntry): void {
  for (const flag of FLAGS) {
    const s = state[flag.name];
    const served: unknown = entry.dataPolicy?.[flag.name];
    if (typeof served !== 'boolean') {
      // A registry Lambda older than the flag. Keep whatever this device already holds.
      if (!s.missingLogged) {
        s.missingLogged = true;
        logEvent({
          level: 'warn',
          surface: flag.surface,
          message: `registry answered without ${flag.name}; keeping the current policy`,
          context: { action: 'missing' },
        });
      }
      continue;
    }
    if (served !== s.served) {
      s.served = served;
      persist(flag, served);
      // A rollback re-arms `held`, so a later re-flip on a still-held device logs it again.
      if (!served) s.heldLogged = false;
      // The served value moved. `applied` follows only when the EFFECTIVE value moves too, so
      // this is the one event that shows a flip (or a rollback) reached a held device.
      logEvent({
        level: 'info',
        surface: flag.surface,
        message: `registry now serves ${flag.name}=${served}`,
        context: { action: 'served_changed', detail: `served=${served}` },
      });
    }
  }
  reconcile('registry');
}

/**
 * Hand the persisted policy to `docClient` once, then follow the registry. Call where the
 * session's stores are first created, before `setFamilyKey` can run. Idempotent: a second call
 * (a remount, HMR) does nothing.
 */
export function installDataPolicy(): void {
  if (removeObserver) return;
  let anyPersisted = false;
  for (const flag of FLAGS) {
    const persisted = readPersisted(flag);
    state[flag.name].served = persisted;
    if (persisted !== null) anyPersisted = true;
  }
  // The boot hand-over always goes out (even all-null), as the worker then holds the defaults.
  reconcile(anyPersisted ? 'persisted' : 'default', true);
  removeObserver = addRegistryEntryObserver(onRegistryEntry);
}

/** Test-only: forget the session's state and remove the observer. */
export function __resetDataPolicyForTesting(): void {
  removeObserver?.();
  removeObserver = null;
  state = freshState();
}

/** Test-only: the table, so tests address rows without re-declaring them. */
export const __FLAGS_FOR_TESTING = FLAGS;
