/**
 * Load-time maintenance: the ONE place for work that writes to the document because the
 * document was (re)loaded — a daily list reset, a repeating to-do roll, a retention sweep, a
 * one-shot migration, recurring transactions.
 *
 * THE RULE. A store loader is read-only. A loader that awaits a write makes the open wait
 * for the whole Automerge rebuild: on a projection-snapshot hit the stores are filled before
 * the worker holds a document, and every `mutate` queues behind `initAndLoadCache` in the
 * serial worker FIFO, so `await loader()` became "wait 5 to 70 seconds" (2026-11-15). Writers
 * register here instead, and run only after the stores were reloaded from the AUTHORITATIVE
 * document: `reloadAllStores` calls `runLoadMaintenance` after its loaders, and only when the
 * document was already authoritative when that reload began.
 *
 * THE HOLD. Path 1a holds maintenance until its boot Drive read ends (`holdLoadMaintenance`
 * returns the hold's own release function, handed to `backgroundSyncFromFile`), so neither a
 * maintenance write nor a flag-gated writer saves inside that download or acts on pre-merge
 * data. A hold belongs to one family session: `clearStoresAuthoritative` voids it.
 *
 * THE GUARD. `reloadAllStores` and the direct-loader path wrap their loaders in a load phase
 * (`beginLoadPhase` / `endLoadPhase`). `docClient.mutate` reports a write made inside one
 * (`noteLoadPhaseWrite`): it throws and is recorded in unit tests, so a loader that writes
 * fails the build, and in production the write is still sent and reported once per session.
 *
 * Imports `projection`, never `docService`: `docService` imports `docClient`, which imports
 * this module.
 */
import { computed, shallowRef, type ComputedRef } from 'vue';
import { isAuthoritativeLoaded } from './projection';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

export type LoadMaintenanceTask = () => Promise<unknown>;

const SURFACE = 'load-maintenance';
/** A hold that nothing released (an exit path that forgot) must not cancel maintenance for
 *  the session: after this long the hold lapses, the run happens, and a warning names it. */
const HOLD_MAX_MS = 120_000;

const tasks = new Map<string, LoadMaintenanceTask>();

let running = false;
/** The trigger of the one coalesced rerun requested while a run was in flight. */
let rerunTrigger: string | null = null;

/** A hold on maintenance (path 1a's boot Drive read). Only the release function made with it
 *  can end it, or its own lapse; `clearStoresAuthoritative` voids it. */
interface Hold {
  /** The one run requested while held, run when the hold ends. */
  trigger: string | null;
  /** The lapse: a hold nobody released must not cancel maintenance for the session. */
  timer: ReturnType<typeof setTimeout>;
}

/** The hold in force, or null. */
let hold: Hold | null = null;
/** Changed writes seen since the module loaded, for attributing a write to the task running. */
let writesSeen = 0;

const authoritativeStores = shallowRef(false);

/**
 * True once the stores were reloaded from the authoritative document (a maintenance run
 * passed its authoritative check with no hold in force, so on path 1a not before the boot
 * Drive read ended), false again at every projection reset (sign-out, family switch).
 * Automatic writers that act on store data guard their WRITE entry on this, never
 * `isDocLoaded()` (true on a snapshot) nor the raw `isAuthoritativeLoaded()` (true at install,
 * before the stores are reloaded from the installed document).
 */
export const storesAuthoritative: ComputedRef<boolean> = computed(() => authoritativeStores.value);

/**
 * Called next to every `resetProjection` (`docClient.reset`, `docClient.clearCache`): the
 * stores stop being authoritative for this family. A hold taken for it is VOID: its lapse is
 * cleared, its parked request dropped, and its release function can no longer start a run or
 * raise the flag for whichever family loads next.
 */
export function clearStoresAuthoritative(): void {
  if (hold) clearTimeout(hold.timer);
  hold = null;
  authoritativeStores.value = false;
}

