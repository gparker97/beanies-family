import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shareOrDownloadFile, downloadFile } from '@/utils/shareOrDownloadFile';

const blob = new Blob(['x'], { type: 'image/png' });

describe('shareOrDownloadFile', () => {
  const origCanShare = navigator.canShare;
  const origShare = navigator.share;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers(); // the object-URL revoke is deferred via setTimeout
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    // Restore (delete when the platform didn't have it natively).
    if (origCanShare) navigator.canShare = origCanShare;
    else delete (navigator as { canShare?: unknown }).canShare;
    if (origShare) navigator.share = origShare;
    else delete (navigator as { share?: unknown }).share;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares the file when canShare({ files }) is true', async () => {
    (navigator as { canShare?: unknown }).canShare = vi.fn(() => true);
    const share = vi.fn(async (_data?: ShareData) => undefined);
    (navigator as { share?: unknown }).share = share;

    const result = await shareOrDownloadFile(blob, 'plan.png', 'image/png', 'Meal plan');

    expect(result.outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0]![0] as unknown as { files: File[]; title: string };
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].name).toBe('plan.png');
    expect(arg.title).toBe('Meal plan');
  });

  it('downloads via an object URL when file sharing is unavailable', async () => {
    delete (navigator as { canShare?: unknown }).canShare;
    delete (navigator as { share?: unknown }).share;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await shareOrDownloadFile(blob, 'plan.pdf', 'application/pdf', 'Meal plan');

    expect(result.outcome).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // Revoke is deferred so WebKit/Firefox can read the blob first.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('treats an AbortError from the share sheet as cancelled, not failed', async () => {
    (navigator as { canShare?: unknown }).canShare = vi.fn(() => true);
    (navigator as { share?: unknown }).share = vi.fn(async () => {
      throw new DOMException('user cancelled', 'AbortError');
    });

    const result = await shareOrDownloadFile(blob, 'plan.png', 'image/png', 'Meal plan');
    expect(result.outcome).toBe('cancelled');
    expect(result.error).toBeUndefined();
  });

  it('returns failed (with the error) when share throws a real error', async () => {
    (navigator as { canShare?: unknown }).canShare = vi.fn(() => true);
    const boom = new Error('share pipe broke');
    (navigator as { share?: unknown }).share = vi.fn(async () => {
      throw boom;
    });

    const result = await shareOrDownloadFile(blob, 'plan.png', 'image/png', 'Meal plan');
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe(boom);
  });

  it('downloadFile always downloads (never touches the share sheet)', () => {
    // Even when file sharing IS available, "Export as PDF" downloads.
    (navigator as { canShare?: unknown }).canShare = vi.fn(() => true);
    const share = vi.fn();
    (navigator as { share?: unknown }).share = share;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = downloadFile(blob, 'plan.pdf');

    expect(result.outcome).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
