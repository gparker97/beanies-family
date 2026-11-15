import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let activeFamily: string | null = 'fam-a';
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: () => activeFamily }));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import {
  registerLoadMaintenance,
  runLoadMaintenance,
  holdLoadMaintenance,
  storesAuthoritative,
  clearStoresAuthoritative,
  beginLoadPhase,
  endLoadPhase,
  inLoadPhase,
  noteLoadPhaseWrite,
  noteDocWrite,
  takeLoadPhaseViolations,
  loadMaintenanceTaskCount,
  __resetLoadMaintenanceForTesting,
} from '../loadMaintenance';
import { markAuthoritative, resetProjection } from '../projection';

/** A promise the test resolves by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetLoadMaintenanceForTesting();
  resetProjection();
  activeFamily = 'fam-a';
  reportError.mockClear();
  logEvent.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runLoadMaintenance', () => {
  it('does nothing until the document is authoritative', async () => {
    const task = vi.fn(async () => {});
    registerLoadMaintenance('t', task);
    runLoadMaintenance('reload');
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(storesAuthoritative.value).toBe(false);

    markAuthoritative();
    runLoadMaintenance('reload');
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    expect(storesAuthoritative.value).toBe(true);
  });

  it('returns void: nothing can await it', () => {
    markAuthoritative();
    expect(runLoadMaintenance('reload')).toBeUndefined();
  });

  it('runs tasks one at a time, in registration order', async () => {
    markAuthoritative();
    const order: string[] = [];
    const gate = deferred();
    registerLoadMaintenance('a', async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
    });
    registerLoadMaintenance('b', async () => {
      order.push('b');
    });
    runLoadMaintenance('reload');
    await flush();
    expect(order).toEqual(['a:start']);
    gate.resolve();
    await flush();
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('is single-flight with ONE coalesced rerun', async () => {
    markAuthoritative();
    const gate = deferred();
    let calls = 0;
    registerLoadMaintenance('t', async () => {
      calls++;
      if (calls === 1) await gate.promise;
    });
    runLoadMaintenance('reload');
    runLoadMaintenance('reload');
    runLoadMaintenance('reload');
    runLoadMaintenance('reload');
    await flush();
    expect(calls).toBe(1);
    gate.resolve();
    await flush();
    expect(calls).toBe(2);
  });

  it('a throwing task is reported and does not stop the rest', async () => {
    markAuthoritative();
    const after = vi.fn(async () => {});
    registerLoadMaintenance('boom', async () => {
      throw new Error('nope');
    });
    registerLoadMaintenance('after', after);
    runLoadMaintenance('reload');
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'load-maintenance',
        severity: 'error',
        context: { kind: 'boom' },
      })
    );
  });

  it('a later registration under the same name replaces the earlier one', async () => {
    markAuthoritative();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    registerLoadMaintenance('t', first);
    registerLoadMaintenance('t', second);
    expect(loadMaintenanceTaskCount()).toBe(1);
    runLoadMaintenance('reload');
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops before the next task when the family changes mid-run', async () => {
    markAuthoritative();
    const second = vi.fn(async () => {});
    registerLoadMaintenance('first', async () => {
      activeFamily = 'fam-b'; // a family switch lands while the first task writes
    });
    registerLoadMaintenance('second', second);
    runLoadMaintenance('reload');
    await flush();
    expect(second).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'load-maintenance',
        context: expect.objectContaining({ action: 'stopped', detail: 'family-changed' }),
      })
    );
  });

  it('stops before the next task when the document stops being authoritative (sign-out)', async () => {
    markAuthoritative();
    const second = vi.fn(async () => {});
    registerLoadMaintenance('first', async () => {
      resetProjection();
      clearStoresAuthoritative();
    });
    registerLoadMaintenance('second', second);
    runLoadMaintenance('reload');
    await flush();
    expect(second).not.toHaveBeenCalled();
  });

  it('logs ONE load-maintenance event per run that wrote, naming the writers', async () => {
    markAuthoritative();
    registerLoadMaintenance('quiet', async () => {});
    registerLoadMaintenance('writer', async () => noteDocWrite());
    runLoadMaintenance('open');
    await flush();
    const ran = logEvent.mock.calls.filter(
      ([e]) => (e as { surface: string }).surface === 'load-maintenance'
    );
    expect(ran).toHaveLength(1);
    expect(ran[0][0]).toMatchObject({
      level: 'info',
      context: { action: 'ran', kind: 'open', count: 2, detail: 'writer' },
    });
  });

  it('logs nothing for a run in which no task wrote', async () => {
    markAuthoritative();
    registerLoadMaintenance('quiet', async () => {});
    runLoadMaintenance('reload');
    await flush();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('hold / release', () => {
  it('holds requests and runs ONE coalesced run when its owner releases', async () => {
    markAuthoritative();
    const task = vi.fn(async () => {});
    registerLoadMaintenance('t', task);
    const release = holdLoadMaintenance();
    runLoadMaintenance('reload');
    runLoadMaintenance('reload');
    await flush();
    expect(task).not.toHaveBeenCalled();
    // Nor the flag-gated writers (calendar reconcile, hints, reminders, What's New, flights,
    // the day-rollover watchers): their saves would land inside the boot download.
    expect(storesAuthoritative.value).toBe(false);
    release();
    expect(storesAuthoritative.value).toBe(true);
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('a release with nothing requested runs nothing, and a second release is a no-op', async () => {
    markAuthoritative();
    const task = vi.fn(async () => {});
    registerLoadMaintenance('t', task);
    const release = holdLoadMaintenance();
    release();
    runLoadMaintenance('reload'); // no hold now: runs at once
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    const again = holdLoadMaintenance();
    runLoadMaintenance('reload');
    release(); // the FIRST hold's release cannot end the second hold
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    again();
    await flush();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('a newer hold supersedes one in force: the older release is a no-op, the request carries', async () => {
    markAuthoritative();
    const task = vi.fn(async () => {});
    registerLoadMaintenance('t', task);
    const older = holdLoadMaintenance();
    runLoadMaintenance('reload');
    const newer = holdLoadMaintenance();
    older();
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(storesAuthoritative.value).toBe(false);
    newer();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('a hold nobody released lapses, runs, and says so; its release is then a no-op', async () => {
    vi.useFakeTimers();
    markAuthoritative();
    const task = vi.fn(async () => {});
    registerLoadMaintenance('t', task);
    const release = holdLoadMaintenance();
    runLoadMaintenance('reload');
    await vi.advanceTimersByTimeAsync(119_000);
    expect(task).not.toHaveBeenCalled();
    expect(storesAuthoritative.value).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(storesAuthoritative.value).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'hold-lapsed' }),
      })
    );
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
  });
});

/**
 * A hold belongs to one family session. `clearStoresAuthoritative` (sign-out, family switch)
 * left the hold, its parked request and its lapse timer in force, so the next family's
 * maintenance stayed suppressed for up to 120 s, or the old read's release drained tasks against
 * the next family's half-loaded stores (the runner reads the family id only at its own start).
 */
