import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `reportError` is one firehose write; mock the firehose so the suite asserts what it hands over
// (the queue and enrichment have their own suites).
vi.mock('@/services/telemetry', () => ({
  logEvent: vi.fn(),
}));

import { reportError, __resetErrorReporterForTesting } from '../errorReporter';
import { logEvent } from '@/services/telemetry';
import { ReadOnlyError } from '@/services/automerge/worker/writeGate';

const logEventMock = vi.mocked(logEvent);

describe('reportError', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetErrorReporterForTesting();
    logEventMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one firehose event carrying the severity, defaulting to error', () => {
    reportError({ surface: 'create-activity', message: 'boom', context: { action: 'save' } });
    expect(logEventMock).toHaveBeenCalledTimes(1);
    expect(logEventMock.mock.calls[0]![0]).toMatchObject({
      level: 'error',
      surface: 'create-activity',
      message: 'boom',
      context: { action: 'save', severity: 'error' },
      flush: false,
      includeFamilyName: false,
    });
  });

  it('maps warning to the warn level, without flush or the family name', () => {
    reportError({ surface: 's', message: 'm', severity: 'warning' });
    expect(logEventMock.mock.calls[0]![0]).toMatchObject({
      level: 'warn',
      context: { severity: 'warning' },
      flush: false,
      includeFamilyName: false,
    });
  });

  it('flushes and adds the family name only for critical', () => {
    const err = new Error('lost');
    reportError({ surface: 'pod-merge', message: 'm', severity: 'critical', error: err });
    expect(logEventMock.mock.calls[0]![0]).toMatchObject({
      level: 'error',
      surface: 'pod-merge',
      error: err,
      context: { severity: 'critical' },
      flush: true,
      includeFamilyName: true,
    });
  });

  it('stamps a demoted report as paging-demoted, appending to an existing detail', () => {
    reportError({ surface: 's', message: 'm', severity: 'error', demoted: true });
    expect(logEventMock.mock.calls[0]![0].context).toMatchObject({
      severity: 'error',
      detail: 'paging-demoted',
    });

    reportError({
      surface: 's',
      message: 'm',
      severity: 'error',
      demoted: true,
      context: { detail: 'transport=popup' },
    });
    expect(logEventMock.mock.calls[1]![0].context).toMatchObject({
      detail: 'transport=popup,paging-demoted',
    });
  });

  it('leaves detail alone when the report was not demoted', () => {
    reportError({ surface: 's', message: 'm', context: { detail: 'kept' } });
    expect(logEventMock.mock.calls[0]![0].context).toEqual({ detail: 'kept', severity: 'error' });
  });

  it('blocks re-entry from inside its own firehose write', () => {
    logEventMock.mockImplementationOnce(() => {
      reportError({ surface: 'inner', message: 'inner-boom' });
    });
    reportError({ surface: 'outer', message: 'outer-boom' });
    expect(logEventMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[errorReporter] re-entry blocked', 'inner');
  });

  it('never throws when the firehose write throws', () => {
    logEventMock.mockImplementationOnce(() => {
      throw new Error('telemetry fault');
    });
    expect(() => reportError({ surface: 's', message: 'm' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      '[errorReporter] reportError itself threw',
      expect.any(Error)
    );
    // The guard is released, so the next report still lands.
    reportError({ surface: 's', message: 'next' });
    expect(logEventMock).toHaveBeenCalledTimes(2);
  });

  describe('read-only refusal (#95)', () => {
    it('drops a ReadOnlyError at every severity: no firehose event, no console error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      reportError({
        surface: 'photo-store',
        message: 'save failed',
        error: new ReadOnlyError('p'),
      });
      reportError({
        surface: 'photo-store',
        message: 'save failed',
        severity: 'warning',
        error: new ReadOnlyError('p'),
      });
      reportError({
        surface: 'photo-upload',
        message: 'save failed',
        severity: 'critical',
        error: new ReadOnlyError('p'),
      });
      expect(logEventMock).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('still reports any other error', () => {
      reportError({ surface: 'photo-store', message: 'save failed', error: new Error('boom') });
      expect(logEventMock).toHaveBeenCalledTimes(1);
    });
  });
});
