import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock compression (canvas-based — not available in happy-dom) but keep the REAL
// CompressionError class, because the service classifies failures via `instanceof`.
vi.mock('@/services/photos/photoCompression', async (importActual) => {
  const actual = await importActual<typeof import('@/services/photos/photoCompression')>();
  return { ...actual, compress: vi.fn() };
});

// Mock the providers so we control their extract() behaviour per test.
vi.mock('../providers/managedProvider', () => ({
  managedProvider: { id: 'tinfoil', extract: vi.fn() },
}));
vi.mock('../providers/byokProvider', () => ({ createByokProvider: vi.fn() }));
vi.mock('../providers/onDeviceProvider', () => ({
  onDeviceProvider: { id: 'on-device', extract: vi.fn() },
}));

import { extractEventFromDocument } from '../documentExtractionService';
import { compress, CompressionError } from '@/services/photos/photoCompression';
import { managedProvider } from '../providers/managedProvider';
import { createByokProvider } from '../providers/byokProvider';
import { onDeviceProvider } from '../providers/onDeviceProvider';
import { ExtractionProviderError, type ExtractionResult } from '../types';

const mockCompress = vi.mocked(compress);
const mockManagedExtract = vi.mocked(managedProvider.extract);
const mockCreateByok = vi.mocked(createByokProvider);
const mockOnDeviceExtract = vi.mocked(onDeviceProvider.extract);

const SAMPLE: ExtractionResult = {
  isEvent: true,
  title: "Mia's 6th Birthday",
  date: '2026-07-12',
  startTime: '14:00',
  endTime: '16:00',
  isAllDay: false,
  location: 'Sunshine Hall',
  description: 'Bring a gift',
  confidence: { title: 0.95, date: 0.9, startTime: 0.8, endTime: 0.7, location: 0.85 },
};

function file(): File {
  return new File(['x'], 'invite.jpg', { type: 'image/jpeg' });
}

function compressedOk() {
  return {
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 100,
    height: 100,
    mime: 'image/jpeg',
  };
}

beforeEach(() => {
  // Reset (not just clear) so any queued impls from a prior test don't leak — see
  // docs/lessons.md (resetAllMocks vs clearAllMocks).
  vi.resetAllMocks();
  mockCompress.mockResolvedValue(compressedOk());
});

describe('extractEventFromDocument — tier dispatch', () => {
  it('managed tier: returns the provider result on success', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    const res = await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    expect(res).toEqual({ success: true, data: SAMPLE });
    expect(mockManagedExtract).toHaveBeenCalledTimes(1);
  });

  it('sends ONLY the single compressed document (data-minimization)', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    const request = mockManagedExtract.mock.calls[0][0];
    expect(request.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(request.todayIso).toBe('2026-06-03');
    // No family-data fields are present on the request — only the document + date + signal.
    expect(Object.keys(request).sort()).toEqual(['imageDataUrl', 'signal', 'todayIso']);
  });

  it('byok tier: constructs the BYOK provider from the supplied config', async () => {
    mockCreateByok.mockReturnValue({ id: 'openai', extract: vi.fn().mockResolvedValue(SAMPLE) });

    const res = await extractEventFromDocument(file(), {
      tier: 'byok',
      todayIso: '2026-06-03',
      byok: { provider: 'openai', apiKey: 'sk-test' },
    });

    expect(res.success).toBe(true);
    expect(mockCreateByok).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('byok tier without a key config → not_available, never builds a provider', async () => {
    const res = await extractEventFromDocument(file(), { tier: 'byok', todayIso: '2026-06-03' });

    expect(res).toEqual({
      success: false,
      errorCode: 'not_available',
      error: expect.stringContaining('BYOK'),
    });
    expect(mockCreateByok).not.toHaveBeenCalled();
  });

  it('on-device tier → not_available (typed seam)', async () => {
    mockOnDeviceExtract.mockRejectedValue(
      new ExtractionProviderError(
        'not_available',
        'On-device document extraction is not available yet'
      )
    );

    const res = await extractEventFromDocument(file(), {
      tier: 'on-device',
      todayIso: '2026-06-03',
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('not_available');
  });

  it('unknown tier → assertNever path is caught, returns not_available (no throw)', async () => {
    // @ts-expect-error deliberately passing an invalid tier to exercise the dispatch default.
    const res = await extractEventFromDocument(file(), { tier: 'bogus', todayIso: '2026-06-03' });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('not_available');
    expect(mockManagedExtract).not.toHaveBeenCalled();
  });
});

describe('extractEventFromDocument — failure classification', () => {
  it('compression failure → compression code, provider never called', async () => {
    mockCompress.mockRejectedValue(new CompressionError('HEIC only decodes in Safari'));

    const res = await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    expect(res).toEqual({
      success: false,
      errorCode: 'compression',
      error: 'HEIC only decodes in Safari',
    });
    expect(mockManagedExtract).not.toHaveBeenCalled();
  });

  it('provider malformed_output is preserved', async () => {
    mockManagedExtract.mockRejectedValue(
      new ExtractionProviderError('malformed_output', 'Model returned unparseable JSON')
    );

    const res = await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('malformed_output');
  });

  it('provider timeout is preserved', async () => {
    mockManagedExtract.mockRejectedValue(new ExtractionProviderError('timeout', 'timed out'));

    const res = await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    expect(res.errorCode).toBe('timeout');
  });

  it('a non-typed provider throw is classified as provider_error (never leaks)', async () => {
    mockManagedExtract.mockRejectedValue(new Error('boom'));

    const res = await extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('provider_error');
  });

  it('the service never throws — always resolves a classified result', async () => {
    mockManagedExtract.mockRejectedValue(new ExtractionProviderError('provider_error', 'HTTP 500'));

    await expect(
      extractEventFromDocument(file(), { tier: 'managed', todayIso: '2026-06-03' })
    ).resolves.toMatchObject({ success: false });
  });
});
