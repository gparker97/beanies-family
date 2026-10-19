import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { restoreSpooledEvents, logEvent } = vi.hoisted(() => ({
  restoreSpooledEvents: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock('@/services/telemetry/logQueue', () => ({ restoreSpooledEvents }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import { __resetTelemetrySpoolForTesting, installTelemetrySpool } from '../telemetrySpool';

const ZERO = { keys: 0, restored: 0, stale: 0, malformed: 0, unremovable: 0, capped: 0 };

describe('installTelemetrySpool', () => {
  beforeEach(() => __resetTelemetrySpoolForTesting());
  afterEach(() => vi.clearAllMocks());

  it('logs nothing when no spool was found', () => {
    restoreSpooledEvents.mockReturnValue(ZERO);
    installTelemetrySpool();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('logs telemetry-spool restored with the counts', () => {
    restoreSpooledEvents.mockReturnValue({
      keys: 2,
      restored: 40,
      stale: 3,
      malformed: 1,
      unremovable: 0,
      capped: 5,
    });
    installTelemetrySpool();
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'telemetry-spool',
      message: 'restored',
      context: {
        action: 'restored',
        count: 40,
        detail: 'stale=3,malformed=1,unremovable=0,capped=5,keys=2',
      },
    });
  });

  it('logs even when every event was dropped, so a corrupt spool is visible', () => {
    restoreSpooledEvents.mockReturnValue({ ...ZERO, keys: 1, malformed: 1 });
    installTelemetrySpool();
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('is idempotent', () => {
    restoreSpooledEvents.mockReturnValue(ZERO);
    installTelemetrySpool();
    installTelemetrySpool();
    expect(restoreSpooledEvents).toHaveBeenCalledTimes(1);
  });
});
