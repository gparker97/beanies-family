import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logEventMock, reportErrorMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

import {
  ATTRIBUTION_STORAGE_KEY,
  ATTRIBUTION_TTL_MS,
  makeEnvelope,
} from '@beanies/brand/attribution';
import { captureAttributionFromUrl, clearAttribution, peekAttribution } from '../attributionStash';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const TAGGED = '?utm_source=chatgpt&utm_campaign=sg-pilot-oct26&utm_content=calm-ad1&oppref=o1';

function store(value: unknown): void {
  localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
}

function stored(): unknown {
  const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

// happy-dom's localStorage methods live on the instance and `vi.restoreAllMocks` does not undo a
// spy on them (the storedJson suite restores by hand too), so every storage spy goes through here.
const storageSpies: Array<{ mockRestore: () => void }> = [];
function refuse(method: 'getItem' | 'setItem' | 'removeItem', error: Error): void {
  storageSpies.push(
    vi.spyOn(localStorage, method).mockImplementation(() => {
      throw error;
    })
  );
}

function lastEvent(): { message: string; context: Record<string, unknown> } | undefined {
  return logEventMock.mock.calls.at(-1)?.[0];
}

describe('attributionStash', () => {
  beforeEach(() => {
    localStorage.clear();
    logEventMock.mockReset();
    reportErrorMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    storageSpies.splice(0).forEach((spy) => spy.mockRestore());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('captureAttributionFromUrl', () => {
    it('captures a tagged URL into a fresh envelope and logs `captured`', () => {
      captureAttributionFromUrl(TAGGED);
      expect(stored()).toEqual({
        v: 1,
        capturedAt: NOW,
        fields: {
          utm_source: 'chatgpt',
          utm_campaign: 'sg-pilot-oct26',
          utm_content: 'calm-ad1',
          oppref: 'o1',
        },
      });
      expect(logEventMock).toHaveBeenCalledTimes(1);
      expect(lastEvent()).toMatchObject({
        level: 'info',
        surface: 'attribution',
        message: 'capture',
        context: { action: 'captured', kind: 'chatgpt', count: 4 },
      });
    });

    it('sweeps an expired envelope on an untagged boot and logs `clear expired`', () => {
      store(makeEnvelope({ utm_source: 'reddit' }, NOW - ATTRIBUTION_TTL_MS));
      captureAttributionFromUrl('?resume=setup');
      expect(stored()).toBeNull();
      expect(logEventMock).toHaveBeenCalledTimes(1);
      expect(lastEvent()).toMatchObject({ message: 'clear', context: { action: 'expired' } });
    });

    it('sweeps a corrupt envelope on an untagged boot and logs `clear corrupt`', () => {
      store({ v: 7 });
      captureAttributionFromUrl('');
      expect(stored()).toBeNull();
      expect(lastEvent()).toMatchObject({ message: 'clear', context: { action: 'corrupt' } });
    });

    it('logs a separate `field-dropped` event with the number of keys that failed the rule', () => {
      captureAttributionFromUrl(
        '?utm_source=chatgpt.com&utm_content=ok&oppref=a+b&ad_id=' + 'x'.repeat(101)
      );
      expect(logEventMock).toHaveBeenCalledTimes(2);
      expect(logEventMock.mock.calls[0][0]).toMatchObject({
        message: 'field-dropped',
        context: { action: 'field-dropped', kind: 'chatgpt', count: 2 },
      });
      expect(lastEvent()).toMatchObject({
        message: 'capture',
        context: { action: 'captured', kind: 'chatgpt', count: 2 },
      });
    });

    it('maps utm_source to a closed channel enum, never the raw value', () => {
      captureAttributionFromUrl('?utm_source=www.Reddit.com');
      expect(lastEvent()?.context).toMatchObject({ kind: 'reddit' });
      clearAttribution('consumed');
      captureAttributionFromUrl('?utm_source=some-newsletter-nobody-declared');
      expect(lastEvent()?.context).toMatchObject({ kind: 'other' });
    });

    it('emits nothing for a URL with no attribution key (the healthy per-boot case)', () => {
      captureAttributionFromUrl('?resume=setup&next=%2Fnook');
      captureAttributionFromUrl('');
      expect(logEventMock).not.toHaveBeenCalled();
      expect(stored()).toBeNull();
    });

    it('logs `dropped-invalid` when the URL has attribution keys but no valid value', () => {
      captureAttributionFromUrl(`?utm_source=${encodeURIComponent('<script>')}&utm_term=`);
      expect(stored()).toBeNull();
      expect(lastEvent()?.context).toEqual({
        action: 'dropped-invalid',
        kind: 'untagged',
        count: 0,
      });
    });

    it('keeps an unexpired first touch and logs `kept-first-touch`', () => {
      const first = makeEnvelope({ utm_source: 'reddit' }, NOW - 1000);
      store(first);
      captureAttributionFromUrl(TAGGED);
      expect(stored()).toEqual(first);
      expect(lastEvent()?.context).toMatchObject({ action: 'kept-first-touch', kind: 'chatgpt' });
    });

    it('replaces an envelope exactly 30 days old (the TTL boundary) as `replaced-expired`', () => {
      store(makeEnvelope({ utm_source: 'reddit' }, NOW - ATTRIBUTION_TTL_MS));
      captureAttributionFromUrl(TAGGED);
      expect(stored()).toMatchObject({ capturedAt: NOW, fields: { utm_source: 'chatgpt' } });
      expect(lastEvent()?.context).toMatchObject({ action: 'replaced-expired' });
    });

    it('keeps an envelope one millisecond short of the TTL', () => {
      store(makeEnvelope({ utm_source: 'reddit' }, NOW - ATTRIBUTION_TTL_MS + 1));
      captureAttributionFromUrl(TAGGED);
      expect(stored()).toMatchObject({ fields: { utm_source: 'reddit' } });
      expect(lastEvent()?.context).toMatchObject({ action: 'kept-first-touch' });
    });

    it.each([
      ['unparseable JSON', '{nope'],
      ['a wrong-version envelope', JSON.stringify({ v: 2, capturedAt: NOW, fields: {} })],
    ])('replaces %s as `replaced-corrupt`', (_label, raw) => {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, raw);
      captureAttributionFromUrl(TAGGED);
      expect(stored()).toMatchObject({ v: 1, fields: { utm_source: 'chatgpt' } });
      expect(lastEvent()?.context).toMatchObject({ action: 'replaced-corrupt' });
    });

    it('a refused write reports one warning and leaves the device unattributed', () => {
      const quota = new Error('quota');
      refuse('setItem', quota);
      captureAttributionFromUrl(TAGGED);
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'attribution',
          severity: 'warning',
          error: quota,
          context: { action: 'storage-failed', stage: 'write' },
        })
      );
      expect(logEventMock).not.toHaveBeenCalled();
      expect(peekAttribution()).toBeNull();
    });
  });

  describe('peekAttribution', () => {
    it('returns the live fields without emitting an event', () => {
      captureAttributionFromUrl(TAGGED);
      logEventMock.mockReset();
      expect(peekAttribution()).toMatchObject({ utm_source: 'chatgpt', oppref: 'o1' });
      expect(logEventMock).not.toHaveBeenCalled();
    });

    it('returns null for an expired envelope', () => {
      store(makeEnvelope({ utm_source: 'reddit' }, NOW - ATTRIBUTION_TTL_MS));
      expect(peekAttribution()).toBeNull();
    });

    it('returns null when the storage read throws', () => {
      captureAttributionFromUrl(TAGGED);
      refuse('getItem', new Error('blocked'));
      expect(peekAttribution()).toBeNull();
    });
  });

  describe('clearAttribution', () => {
    it.each(['consumed', 'sign-out'] as const)('removes a live tag and logs `%s`', (reason) => {
      captureAttributionFromUrl(TAGGED);
      logEventMock.mockReset();
      clearAttribution(reason);
      expect(stored()).toBeNull();
      expect(lastEvent()).toMatchObject({
        message: 'clear',
        context: { action: reason, kind: 'chatgpt', count: 4 },
      });
    });

    it('logs `absent` when there is nothing to clear', () => {
      clearAttribution('consumed');
      expect(lastEvent()?.context).toEqual({ action: 'absent', kind: 'untagged', count: 0 });
    });

    it('removes an expired envelope and reports it as `expired`, not as the reason', () => {
      store(makeEnvelope({ utm_source: 'reddit' }, NOW - ATTRIBUTION_TTL_MS));
      clearAttribution('consumed');
      expect(stored()).toBeNull();
      expect(lastEvent()?.context).toMatchObject({ action: 'expired', kind: 'untagged', count: 0 });
    });

    it('a refused removal reports one warning and logs no clear', () => {
      captureAttributionFromUrl(TAGGED);
      logEventMock.mockReset();
      refuse('removeItem', new Error('blocked'));
      clearAttribution('sign-out');
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ context: { action: 'storage-failed', stage: 'remove' } })
      );
      expect(logEventMock).not.toHaveBeenCalled();
    });
  });
});