/**
 * Register a load-time writer. Called once at store setup; a later registration under the
 * same name replaces the earlier one (a store re-created in a new Pinia keeps one entry).
 * Tasks run one at a time, in registration order.
 */
export function registerLoadMaintenance(name: string, task: LoadMaintenanceTask): void {
  tasks.set(name, task);
}

/** How many tasks are registered (for open telemetry). */
export function loadMaintenanceTaskCount(): number {
  return tasks.size;
}

/**
 * Run every registered task, once, against the stores as they are now. Returns `void` so
 * nothing can await it: the caller (a store reload) is never held up by a write.
 * A no-op unless the document is authoritative. Single-flight: a request while a run is in
 * flight is coalesced into ONE rerun after it; a request while held waits for the hold to end.
 */
export function runLoadMaintenance(trigger: string): void {
  if (!isAuthoritativeLoaded()) return;
  // HELD FIRST, then the flag. The flag releases every automatic writer gated on it (calendar
  // reconcile, hints, card reminders, What's New, flight status, the day-rollover watchers):
  // set during the boot Drive read, their debounced save lands inside the download (a second
  // full read) and they act on pre-merge data. The hold's end sets it, through here.
  if (hold) {
    hold.trigger = trigger;
    return;
  }
  authoritativeStores.value = true;
  if (running) {
    rerunTrigger = trigger;
    return;
  }
  draining = drain(trigger);
}

/** Ends the hold it was made with. Idempotent, and a no-op once that hold has ended any other
 *  way (lapsed, voided by a sign-out or family switch, or superseded by a newer hold). */
export type ReleaseLoadMaintenance = () => void;

/**
 * Hold maintenance (the boot Drive read on path 1a): requests are parked, ONE run when the hold
 * ends. Returns the ONLY way to end it; pass it to whatever ends the read, and nothing that did
 * not take the hold can release it. A newer hold supersedes one still in force (it inherits the
 * parked request; the older release becomes a no-op), so an older owner never ends it early.
 * After `HOLD_MAX_MS` the hold lapses on its own: the run happens and a warning names it.
 */
export function holdLoadMaintenance(): ReleaseLoadMaintenance {
  const prior = hold;
  if (prior) clearTimeout(prior.timer);
  const mine: Hold = {
    trigger: prior?.trigger ?? null,
    timer: setTimeout(() => {
      if (hold !== mine) return;
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'hold lapsed without a release; maintenance runs now',
        context: { action: 'hold-lapsed', kind: mine.trigger ?? 'none' },
      });
      endHold(mine);
    }, HOLD_MAX_MS),
  };
  hold = mine;
  return () => endHold(mine);
}

/** End `h` if it is still the hold in force, and run its parked request, if any. */
function endHold(h: Hold): void {
  if (hold !== h) return;
  clearTimeout(h.timer);
  hold = null;
  if (h.trigger !== null) runLoadMaintenance(h.trigger);
}

/** The run in flight (test support: `__whenLoadMaintenanceIdleForTesting`). */
let draining: Promise<void> = Promise.resolve();

async function drain(first: string): Promise<void> {
  running = true;
  try {
    let next: string | null = first;
    while (next !== null) {
      rerunTrigger = null;
      try {
        await runOnce(next);
      } catch (error) {
        // Each task has its own catch; this is the runner itself (never an unhandled rejection).
        reportError({
          surface: SURFACE,
          severity: 'error',
          message: 'load maintenance run failed',
          error,
          context: { kind: next },
        });
      }
      if (hold && rerunTrigger !== null) hold.trigger = rerunTrigger; // a hold began meanwhile
      next = hold ? null : rerunTrigger;
    }
  } finally {
    running = false;
  }
}

