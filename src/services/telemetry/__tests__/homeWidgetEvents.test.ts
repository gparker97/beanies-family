import { describe, it, expect, vi, beforeEach } from 'vitest';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));

import { emitReadOutcome, isReadOutcomeToken } from '../homeWidgetEvents';

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
  ])('accepts the native token %s', (token) => {
    expect(isReadOutcomeToken(token)).toBe(true);
  });

  it.each([
    'decode_failed;v=1 Sam',
    'read_failed\nSam',
    "reload_failed;Carter's party",
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
});
