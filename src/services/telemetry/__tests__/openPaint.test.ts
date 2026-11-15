import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEvent, reportError } = vi.hoisted(() => ({ logEvent: vi.fn(), reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/services/automerge/loadMaintenance', () => ({ loadMaintenanceTaskCount: () => 5 }));

import {
  buildOpenPaintContext,
  noteOpenPaint,
  resetOpenPaintForTests,
  snapshotDetail,
} from '@/services/telemetry/openPaint';
import { beginOpen, endOpen, setOpenPath, type OpenPath } from '@/services/telemetry/openCycle';

describe('openPaint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOpenPaintForTests();
  });

  it('describes every snapshot answer', () => {
    expect(snapshotDetail({ hit: true })).toBe('hit');
    expect(snapshotDetail({ hit: false, reason: 'version' })).toBe('miss-version');
    expect(snapshotDetail({ hit: false, reason: 'collections' })).toBe('miss-collections');
    expect(snapshotDetail({ hit: false, reason: 'absent' })).toBe('miss-absent');
    expect(snapshotDetail({ hit: false, reason: 'error' })).toBe('miss-error');
    expect(snapshotDetail(null)).toBe('n/a');
  });

  it('builds a rounded, allowlisted context', () => {
    expect(
      buildOpenPaintContext({
        ms: 812.6,
        kind: 'snapshot',
        stage: '1a',
        snapshot: { hit: true },
        taskCount: 3,
      })
    ).toEqual({ perf_duration_ms: 813, kind: 'snapshot', stage: '1a', detail: 'snap=hit;tasks=3' });
  });

  it('emits exactly once per page load, as an info event', () => {
    const token = beginOpen();
    setOpenPath('path1a');
    noteOpenPaint({ kind: 'snapshot', snapshot: { hit: true } });
    noteOpenPaint({ kind: 'cache', snapshot: { hit: true } });
    expect(logEvent).toHaveBeenCalledTimes(1);
    endOpen('open-complete', token);
    const arg = logEvent.mock.calls[0]![0];
    expect(arg).toMatchObject({ level: 'info', surface: 'open-paint' });
    expect(arg.context).toMatchObject({
      kind: 'snapshot',
      stage: '1a',
      detail: 'snap=hit;tasks=5',
    });
  });

  it('never throws; a failing logger is reported at warning', () => {
    logEvent.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => noteOpenPaint({ kind: 'drive', snapshot: null })).not.toThrow();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });

  // The stage comes from the open window, so the one loader shared by paths 1a and 2
  // (`loadFromPersistenceCache`) can no longer label a path-2 open as 1a.
  it.each<[OpenPath, string]>([
    ['path1a', '1a'],
    ['path1b', '1b'],
    ['path2', '2'],
    ['path3', '3'],
  ])('labels an open that reached %s as stage %s', (path, stage) => {
    const token = beginOpen();
    setOpenPath(path);
    noteOpenPaint({ kind: 'cache', snapshot: null });
    endOpen('open-complete', token);
    expect(logEvent.mock.calls[0]![0].context).toMatchObject({ stage });
  });

  it('says `unknown` rather than guess when no open is in flight', () => {
    noteOpenPaint({ kind: 'drive', snapshot: null });
    expect(logEvent.mock.calls[0]![0].context).toMatchObject({ stage: 'unknown' });
  });
});

/**
 * Every `loadFamilyData` exit that leaves family data in the stores emits `open-paint`. App.vue
 * is not mounted by any unit test, so this pins the wiring at source level (in the style of
 * `syncStore.snapshotPaint.test.ts`).
 */
describe('App.vue: open-paint on every path that ends with family data', () => {
  const app = async (): Promise<string> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '../../../..', 'src/App.vue'), 'utf8');
  };
  const between = (code: string, from: string, to: string): string => {
    const start = code.indexOf(from);
    const end = code.indexOf(to, start + from.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return code.slice(start, end);
  };

  it('path 1b emits on the direct success AND on the cached-key decrypt (the cold-boot route)', async () => {
    const block = between(await app(), "setOpenPath('path1b')", "setOpenPath('path2')");
    const cachedKey = between(block, 'tryDecryptWithCachedKey()', 'resume-setup');
    expect(block.match(/noteOpenPaint\(\{ kind: 'drive'/g)).toHaveLength(2);
    expect(between(cachedKey, 'if (success) {', 'return;')).toContain('noteOpenPaint(');
  });

  it('path 3 (the direct loaders) emits as `direct`, only when family data loaded', async () => {
    const block = between(await app(), "setOpenPath('path3')", "runLoadMaintenance('direct')");
    expect(block).toContain(
      "if (familyStore.isSetupComplete) noteOpenPaint({ kind: 'direct', snapshot: null });"
    );
  });

  it('never hard-codes a stage at a call site', async () => {
    expect(await app()).not.toMatch(/noteOpenPaint\(\{[^}]*stage:/);
  });
});
