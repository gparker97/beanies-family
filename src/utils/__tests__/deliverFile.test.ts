import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The delivery failure policy.
 *
 * Requirement 13 of the plan: every failure produces EXACTLY ONE user-visible
 * message and EXACTLY ONE structured report. The old code had six call sites
 * each deciding for itself, so most produced neither. These tests pin the
 * counts, not just the presence.
 */

const shareOrDownloadFile = vi.fn();
const showToast = vi.fn();
const reportError = vi.fn();
const logEvent = vi.fn();
const recordPerf = vi.fn();

vi.mock('@/utils/shareOrDownloadFile', () => ({
  shareOrDownloadFile: (...a: unknown[]) => shareOrDownloadFile(...a),
}));
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/perfTiming', () => ({ record: (...a: unknown[]) => recordPerf(...a) }));
vi.mock('@/services/sync/capabilities', () => ({ getPlatform: () => 'android' }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import { deliverFile } from '@/utils/deliverFile';

const base = {
  blob: new Blob(['x'], { type: 'application/pdf' }),
  filename: 'kit.pdf',
  mimeType: 'application/pdf',
  title: 'Kit',
  kind: 'recovery-kit-pdf' as const,
};

describe('deliverFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs one success event and records the prepare time', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'shared',
      delivered: true,
      mechanism: 'native-share',
      prepareMs: 42,
    });
    await deliverFile(base);

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0].context).toMatchObject({
      action: 'delivery-succeeded',
      kind: 'recovery-kit-pdf',
      detail: 'native-share',
      os: 'android',
    });
    // Success must be logged too, so the RATE is measurable — not only failures.
    expect(recordPerf).toHaveBeenCalledWith('file-delivery', 42, {
      perf_doc_bytes: base.blob.size,
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('skips the perf sample when there is no prepare time (web paths)', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'downloaded',
      delivered: true,
      mechanism: 'anchor',
    });
    await deliverFile(base);
    expect(recordPerf).not.toHaveBeenCalled();
  });

  it('treats a cancel as a choice: logged, but no toast and no report', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'cancelled',
      delivered: false,
      mechanism: 'native-share',
    });
    await deliverFile(base);

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0].context.action).toBe('delivery-cancelled');
    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('on failure, reports exactly once and toasts exactly once', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      mechanism: 'native-share',
      stage: 'write',
      error: new Error('disk full'),
    });
    await deliverFile(base);

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatchObject({
      surface: 'file-delivery',
      context: { action: 'delivery-failed', kind: 'recovery-kit-pdf', stage: 'write' },
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    // The toast MUST be silent: it is the report above that lands the incident.
    // Letting `showToast` auto-report instead is what the old shape did, and it
    // meant the report rode on the toast's dedupe — see the next test.
    expect(showToast.mock.calls[0][3]).toMatchObject({ silent: true });
  });

  it('reports even when an identical toast is already on screen', async () => {
    // `useToast` dedupes on (type, title, message) and returns ABOVE its own
    // report block, and every delivery failure shares one generic sticky
    // message. With the report riding on the toast, a meal-plan failure left on
    // screen silently swallowed the next failure entirely: no toast, no report,
    // nothing in the firehose. The report must not depend on the toast at all.
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      stage: 'write',
      error: new Error('disk full'),
    });
    await deliverFile(base);
    await deliverFile({ ...base, kind: 'meal-plan-pdf' });

    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[1][0].context.kind).toBe('meal-plan-pdf');
  });

  it('errorUi:"caller" suppresses the toast but still reports identically', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      mechanism: 'native-share',
      stage: 'share',
      error: new Error('no target'),
    });
    await deliverFile({ ...base, errorUi: 'caller' });

    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatchObject({
      surface: 'file-delivery',
      severity: 'error',
      context: { action: 'delivery-failed', kind: 'recovery-kit-pdf', stage: 'share' },
    });
  });

  it('critical raises the severity of the ONE report rather than adding a second', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      mechanism: 'anchor',
      stage: 'anchor',
      error: new Error('inert'),
    });
    await deliverFile({ ...base, kind: 'readable-json', errorUi: 'caller', critical: true });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].severity).toBe('critical');
  });

  it('critical raises severity on the toast path too — the same one report', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      mechanism: 'anchor',
      stage: 'anchor',
      error: new Error('inert'),
    });
    await deliverFile({ ...base, critical: true });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].severity).toBe('critical');
  });

  it('reports the blob size on FAILURE, not only on success', async () => {
    // `STAGE_GUIDANCE` sends an `encode` triager straight to the size, so a
    // failure context without it cannot answer the one question it raises.
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      stage: 'encode',
      error: new Error('bad blob'),
    });
    await deliverFile(base);
    expect(reportError.mock.calls[0][0].context.perf_doc_bytes).toBe(base.blob.size);
  });

  it('forwards preferDownload to the seam', async () => {
    shareOrDownloadFile.mockResolvedValue({ outcome: 'downloaded', delivered: true });
    await deliverFile({ ...base, preferDownload: true });
    expect(shareOrDownloadFile.mock.calls[0][4]).toEqual({ preferDownload: true });
  });

  it('never logs the filename — it can carry a family name or a kit id', async () => {
    shareOrDownloadFile.mockResolvedValue({
      outcome: 'failed',
      delivered: false,
      stage: 'write',
      error: new Error('x'),
    });
    await deliverFile({ ...base, filename: 'the-smith-family-kit-abc123.pdf' });

    const serialised = JSON.stringify(reportError.mock.calls[0][0]?.context ?? {});
    expect(serialised).not.toContain('smith');
    expect(serialised).not.toContain('abc123');
  });
});
