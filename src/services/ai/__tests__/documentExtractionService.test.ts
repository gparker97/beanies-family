import { __testConsentGrant } from '@/test/consentGrant';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock compression (canvas-based — not available in happy-dom) but keep the REAL
// CompressionError class, because the service classifies failures via `instanceof`.
vi.mock('@/services/photos/photoCompression', async (importActual) => {
  const actual = await importActual<typeof import('@/services/photos/photoCompression')>();
  return { ...actual, compress: vi.fn() };
});

// Mock the providers so we control their run() behaviour per test.
vi.mock('../providers/managedProvider', () => ({
  managedProvider: { id: 'tinfoil', run: vi.fn() },
}));
vi.mock('../providers/byokProvider', () => ({ createByokProvider: vi.fn() }));
vi.mock('../providers/onDeviceProvider', () => ({
  onDeviceProvider: { id: 'on-device', run: vi.fn() },
}));

// Mock the PDF rasterizer (real one loads pdf.js + canvas, unavailable in happy-dom). isPdfFile
// stays real-ish so the non-PDF tests take the single-image path without any rasterization.
const mockPdfToExtractionImages = vi.fn();
vi.mock('@/utils/pdfExtractionImages', () => ({
  // The service reads the cap from this module, so the mock MUST export it — otherwise the
  // page arithmetic silently becomes NaN and every cap assertion passes for the wrong reason.
  MAX_EXTRACT_PAGES: 5,
  isPdfFile: (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  pdfToExtractionImages: (f: File, maxPages?: number) => mockPdfToExtractionImages(f, maxPages),
}));

import { extractEventFromDocument } from '../documentExtractionService';
import { compress, CompressionError } from '@/services/photos/photoCompression';
import { managedProvider } from '../providers/managedProvider';
import { createByokProvider } from '../providers/byokProvider';
import { onDeviceProvider } from '../providers/onDeviceProvider';
import { ExtractionProviderError, type ExtractionResult } from '../types';

const mockCompress = vi.mocked(compress);
const mockManagedExtract = vi.mocked(managedProvider.run);
const mockCreateByok = vi.mocked(createByokProvider);
const mockOnDeviceExtract = vi.mocked(onDeviceProvider.run);

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

function pdfFile(): File {
  return new File(['%PDF-1.4'], 'invite.pdf', { type: 'application/pdf' });
}

function imgFile(name: string): File {
  return new File([name], name, { type: 'image/jpeg' });
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

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual(SAMPLE);
    // #133: success also hands back the compressed image so the caller can attach it.
    expect(res.compressedBlob).toBeInstanceOf(Blob);
    expect(res.compressedBlob?.type).toBe('image/jpeg');
    expect(mockManagedExtract).toHaveBeenCalledTimes(1);
  });

  it('sends ONLY the single compressed document (data-minimization)', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    const [task, request] = mockManagedExtract.mock.calls[0];
    expect(task).toBe('event');
    // A photo is the single-element case of the images array.
    expect(request.source.kind).toBe('images');
    const urls = request.source.kind === 'images' ? request.source.imageDataUrls : [];
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(request.todayIso).toBe('2026-06-03');
    // No family DATA is present on the request — only the document, the date, the signal and
    // (since #83) the family ID.
    //
    // ⚠️ `familyId` is on this list deliberately and is NOT a widening of what leaves the
    // device. It is a random UUID with no personal data in it — the same value
    // `diagnosticContext.ts` already ships raw to our telemetry, and documented as PII-free
    // for exactly that reason. It exists so the proxy can rate-limit per family. Anything
    // that is actually family DATA (members, activities, balances) must never appear here.
    //
    // `task` is deliberately NOT on the request: it is run()'s first argument, and carrying
    // it in both places would be two sources of truth that can disagree.
    expect(Object.keys(request).sort()).toEqual(['familyId', 'signal', 'source', 'todayIso']);
    // Not supplied by this caller, so it is carried as undefined and JSON.stringify drops it.
    expect(request.familyId).toBeUndefined();
  });

  it('threads familyId through to the provider when supplied (#83)', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
      familyId: 'fam-1',
    });

    const [, request] = mockManagedExtract.mock.calls[0];
    expect(request.familyId).toBe('fam-1');
  });

  it('passes familyId through to a BYOK provider too, which simply ignores it', async () => {
    // The previous version of this test asserted only `res.success === true` for an absent
    // familyId — which the test above already covers via `request.familyId` being undefined,
    // and whose named behaviour (the proxy's IP fallback) is server-side and unreachable from
    // here. This asserts something no other test does: the option is threaded independently of
    // tier, so switching tiers cannot silently drop it.
    const byokRun = vi.fn().mockResolvedValue(SAMPLE);
    mockCreateByok.mockReturnValue({ id: 'openai', run: byokRun });
    await extractEventFromDocument(file(), {
      tier: 'byok',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
      byok: { provider: 'openai', apiKey: 'k' },
      familyId: 'fam-1',
    });

    const [, request] = byokRun.mock.calls[0];
    expect(request.familyId).toBe('fam-1');
  });

  it('multi-page PDF: sends one compressed data URL per page and threads truncated', async () => {
    mockPdfToExtractionImages.mockResolvedValue({
      files: [imgFile('doc-p1'), imgFile('doc-p2'), imgFile('doc-p3')],
      truncated: true,
    });
    mockManagedExtract.mockResolvedValue(SAMPLE);

    const res = await extractEventFromDocument(pdfFile(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    const [task, request] = mockManagedExtract.mock.calls[0];
    expect(task).toBe('event');
    // Images now ride the discriminated source rather than a bare field on the request.
    expect(request.source.kind).toBe('images');
    const urls = request.source.kind === 'images' ? request.source.imageDataUrls : [];
    expect(urls).toHaveLength(3);
    expect(urls.every((u: string) => u.startsWith('data:image/jpeg;base64,'))).toBe(true);
    // Page 1's compressed blob is handed back as the representative source thumbnail.
    expect(res.compressedBlob).toBeInstanceOf(Blob);
    // Truncation flag rides the envelope so the caller can notify the user.
    expect(res.truncated).toBe(true);
  });

  it('a PDF that produces no readable pages → compression error, provider never called', async () => {
    mockPdfToExtractionImages.mockResolvedValue({ files: [], truncated: false });

    const res = await extractEventFromDocument(pdfFile(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.errorCode).toBe('compression');
    expect(mockManagedExtract).not.toHaveBeenCalled();
  });

  it('PDF rasterization failure → compression error (never leaks a raw throw)', async () => {
    mockPdfToExtractionImages.mockRejectedValue(new Error('corrupt or password-protected'));

    const res = await extractEventFromDocument(pdfFile(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('compression');
    expect(mockManagedExtract).not.toHaveBeenCalled();
  });

  it('byok tier: constructs the BYOK provider from the supplied config', async () => {
    mockCreateByok.mockReturnValue({
      id: 'openai',
      run: vi.fn().mockResolvedValue(SAMPLE),
    });

    const res = await extractEventFromDocument(file(), {
      tier: 'byok',
      todayIso: '2026-06-03',
      byok: { provider: 'openai', apiKey: 'sk-test' },
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    expect(mockCreateByok).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('byok tier without a key config → not_available, never builds a provider', async () => {
    const res = await extractEventFromDocument(file(), {
      tier: 'byok',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

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
      grant: __testConsentGrant,
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

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

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

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('malformed_output');
  });

  it('provider timeout is preserved', async () => {
    mockManagedExtract.mockRejectedValue(new ExtractionProviderError('timeout', 'timed out'));

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.errorCode).toBe('timeout');
  });

  it('a non-typed provider throw is classified as provider_error (never leaks)', async () => {
    mockManagedExtract.mockRejectedValue(new Error('boom'));

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('provider_error');
  });

  it('the service never throws — always resolves a classified result', async () => {
    mockManagedExtract.mockRejectedValue(new ExtractionProviderError('provider_error', 'HTTP 500'));

    await expect(
      extractEventFromDocument(file(), {
        tier: 'managed',
        todayIso: '2026-06-03',
        grant: __testConsentGrant,
      })
    ).resolves.toMatchObject({ success: false });
  });
});

/**
 * SEVERAL documents read as ONE item (#64).
 *
 * The unit that matters is PAGES, not files: one shared PDF is many pages, so a file count
 * would be the wrong cap. These assert the cap bites at the page level, that `truncated` is
 * always reported rather than pages being dropped silently, and — the efficiency claim the
 * plan makes — that NO compression work happens past the cap.
 */
describe('multi-document extraction (#64)', () => {
  it('reads several images as the pages of one request, in order', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    const res = await extractEventFromDocument([imgFile('a'), imgFile('b'), imgFile('c')], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    expect(res.truncated).toBe(false);
    // ONE provider call carrying three image parts — not three calls.
    expect(mockManagedExtract).toHaveBeenCalledTimes(1);
    const source = mockManagedExtract.mock.calls[0][1].source;
    expect(source.kind).toBe('images');
    expect(source.kind === 'images' && source.imageDataUrls).toHaveLength(3);
    // Compressed in the order supplied.
    expect(mockCompress.mock.calls.map((c) => (c[0] as File).name)).toEqual(['a', 'b', 'c']);
  });

  it('concatenates a PDF s pages with images, in file order', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);
    mockPdfToExtractionImages.mockResolvedValue({
      files: [imgFile('p1'), imgFile('p2')],
      truncated: false,
    });

    const res = await extractEventFromDocument([pdfFile(), imgFile('after')], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    expect(mockCompress.mock.calls.map((c) => (c[0] as File).name)).toEqual(['p1', 'p2', 'after']);
  });

  it('caps at MAX_EXTRACT_PAGES, reports it, and does NO work past the cap', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(imgFile);

    const res = await extractEventFromDocument(seven, {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    // Told, never silently dropped.
    expect(res.truncated).toBe(true);
    const source = mockManagedExtract.mock.calls[0][1].source;
    expect(source.kind === 'images' && source.imageDataUrls).toHaveLength(5);
    // The efficiency claim: five compressions for seven inputs, not seven.
    expect(mockCompress).toHaveBeenCalledTimes(5);
  });

  it('asks the rasterizer only for the pages it can still use', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);
    mockPdfToExtractionImages.mockResolvedValue({ files: [imgFile('p1')], truncated: true });

    await extractEventFromDocument([imgFile('a'), imgFile('b'), imgFile('c'), pdfFile()], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    // Three images already collected, so at most two pages remain worth rendering.
    expect(mockPdfToExtractionImages).toHaveBeenCalledWith(expect.any(File), 2);
  });

  it('propagates a PDF s own truncation', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);
    mockPdfToExtractionImages.mockResolvedValue({
      files: [imgFile('p1'), imgFile('p2')],
      truncated: true,
    });

    const res = await extractEventFromDocument([pdfFile()], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.truncated).toBe(true);
  });

  it('keeps page 1 as the representative thumbnail', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);
    const first = new Blob(['first'], { type: 'image/jpeg' });
    mockCompress
      .mockResolvedValueOnce({ blob: first, width: 1, height: 1, mime: 'image/jpeg' })
      .mockResolvedValue(compressedOk());

    const res = await extractEventFromDocument([imgFile('a'), imgFile('b')], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.compressedBlob).toBe(first);
  });

  it('a single File still behaves exactly as before', async () => {
    mockManagedExtract.mockResolvedValue(SAMPLE);

    const res = await extractEventFromDocument(file(), {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(true);
    expect(res.truncated).toBe(false);
    expect(mockCompress).toHaveBeenCalledTimes(1);
  });

  it('classifies an empty document list as a compression failure rather than sending nothing', async () => {
    const res = await extractEventFromDocument([], {
      tier: 'managed',
      todayIso: '2026-06-03',
      grant: __testConsentGrant,
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('compression');
    expect(mockManagedExtract).not.toHaveBeenCalled();
  });
});
