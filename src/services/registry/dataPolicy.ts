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
 * #124 per-family canary: the Lambda also serves `dataPolicy.scalarWritesFamily`, which answers
 * for the GET's own family only. It is NOT a `FLAGS` row (rows are fleet-wide booleans): it is one
 * separate list of the family ids served `true` THIS SESSION (`families`), kept sorted, and handed
 * over as `scalarFamilies` only while the scalar row's floor guard is open. This module never
 * matches a family against the open one: the doc worker does, per RPC, against the family of the
 * document it writes, so a GET for another family (a join or recovery flow), a key for another
 * family, or a failed post can never turn the writer on for a family that is not listed.
 *
 * ⚠️ THE FAMILY LIST IS NEVER PERSISTED. It starts empty at every boot and changes only from a
 * registry GET answered this session. A persisted list would be trusted at boot with no freshness
 * check, so a family removed from the allowlist kept being written on a device that booted
 * offline, and a second tab could write a removed family back. The consequence: after boot the
 * scalar writer for a listed family is off until that family's first GET answers; writes in
 * between use the old form, which every build reads, so nothing is lost. The fleet flags keep
 * their persistence.
 *
 * A failed hand-over (`applyDataPolicy` resolves `false`: the live post did not reach the worker,
 * already reported as `data-policy post_failed`) forgets what was handed over, so the next
 * registry GET posts the whole policy again. No timers.
 *
 * Imports no store, like `registryService`: it is installed once from `App.vue`.
 */
import { SCALAR_READ_SINCE } from '@/constants/appVersion';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { applyDataPolicy } from '@/services/automerge/worker/docClient';
import { emptyDataPolicy } from '@/services/automerge/worker/protocol';
import { floorVerdict, readPersistedUpdateFloor } from '@/services/appUpdate/updateFloorStore';
import { addRegistryEntryObserver } from '@/services/registry/registryService';
import { logEvent } from '@/services/telemetry/logEvent';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';
import type { RegistryEntry } from '@/types/models';

type FlagName = 'counterWrites' | 'scalarWrites';
type Source = 'registry' | 'persisted' | 'default';
/** Which scalar value a floor guard is holding: the fleet flag or the family list. */
type Scope = 'fleet' | 'family';

export interface FlagRow {
  name: FlagName;
  storageKey: string;
  /** Kebab-case CloudWatch surface for this flag's lifecycle events. */
  surface: string;
  /** The first build that reads what this flag's writer writes; absent = no floor guard. */
  readSince?: string;
}

const SCALAR_ROW: FlagRow = {
  name: 'scalarWrites',
  storageKey: STORAGE_KEYS.SCALAR_WRITES,
  surface: 'scalar-policy',
  readSince: SCALAR_READ_SINCE,
};

/** One row per flag. A third flag is a third row. */
const FLAGS: readonly FlagRow[] = [
  { name: 'counterWrites', storageKey: STORAGE_KEYS.COUNTER_WRITES, surface: 'counter-policy' },
  SCALAR_ROW,
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

/**
 * The family-scoped scalar list (#124 per-family canary): one separate state, not a `FLAGS` row.
 * Lists are always replaced, never mutated, and kept sorted, so reordering is never a change.
 */
interface FamilyListState {
  /** The SERVED list: the families served `scalarWritesFamily: true` by a GET this session. */
  served: string[];
  /** The list last handed to `docClient`; `null` = nothing handed over yet. */
  effective: string[] | null;
  /** `missing` for a GET without `scalarWritesFamily`: its own latch, never the scalar row's. */
  missingLogged: boolean;
  /** `missing` for a GET whose entry carries no usable `familyId`. */
  noFamilyIdLogged: boolean;
  /** `held` for the family scope: its own latch, so the fleet and family scopes never suppress
   *  or re-arm each other. */
  heldLogged: boolean;
}

const freshFamilies = (): FamilyListState => ({
  served: [],
  effective: null,
  missingLogged: false,
  noFamilyIdLogged: false,
  heldLogged: false,
});

let families = freshFamilies();
/** The installed observer's remover; non-null means installed. */
let removeObserver: (() => void) | null = null;

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b.at(i));

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
 * open; the `held` warning says why when it is not: once per session per flag for the fleet
 * scope, and once more on the family list's own latch for the family scope.
 */
export function effective(
  flag: FlagRow,
  served: boolean | null,
  scope: Scope = 'fleet'
): boolean | null {
  if (served === null) return null;
  if (!served || flag.readSince === undefined) return served;
  const verdict = floorVerdict(flag.readSince);
  if (verdict === 'open') return true;
  const latch = scope === 'family' ? families : state[flag.name];
  if (!latch.heldLogged) {
    latch.heldLogged = true;
    logEvent({
      level: 'warn',
      surface: flag.surface,
      message: `${flag.name} served ON but the update floor has not reached the readers build; writer stays closed`,
      context: {
        action: 'held',
        detail: `floor=${readPersistedUpdateFloor() ?? 'none'},since=${flag.readSince},verdict=${verdict},scope=${scope}`,
      },
    });
  }
  return false;
}

/**
 * Log a flag's `applied` event (the CloudWatch signal `counter-policy applied` keeps its shape).
 * The scalar row adds `families=<n>`, the size of the handed-over list: `families>=1` is the
 * canary's success signal on a device.
 */
