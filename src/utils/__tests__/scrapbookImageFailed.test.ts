/**
 * The scrapbook image-failed event: once per photo per local day per online state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import {
  __resetScrapbookImageFailedForTests,
  logScrapbookImageFailed,
} from '@/utils/scrapbookImageFailed';

function setOnline(on: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 21, 0));
  __resetScrapbookImageFailedForTests();
  h.logEvent.mockClear();
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('logScrapbookImageFailed', () => {
  it('logs a photo once a day, with allowlisted context only', () => {
    logScrapbookImageFailed('p1', 'drive-abcd');
    logScrapbookImageFailed('p1', 'drive-abcd');
    expect(h.logEvent).toHaveBeenCalledTimes(1);
    expect(h.logEvent.mock.calls[0]![0]).toMatchObject({
      surface: 'scrapbook',
      message: 'scrapbook_image_failed',
      context: { file_id_tail: expect.any(String), online: true },
    });
    expect(Object.keys(h.logEvent.mock.calls[0]![0].context).sort()).toEqual([
      'file_id_tail',
      'online',
    ]);
  });

  it('logs the same photo again on the next local day (a wall open for weeks)', () => {
    logScrapbookImageFailed('p1', 'drive-abcd');
    vi.setSystemTime(new Date(2026, 10, 13, 0, 5));
    logScrapbookImageFailed('p1', 'drive-abcd');
    logScrapbookImageFailed('p1', 'drive-abcd');
    expect(h.logEvent).toHaveBeenCalledTimes(2);
  });

  it('logs again when the online state differs', () => {
    setOnline(false);
    logScrapbookImageFailed('p1', 'drive-abcd');
    setOnline(true);
    logScrapbookImageFailed('p1', 'drive-abcd');
    expect(h.logEvent.mock.calls.map(([e]) => e.context.online)).toEqual([false, true]);
  });
});
