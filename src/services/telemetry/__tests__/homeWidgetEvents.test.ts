import { describe, it, expect, vi, beforeEach } from 'vitest';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));

import {
  circleOptionsToken,
  emitPlacements,
  emitReadOutcome,
  emitSnapshotPublished,
  isReadOutcomeToken,
} from '../homeWidgetEvents';

/**
 * The relayed native read outcome is the one value on this surface written outside the app,
 * so it is checked against a fixed grammar before it reaches the firehose (ADR-042).
 */
describe('homeWidgetEvents: read outcome grammar', () => {
  beforeEach(() => logEvent.mockReset());

  it.each([
    'read_failed',
    'read_failed;no_container',
    'render_failed',
    'decode_failed;v=0',
    'decode_failed;v=12',
    'decode_failed;v=unknown',
    'decode_failed;v=-1',
    'placements_failed;code=-1',
    'placements_failed;RuntimeException',
    'placements_failed;timeout',
    'reload_failed;IllegalStateException',
    'reload_failed;TransactionTooLargeException',
    'list_failed;IllegalArgumentException',
    'list_failed;Unknown',
  ])('accepts the native token %s', (token) => {
    expect(isReadOutcomeToken(token)).toBe(true);
  });

  it.each([
    'decode_failed;v=1 Sam',
    'read_failed\nSam',
    "reload_failed;Carter's party",
    "list_failed;Sam's",
    'list_failed;',
    'list_failed;' + 'A'.repeat(41),
    'decode_failed;v=',
    '',
  ])('rejects free text %j', (token) => {
    expect(isReadOutcomeToken(token)).toBe(false);
  });

  it('checks each part of a joined outcome and logs each with its own error code', () => {
    emitReadOutcome('decode_failed;v=0|placements_failed;code=-1');
    emitReadOutcome('reload_failed;NullPointerException|tacos for Sam');
    const events = logEvent.mock.calls.map(([e]) => {
      const c = (e as { context: { error_code: string; detail: string } }).context;
      return [c.error_code, c.detail];
    });
    expect(events).toEqual([
      ['snapshot_unreadable', 'decode_failed;v=0'],
      ['placements_failed', 'placements_failed;code=-1'],
      ['widget_reload_failed', 'reload_failed;NullPointerException'],
      ['snapshot_unreadable', 'unrecognised'],
    ]);
  });

  it('routes a list failure and a reload failure from one relay to their own codes', () => {
    emitReadOutcome(
      'list_failed;IllegalArgumentException|reload_failed;TransactionTooLargeException|render_failed'
    );
    const events = logEvent.mock.calls.map(([e]) => {
      const ev = e as {
        message: string;
        level: string;
        context: { error_code: string; detail: string };
      };
      return [ev.level, ev.message, ev.context.error_code, ev.context.detail];
    });
    expect(events).toEqual([
      ['warn', 'widget list failed', 'widget_list_failed', 'list_failed;IllegalArgumentException'],
      [
        'warn',
        'widget re-render failed',
        'widget_reload_failed',
        'reload_failed;TransactionTooLargeException',
      ],
      ['warn', 'widget read failed', 'snapshot_unreadable', 'render_failed'],
    ]);
  });
});

/** The v3 tokens (#134): weather on `snapshot published`, circle options on `placements`. */
describe('homeWidgetEvents: v3 tokens', () => {
  beforeEach(() => logEvent.mockReset());

  const contexts = () =>
    logEvent.mock.calls.map((c) => (c[0] as { context: Record<string, unknown> }).context);

  it('says whether the snapshot carried weather', () => {
    const base = { reason: 'data-change' as const, rowsToday: 2, tasksToday: 1, aheadRows: 3 };
    emitSnapshotPublished({ ...base, kb: 9, skipped: 0, weather: true });
    emitSnapshotPublished({ ...base, kb: 9, skipped: 1, weather: false, renderedDayOffset: 0 });
    expect(contexts().map((c) => c.detail)).toEqual([
      'tasks=1;ahead=3;kb=9;wx=1',
      'tasks=1;ahead=3;kb=9;wx=0;skipped=1;day=0',
    ]);
  });

  it('writes every circle option, in order, as a small integer', () => {
    expect(circleOptionsToken({ nextUp: 1 })).toBe('circle=nextUp:1,handoff:0,todos:0,left:0');
    expect(
      circleOptionsToken({ nextUp: 2, nextHandoff: 1.7, todosLeft: -3, thingsLeft: NaN })
    ).toBe('circle=nextUp:2,handoff:1,todos:0,left:0');
  });

  it('relays the circle options on the accessory placements event only', () => {
    emitPlacements({ 'ios-medium': 1, 'ios-accessory': 2, circle: { nextUp: 1, thingsLeft: 1 } });
    emitPlacements({ 'ios-accessory': 1 });
    expect(contexts()).toEqual([
      { kind: 'ios-medium', count: 1 },
      { kind: 'ios-accessory', count: 2, detail: 'circle=nextUp:1,handoff:0,todos:0,left:1' },
      { kind: 'ios-accessory', count: 1 },
    ]);
  });
});