describe('a hold is void once the stores stop being authoritative for its family', () => {
  /** Family A holds and parks a request; then a sign-out or switch lands and B loads. */
  function holdForAThenSwitchToB(task: () => Promise<void>) {
    markAuthoritative();
    registerLoadMaintenance('t', task);
    const releaseA = holdLoadMaintenance();
    runLoadMaintenance('reload');
    resetProjection();
    clearStoresAuthoritative();
    activeFamily = 'fam-b';
    markAuthoritative();
    return releaseA;
  }

  it("B taking no hold: B's reload runs at once, A's lapse never fires, A's release does nothing", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const releaseA = holdForAThenSwitchToB(task);
    expect(storesAuthoritative.value).toBe(false);

    runLoadMaintenance('reload'); // B's authoritative reload (path 1b: no hold)
    expect(storesAuthoritative.value).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    releaseA(); // A's boot read ending late
    await vi.advanceTimersByTimeAsync(121_000); // past A's lapse
    expect(task).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'hold-lapsed' }) })
    );
  });

  it("B holding: A's stale release neither runs B's tasks nor raises the flag, and A's request is gone", async () => {
    const task = vi.fn(async () => {});
    const releaseA = holdForAThenSwitchToB(task);
    const releaseB = holdLoadMaintenance(); // B's own path 1a

    releaseA(); // A's read ends while B's stores are half-loaded
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(storesAuthoritative.value).toBe(false);

    releaseB(); // B asked for nothing yet: A's parked request was dropped with A's hold
    await flush();
    expect(task).not.toHaveBeenCalled();

    const releaseB2 = holdLoadMaintenance();
    runLoadMaintenance('reload'); // B's reload, parked under B's hold
    releaseA();
    await flush();
    expect(task).not.toHaveBeenCalled();
    releaseB2();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    expect(storesAuthoritative.value).toBe(true);
  });
});

describe('storesAuthoritative', () => {
  it('is cleared by clearStoresAuthoritative (every projection reset)', async () => {
    markAuthoritative();
    runLoadMaintenance('reload');
    expect(storesAuthoritative.value).toBe(true);
    resetProjection();
    clearStoresAuthoritative();
    expect(storesAuthoritative.value).toBe(false);
    // A new install alone does not set it: only a reload's maintenance call does.
    markAuthoritative();
    expect(storesAuthoritative.value).toBe(false);
  });
});

describe('the load phase', () => {
  it('is a depth counter', () => {
    expect(inLoadPhase()).toBe(false);
    beginLoadPhase();
    beginLoadPhase();
    endLoadPhase();
    expect(inLoadPhase()).toBe(true);
    endLoadPhase();
    expect(inLoadPhase()).toBe(false);
    endLoadPhase(); // an unpaired end never goes negative
    beginLoadPhase();
    expect(inLoadPhase()).toBe(true);
    endLoadPhase();
  });

  it('in unit tests a load-phase write throws AND is recorded, authoritative or not', () => {
    expect(() => noteLoadPhaseWrite('lists')).toThrow(/load-phase/);
    markAuthoritative();
    expect(() => noteLoadPhaseWrite('todos')).toThrow(/load-phase/);
    expect(takeLoadPhaseViolations()).toEqual(['lists', 'todos']);
    expect(takeLoadPhaseViolations()).toEqual([]);
  });

  it('in production the write goes ahead and is reported once, only when not authoritative', () => {
    vi.stubEnv('MODE', 'production');
    markAuthoritative();
    expect(() => noteLoadPhaseWrite('lists')).not.toThrow();
    expect(reportError).not.toHaveBeenCalled(); // a user edit during a post-merge reload

    resetProjection();
    noteLoadPhaseWrite('lists');
    noteLoadPhaseWrite('todos');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'load-phase-write',
        severity: 'error',
        context: { kind: 'lists' },
      })
    );
    expect(takeLoadPhaseViolations()).toEqual([]);
  });
});
