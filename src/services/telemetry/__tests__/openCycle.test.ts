/**
 * Open-cycle counter window.
 *
 * The window discipline IS the design here: these counters exist to prove "one
 * open did exactly one CRDT reconstruction, zero redundant reads and zero
 * pointless writes", and a counter that leaks across opens — or that counts a
 * header Refresh as an app open — would quietly report the wrong numbers and let
 * a redundancy regression pass review. So the no-op-outside-a-window rule and the
 * emit-once rule are the load-bearing behaviours, not incidental.
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
  isOpenWindowActive,
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
      // `backgroundSyncFromFile` is reachable from the header Refresh button and
      // the deferred config-heal, neither of which is an app open. They must not
      // inflate the next open's numbers.
      bump('reconstruction');
      bump('driveRead');
      bump('driveWrite');
      noteSnapshot(true);
      expect(isOpenWindowActive()).toBe(false);

      endOpen('open-complete');
      expect(logEvent).not.toHaveBeenCalled();

      // ...and the counts did not survive into the next real open.
      beginOpen('path1a');
      endOpen('open-complete');
      expect(emitted()!.message).toContain('rec=0 reads=0 writes=0 reloads=0 snap=none');
    });

    it('emits exactly once — a second endOpen is a no-op', () => {
      beginOpen('path1a');
      bump('driveRead');
      endOpen('open-complete');
      expect(logEvent).toHaveBeenCalledTimes(1);

      endOpen('open-complete');
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(isOpenWindowActive()).toBe(false);
    });

    it('emits the stale window as open-abandoned rather than discarding its counts', () => {
      beginOpen('path1a');
      bump('reconstruction');

      beginOpen('path1b'); // e.g. a family switch mid-open

      const abandoned = logEvent.mock.calls[0]![0] as {
        message: string;
        context: { action: string };
      };
      expect(abandoned.context.action).toBe('open-abandoned');
      expect(abandoned.message).toContain('rec=1');
      // The new window starts clean.
      endOpen('open-complete');
      expect(emitted()!.message).toContain('path=path1b rec=0');
    });
  });

  describe('counting', () => {
    it('accumulates each counter independently and reports them in message + detail', () => {
      beginOpen('path1a');
      bump('reconstruction');
      bump('reconstruction');
      bump('driveRead');
      bump('storeReload');
      bump('storeReload');
      bump('storeReload');
      noteSnapshot(true);
      endOpen('open-complete', { providerType: 'google_drive' });

      const rec = emitted()!;
      expect(rec.surface).toBe('open-cycle');
      expect(rec.level).toBe('info');
      // Two reconstructions in one open is exactly the redundancy this issue exists
      // to remove — the counter must make it visible.
      expect(rec.message).toContain('rec=2 reads=1 writes=0 reloads=3 snap=hit');
      expect(rec.context.detail).toContain('rec=2 reads=1 writes=0 reloads=3 snap=hit');
      expect(rec.context.action).toBe('open-complete');
      expect(rec.context.provider_type).toBe('google_drive');
    });

    it('records a snapshot miss distinctly from no snapshot attempt', () => {
      beginOpen('path1b');
      noteSnapshot(false);
      endOpen('open-complete');
      expect(emitted()!.message).toContain('snap=miss');
    });
  });

  describe('path labelling', () => {
    it('relabels on fallthrough without restarting the counters', () => {
      // path1a falling through to path1b is ONE open that did BOTH pieces of work.
      // Restarting would under-count it and emit a spurious open-abandoned.
      beginOpen();
      setOpenPath('path1a');
      bump('reconstruction'); // the cache load
      setOpenPath('path1b');
      bump('reconstruction'); // the Drive load
      bump('driveRead');
      endOpen('open-complete');

      expect(logEvent).toHaveBeenCalledTimes(1); // no open-abandoned
      expect(emitted()!.message).toContain('path=path1b rec=2 reads=1');
    });

    it('setOpenPath outside a window is a no-op', () => {
      setOpenPath('path3');
      expect(isOpenWindowActive()).toBe(false);
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    it('warns and carries the classified reason on a fail-open', () => {
      beginOpen('path1a');
      endOpen('open-fail-open', { failOpenReason: 'no-baseline' });

      const rec = emitted()!;
      expect(rec.level).toBe('warn');
      expect(rec.context.action).toBe('open-fail-open');
      expect(rec.context.error_code).toBe('no-baseline');
    });

    it('emits a skip at info with no error_code', () => {
      beginOpen('path1a');
      endOpen('open-skip', { detailSuffix: 'baseline_age_ms=1200' });

      const rec = emitted()!;
      expect(rec.level).toBe('info');
      expect(rec.context.action).toBe('open-skip');
      expect(rec.context.error_code).toBeUndefined();
      expect(rec.context.detail).toContain('baseline_age_ms=1200');
    });
  });

  it('ships only pre-existing allowlisted context keys', () => {
    // Adding a key here means updating ALLOWED_CONTEXT_KEYS in
    // src/utils/diagnosticContext.ts AND its mirror in the telemetry Lambda AND
    // the app-store data-collection declarations. This test is the reminder — a
    // new key would otherwise be silently stripped server-side.
    beginOpen('path1a');
    endOpen('open-fail-open', { failOpenReason: 'provider-error', providerType: 'google_drive' });

    expect(Object.keys(emitted()!.context).sort()).toEqual([
      'action',
      'detail',
      'error_code',
      'provider_type',
    ]);
  });
});
