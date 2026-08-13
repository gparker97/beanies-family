/**
 * Open-cycle counter window.
 *
 * The window discipline IS the design here: these counters exist to prove "one
 * open did exactly one CRDT reconstruction, zero redundant reads and zero
 * pointless writes", and a counter that leaks across opens — or that counts a
 * header Refresh as an app open, or lets a Refresh close the real open's window —
 * would quietly report the wrong numbers. The bias of every such bug is toward
 * FALSE NEGATIVES (the redundancy fix looks like it worked when it did not), so
 * the ownership and no-op-outside-a-window rules are load-bearing, not incidental.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const logEvent = vi.fn();
vi.mock('../logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import {
  beginOpen,
  setOpenPath,
  bump,
  noteSnapshot,
  endOpen,
  __resetOpenCycleForTesting,
} from '../openCycle';

/** The single emitted record, or null if nothing was emitted. */
function emitted() {
  if (logEvent.mock.calls.length === 0) return null;
  return logEvent.mock.calls[logEvent.mock.calls.length - 1]![0] as {
    level: string;
    surface: string;
    message: string;
    context: Record<string, unknown>;
  };
}

describe('openCycle', () => {
  beforeEach(() => {
    logEvent.mockClear();
    __resetOpenCycleForTesting();
  });

  describe('window discipline', () => {
    it('counts nothing when no window is open — the header Refresh / poll-tick case', () => {
      bump('reconstruction');
      bump('driveRead');
      bump('driveWrite');
      noteSnapshot(true);

      endOpen('open-complete', 1);
      expect(logEvent).not.toHaveBeenCalled();

      // ...and the counts did not survive into the next real open.
      const t = beginOpen('path1a');
      endOpen('open-complete', t);
      expect(emitted()!.message).toContain('rec=0 reads=0 writes=0 reloads=0 snap=none');
    });

    it('emits exactly once — a second endOpen with the same token is a no-op', () => {
      const t = beginOpen('path1a');
      bump('driveRead');
      endOpen('open-complete', t);
      expect(logEvent).toHaveBeenCalledTimes(1);

      endOpen('open-complete', t);
      expect(logEvent).toHaveBeenCalledTimes(1);
    });

    it('emits the stale window as open-abandoned rather than discarding its counts', () => {
      beginOpen('path1a');
      bump('reconstruction');

      const t2 = beginOpen('path1b'); // e.g. a family switch mid-open

      const abandoned = logEvent.mock.calls[0]![0] as {
        level: string;
        message: string;
        context: { action: string };
      };
      expect(abandoned.context.action).toBe('open-abandoned');
      expect(abandoned.level).toBe('warn');
      expect(abandoned.message).toContain('rec=1');

      endOpen('open-complete', t2);
      expect(emitted()!.message).toContain('path=path1b rec=0');
    });
  });

  describe('ownership — a non-owner must never close the window', () => {
    it('ignores endOpen with NO token (the header Refresh / config-heal path)', () => {
      // Refresh reaches `backgroundSyncFromFile` mid-open and calls endOpen with
      // `openToken === undefined`. If that closed the window, the real open's
      // remaining reads/writes would all no-op and the record would ship
      // `reads=0 writes=0` — the redundancy fix looking successful when it wasn't.
      const t = beginOpen('path1a');
      bump('driveRead');

      endOpen('open-complete', undefined);
      expect(logEvent).not.toHaveBeenCalled();

      // The real open's later work is still counted.
      bump('driveWrite');
      endOpen('open-complete', t);
      expect(emitted()!.message).toContain('reads=1 writes=1');
    });

    it('ignores endOpen with a STALE token from a previous window', () => {
      const stale = beginOpen('path1a');
      endOpen('open-complete', stale);
      logEvent.mockClear();

      const current = beginOpen('path1b');
      bump('reconstruction');
      endOpen('open-complete', stale); // the previous open's holder, arriving late
      expect(logEvent).not.toHaveBeenCalled();

      endOpen('open-complete', current);
      expect(emitted()!.message).toContain('path=path1b rec=1');
    });
  });

  describe('counting', () => {
    it('accumulates each counter independently and reports them in message + detail', () => {
      const t = beginOpen('path1a');
      bump('reconstruction');
      bump('reconstruction');
      bump('driveRead');
      bump('storeReload');
      bump('storeReload');
      bump('storeReload');
      noteSnapshot(true);
      endOpen('open-complete', t);

      const rec = emitted()!;
      expect(rec.surface).toBe('open-cycle');
      expect(rec.level).toBe('info');
      // Two reconstructions in one open is exactly the redundancy this issue exists
      // to remove — the counter must make it visible.
      expect(rec.message).toContain('rec=2 reads=1 writes=0 reloads=3 snap=hit');
      expect(rec.context.detail).toContain('rec=2 reads=1 writes=0 reloads=3 snap=hit');
      expect(rec.context.action).toBe('open-complete');
    });

    it('records a snapshot miss distinctly from no snapshot attempt', () => {
      const t = beginOpen('path1b');
      noteSnapshot(false);
      endOpen('open-complete', t);
      expect(emitted()!.message).toContain('snap=miss');
    });
  });

  describe('path labelling', () => {
    it('relabels on fallthrough without restarting the counters', () => {
      // path1a falling through to path1b is ONE open that did BOTH pieces of work.
      // Restarting would under-count it and emit a spurious open-abandoned.
      const t = beginOpen();
      setOpenPath('path1a');
      bump('reconstruction'); // the cache load
      setOpenPath('path1b');
      bump('reconstruction'); // the Drive load
      bump('driveRead');
      endOpen('open-complete', t);

      expect(logEvent).toHaveBeenCalledTimes(1); // no open-abandoned
      expect(emitted()!.message).toContain('path=path1b rec=2 reads=1');
    });

    it('setOpenPath outside a window is a no-op', () => {
      setOpenPath('path3');
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    it('reports a failed open as a warn, so the failure RATE is measurable', () => {
      // Emitting every terminal as `open-complete` would make the open-failure rate
      // 0% by construction — the opposite of what these counters are for.
      const t = beginOpen('path1a');
      endOpen('open-failed', t);

      const rec = emitted()!;
      expect(rec.level).toBe('warn');
      expect(rec.context.action).toBe('open-failed');
    });

    it('warns and carries the classified reason on a fail-open', () => {
      const t = beginOpen('path1a');
      endOpen('open-fail-open', t, { failOpenReason: 'no-baseline' });

      const rec = emitted()!;
      expect(rec.level).toBe('warn');
      expect(rec.context.error_code).toBe('no-baseline');
    });

    it('emits a skip at info with no error_code', () => {
      const t = beginOpen('path1a');
      endOpen('open-skip', t, { detailSuffix: 'baseline_age_ms=1200' });

      const rec = emitted()!;
      expect(rec.level).toBe('info');
      expect(rec.context.action).toBe('open-skip');
      expect(rec.context.error_code).toBeUndefined();
      expect(rec.context.detail).toContain('baseline_age_ms=1200');
    });
  });

  it('ships only pre-existing allowlisted context keys, and never provider_type', () => {
    // `enrichAndRedact` overwrites `provider_type` from the sync store on every
    // event, so passing one here would be dead plumbing that reads as intent.
    // Adding any OTHER key means updating ALLOWED_CONTEXT_KEYS in
    // src/utils/diagnosticContext.ts AND its mirror in the telemetry Lambda AND the
    // app-store data-collection declarations — otherwise it is silently stripped.
    const t = beginOpen('path1a');
    endOpen('open-fail-open', t, { failOpenReason: 'provider-error' });

    expect(Object.keys(emitted()!.context).sort()).toEqual(['action', 'detail', 'error_code']);
  });
});