async function runOnce(trigger: string): Promise<void> {
  const familyId = getActiveFamilyId();
  const started = performance.now();
  const wrote: string[] = [];
  let ran = 0;
  for (const [name, task] of tasks) {
    // A sign-out or family switch mid-run: never write into another family's document.
    const stop =
      getActiveFamilyId() !== familyId
        ? 'family-changed'
        : !isAuthoritativeLoaded() || !authoritativeStores.value
          ? 'not-authoritative'
          : null;
    if (stop) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'maintenance run stopped',
        context: { action: 'stopped', kind: trigger, detail: stop, count: ran },
      });
      return;
    }
    ran++;
    const before = writesSeen;
    try {
      await task();
    } catch (error) {
      reportError({
        surface: SURFACE,
        severity: 'error',
        message: `load maintenance task '${name}' failed; it runs again on the next reload`,
        error,
        context: { kind: name },
      });
    }
    if (writesSeen > before) wrote.push(name);
  }
  if (wrote.length === 0) return;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'maintenance ran',
    context: {
      action: 'ran',
      kind: trigger,
      count: ran,
      perf_duration_ms: Math.round(performance.now() - started),
      detail: wrote.join(','),
    },
  });
}

/** `docClient.mutate` after a write that changed the document (attributes it to a task). */
export function noteDocWrite(): void {
  writesSeen++;
}

// ─── The load phase (the guard) ────────────────────────────────────────────────

let loadPhaseDepth = 0;

/** Enter a store-load phase. Pair with `endLoadPhase` in a `finally`. Nests. */
export function beginLoadPhase(): void {
  loadPhaseDepth++;
}

export function endLoadPhase(): void {
  loadPhaseDepth = Math.max(0, loadPhaseDepth - 1);
}

export function inLoadPhase(): boolean {
  return loadPhaseDepth > 0;
}

/** Where recorded violations live: on `globalThis`, so the vitest setup's `afterEach` still
 *  sees them in a test that re-imports this module (`vi.resetModules`). */
const VIOLATIONS_KEY = '__beaniesLoadPhaseWrites';
type ViolationHolder = { [VIOLATIONS_KEY]?: string[] };

let reportedThisSession = false;

/**
 * A `mutate` was issued inside a load phase. In unit tests: recorded AND thrown (store actions
 * swallow a throw through `wrapAsync`, so the record is what fails the test). In production:
 * the write still goes ahead (never drop a write); reported once per session, and only when
 * the document is not authoritative (a user's edit during a post-merge reload is no defect).
 */
export function noteLoadPhaseWrite(kind: string): void {
  if (import.meta.env.MODE === 'test') {
    const holder = globalThis as ViolationHolder;
    (holder[VIOLATIONS_KEY] ??= []).push(kind);
    throw new Error(
      `[load-phase] a document write ('${kind}') was issued while store loaders were running; ` +
        'loaders must be read-only (register the writer with registerLoadMaintenance)'
    );
  }
  if (reportedThisSession || isAuthoritativeLoaded()) return;
  reportedThisSession = true;
  reportError({
    surface: 'load-phase-write',
    severity: 'error',
    message: 'a store loader wrote to the document during the load phase',
    context: { kind },
  });
}

/** Test support: the load-phase writes recorded since the last call, cleared. */
export function takeLoadPhaseViolations(): string[] {
  const holder = globalThis as ViolationHolder;
  const out = holder[VIOLATIONS_KEY] ?? [];
  holder[VIOLATIONS_KEY] = [];
  return out;
}

/** Test support: set `storesAuthoritative` directly (a test with no store reload to run). */
export function __setStoresAuthoritativeForTesting(value: boolean): void {
  authoritativeStores.value = value;
}

/** Test support: resolves when the run in flight (and its coalesced rerun) has finished. */
export async function __whenLoadMaintenanceIdleForTesting(): Promise<void> {
  while (running) await draining;
}

export function __resetLoadMaintenanceForTesting(): void {
  tasks.clear();
  running = false;
  rerunTrigger = null;
  if (hold) clearTimeout(hold.timer);
  hold = null;
  writesSeen = 0;
  authoritativeStores.value = false;
  loadPhaseDepth = 0;
  reportedThisSession = false;
}
