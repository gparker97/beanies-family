import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// renderPdfPages drives pdf.js + a canvas (unavailable in happy-dom), exactly why the shared
// loop lives in one place. We mock it and test only the extraction wrapper's own logic.
vi.mock('../pdfRender', () => ({ renderPdfPages: vi.fn() }));

import { isPdfFile, pdfToExtractionImages, MAX_EXTRACT_PAGES } from '../pdfExtractionImages';
import { renderPdfPages } from '../pdfRender';

const mockRender = vi.mocked(renderPdfPages);

function jpegBlob(tag: string): Blob {
  return new Blob([tag], { type: 'image/jpeg' });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('isPdfFile', () => {
  it('detects a PDF by mime', () => {
    expect(isPdfFile(new File(['x'], 'a.bin', { type: 'application/pdf' }))).toBe(true);
  });
  it('detects a PDF by .pdf extension when the mime is missing', () => {
    expect(isPdfFile(new File(['x'], 'ticket.PDF', { type: '' }))).toBe(true);
  });
  it('returns false for an image', () => {
    expect(isPdfFile(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});

describe('pdfToExtractionImages', () => {
  it('wraps each rendered page blob into a page-numbered JPEG File and passes truncated', async () => {
    mockRender.mockResolvedValue({ blobs: [jpegBlob('p1'), jpegBlob('p2')], truncated: true });

    const res = await pdfToExtractionImages(
      new File(['%PDF-1.4'], 'My Itinerary.pdf', { type: 'application/pdf' })
    );

    expect(res.truncated).toBe(true);
    expect(res.files.map((f) => f.name)).toEqual(['My Itinerary-p1.jpg', 'My Itinerary-p2.jpg']);
    expect(res.files.every((f) => f.type === 'image/jpeg')).toBe(true);
  });

  it('delegates to the shared renderPdfPages with the extraction cap + long-edge', async () => {
    mockRender.mockResolvedValue({ blobs: [jpegBlob('p1')], truncated: false });

    await pdfToExtractionImages(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }));

    expect(mockRender).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      longEdge: 1600,
      maxPages: MAX_EXTRACT_PAGES,
    });
  });

  it('propagates a render failure (caller classifies it as a compression error)', async () => {
    mockRender.mockRejectedValue(new Error('corrupt or password-protected'));
    await expect(
      pdfToExtractionImages(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }))
    ).rejects.toThrow('corrupt');
  });
});

describe('code-split guard', () => {
  it('does NOT statically import pdfjs-dist (it must stay dynamically loaded)', () => {
    // The extraction service imports this module statically, so a static pdfjs-dist import here
    // would pull pdf.js into the main bundle. pdfjs is reached only via renderPdfPages.
    const src = readFileSync(resolve('src/utils/pdfExtractionImages.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]pdfjs-dist/);
    expect(src).not.toMatch(/import\(\s*['"]pdfjs-dist/);
  });
});