function logApplied(flag: FlagRow, on: boolean | null, source: Source): void {
  const served = state[flag.name].served;
  const floor = flag.readSince === undefined ? 'none' : (readPersistedUpdateFloor() ?? 'none');
  const listed = flag === SCALAR_ROW ? `,families=${families.effective?.length ?? 0}` : '';
  logEvent({
    level: 'info',
    surface: flag.surface,
    message: `${flag.name} policy applied`,
    context: {
      action: 'applied',
      detail: `on=${String(on)},served=${String(served)},source=${source},floor=${floor}${listed}`,
    },
  });
}

/**
 * The family list to hand over: the served list while the scalar row's floor guard is open, else
 * `[]`. Reuses `effective` (and its `held` warning); there is no second floor check.
 */
function effectiveFamilies(): string[] {
  const served = families.served;
  return effective(SCALAR_ROW, served.length > 0, 'family') ? [...served] : [];
}

/**
 * Recompute every row's effective value and the handed-over family list; if any changed (or
 * `force`), hand the whole policy to `docClient` once and log `applied` for the rows that changed
 * (the scalar row's when its fleet value OR the list changed).
 */
function reconcile(source: Source, force = false): void {
  const next = emptyDataPolicy();
  const changed: FlagRow[] = [];
  for (const flag of FLAGS) {
    const on = effective(flag, state[flag.name].served);
    next[flag.name] = on;
    if (force || on !== state[flag.name].effective) changed.push(flag);
  }
  // After the rows. The two scopes have separate `held` latches, so a device holding both
  // values logs one `held` per scope, fleet first.
  next.scalarFamilies = effectiveFamilies();
  const prior = families.effective;
  const listChanged = force || prior === null || !sameList(prior, next.scalarFamilies);
  if (listChanged && !changed.includes(SCALAR_ROW)) changed.push(SCALAR_ROW);
  if (changed.length === 0) return;
  for (const flag of FLAGS) state[flag.name].effective = next[flag.name];
  families.effective = next.scalarFamilies;
  for (const flag of changed) logApplied(flag, next[flag.name], source);
  void applyDataPolicy(next).then((posted) => {
    // The live post failed (reported by `docClient`). Forget what was handed over, so the next
    // registry GET re-posts everything; a rollback that never landed is retried, not lost.
    if (!posted) forgetHandedOver();
  });
}

/** Mark every value as "nothing handed over yet", so the next `reconcile` posts the policy. */
function forgetHandedOver(): void {
  for (const flag of FLAGS) state[flag.name].effective = null;
  families.effective = null;
}

/**
 * Fold one GET's `scalarWritesFamily` into the served family list. The GET can be for a family
 * other than the open one (join, recovery): it only ever adds or removes ITS OWN id, so it cannot
 * change what another family writes. Nothing here is silent.
 */
function onFamilyValue(entry: RegistryEntry): void {
  const served: unknown = entry.dataPolicy?.scalarWritesFamily;
  if (typeof served !== 'boolean') {
    // A registry Lambda older than the canary. Keep the list this device already holds.
    if (!families.missingLogged) {
      families.missingLogged = true;
      logEvent({
        level: 'warn',
        surface: SCALAR_ROW.surface,
        message: 'registry answered without scalarWritesFamily; keeping the current family list',
        context: { action: 'missing', detail: 'scope=family' },
      });
    }
    return;
  }
  const id: unknown = entry.familyId;
  if (typeof id !== 'string' || id === '') {
    if (!families.noFamilyIdLogged) {
      families.noFamilyIdLogged = true;
      logEvent({
        level: 'warn',
        surface: SCALAR_ROW.surface,
        message: 'registry entry has no family id; its scalarWritesFamily is ignored',
        context: { action: 'missing', detail: 'no_family_id' },
      });
    }
    return;
  }
  if (served === families.served.includes(id)) return;
  families.served = served
    ? sortedUnique([...families.served, id])
    : families.served.filter((f) => f !== id);
  // Mirrors the fleet rollback: an emptied list re-arms the FAMILY `held` latch (only), so a later
  // re-add on a still-held device logs it again. Session memory only: never persisted.
  if (families.served.length === 0) families.heldLogged = false;
  // The family id goes in `detail` (redaction only caps its length), never in `message`, where
  // UUIDs are rewritten; `family_id` is the ACTIVE family, which this GET's may not be.
  logEvent({
    level: 'info',
    surface: SCALAR_ROW.surface,
    message: `registry now serves scalarWritesFamily=${served} for a family`,
    context: { action: 'served_changed', detail: `scope=family,served=${served},family=${id}` },
  });
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
        context: { action: 'served_changed', detail: `served=${served},scope=fleet` },
      });
    }
  }
  onFamilyValue(entry);
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
  // The family list is NOT read: it is session-only and starts empty (see the header).
  // The boot hand-over always goes out (even all-null), as the worker then holds the defaults.
  reconcile(anyPersisted ? 'persisted' : 'default', true);
  removeObserver = addRegistryEntryObserver(onRegistryEntry);
}

/** Test-only: forget the session's state and remove the observer. */
export function __resetDataPolicyForTesting(): void {
  removeObserver?.();
  removeObserver = null;
  state = freshState();
  families = freshFamilies();
}

/** Test-only: the table, so tests address rows without re-declaring them. */
export const __FLAGS_FOR_TESTING = FLAGS;
