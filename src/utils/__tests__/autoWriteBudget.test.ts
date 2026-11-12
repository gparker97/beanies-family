import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError }));

import { AUTO_WRITE_POLICY, takeAutoWrite } from '../autoWriteBudget';
import { __resetAttemptBudgetForTests } from '../attemptBudget';

const DAY = 86_400_000;
const T0 = new Date('2026-11-12T08:00:00.000Z');

function take(writer: string, n: number): boolean[] {
  return Array.from({ length: n }, () => takeAutoWrite(writer));
}

const cappedReports = () =>
  reportError.mock.calls
    .map(
      ([input]) => input as { surface: string; severity: string; context?: Record<string, unknown> }
    )
    .filter((r) => r.context?.action === 'auto-write-capped');

describe('autoWriteBudget', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    __resetAttemptBudgetForTests();
    reportError.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('is 40 writes over a rolling day', () => {
    expect(AUTO_WRITE_POLICY).toEqual({ max: 40, windowMs: DAY });
  });

  it('allows 40 writes and refuses the 41st', () => {
    const results = take('helpful-hints', 41);
    expect(results.slice(0, 40).every(Boolean)).toBe(true);
    expect(results[40]).toBe(false);
  });

  it('frees again once the window rolls past the oldest write', () => {
    take('helpful-hints', 40);
    vi.setSystemTime(T0.getTime() + DAY - 1);
    expect(takeAutoWrite('helpful-hints')).toBe(false);
    vi.setSystemTime(T0.getTime() + DAY);
    expect(takeAutoWrite('helpful-hints')).toBe(true);
  });

  it('keeps each writer on its own budget', () => {
    take('helpful-hints', 40);
    expect(takeAutoWrite('helpful-hints')).toBe(false);
    expect(takeAutoWrite('card-reminders')).toBe(true);
    expect(cappedReports().map((r) => r.surface)).toEqual(['helpful-hints']);
  });

  it('reports a sustained refusal once (latched), with the cause and when it resets', () => {
    take('helpful-hints', 40);
    expect(take('helpful-hints', 5).some(Boolean)).toBe(false);

    expect(cappedReports()).toEqual([
      {
        surface: 'helpful-hints',
        severity: 'error',
        message: 'automatic write cap reached; writes deferred',
        context: { action: 'auto-write-capped', detail: 'writer=helpful-hints;resets_in_min=1440' },
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      `helpful-hints hit its automatic write cap; writes deferred until ${new Date(
        T0.getTime() + DAY
      ).toISOString()}`
    );
  });

  it('reports again when the cap is hit in a later window', () => {
    take('helpful-hints', 41); // first report at T0
    vi.setSystemTime(T0.getTime() + DAY);
    take('helpful-hints', 41); // the budget and the latch have both rolled
    expect(cappedReports()).toHaveLength(2);
  });

  it('reports the next day too, when the first refusal came after the budget window began', () => {
    take('helpful-hints', 40); // slots spent at T0
    vi.setSystemTime(T0.getTime() + 5 * 60_000);
    take('helpful-hints', 1); // first refusal and report at T0 + 5 min
    vi.setSystemTime(T0.getTime() + DAY + 60_000);
    take('helpful-hints', 41); // slots freed at T0 + DAY, respent, refused again
    expect(cappedReports()).toHaveLength(2);
  });

  it('gives each lane of one writer its own budget, reported on the writer surface', () => {
    for (let i = 0; i < 40; i++) expect(takeAutoWrite('helpful-hints', 'remove')).toBe(true);
    expect(takeAutoWrite('helpful-hints', 'remove')).toBe(false);
    // A spent remove lane does not starve the create lane.
    expect(takeAutoWrite('helpful-hints', 'create')).toBe(true);
    expect(cappedReports()).toEqual([
      expect.objectContaining({
        surface: 'helpful-hints',
        context: expect.objectContaining({
          detail: expect.stringContaining('writer=helpful-hints:remove'),
        }),
      }),
    ]);
  });

  it('survives a reload: a spent budget stays spent', async () => {
    take('helpful-hints', 40);
    vi.resetModules();
    const reloaded = await import('../autoWriteBudget');
    expect(reloaded.takeAutoWrite('helpful-hints')).toBe(false);
  });
});
