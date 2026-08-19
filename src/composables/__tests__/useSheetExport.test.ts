import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock the lazy deps BEFORE importing the module under test ────────────────
const toBlob = vi.fn();
vi.mock('html-to-image', () => ({ toBlob: (...args: unknown[]) => toBlob(...args) }));

const jsPdfCtor = vi.fn();
const addImage = vi.fn();
const output = vi.fn(() => new Blob(['pdf'], { type: 'application/pdf' }));
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
    jsPdfCtor(opts);
    return {
      internal: { pageSize: { getWidth: () => 841.89, getHeight: () => 595.28 } },
      addImage,
      output,
    };
  }),
}));

import { exportElementToPng, pngBlobToPdf, ExportError } from '@/composables/useSheetExport';

// Deterministic image decode — jsdom/happy-dom don't decode data URLs.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1000;
  naturalHeight = 700;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const fontsLoad = vi.fn(() => Promise.resolve([]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', FakeImage);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: fontsLoad, ready: Promise.resolve() },
  });
});

describe('exportElementToPng', () => {
  it('loads the sheet fonts and returns the rasterised PNG blob', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    toBlob.mockResolvedValue(png);
    const el = document.createElement('div');

    const result = await exportElementToPng(el, { fonts: ['700 16px Outfit', '400 14px Inter'] });

    expect(result).toBe(png);
    // Each declared face was forced into flight (before capture — toBlob ran after).
    expect(fontsLoad).toHaveBeenCalledWith('700 16px Outfit');
    expect(fontsLoad).toHaveBeenCalledWith('400 14px Inter');
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(toBlob.mock.calls[0][1]).toMatchObject({ pixelRatio: 2 });
  });

  it('memoises the lazy import — a second export reuses it and still works', async () => {
    toBlob.mockResolvedValue(new Blob(['png']));
    const el = document.createElement('div');
    await exportElementToPng(el);
    await exportElementToPng(el);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it('throws ExportError(stage="rasterize") when html-to-image rejects', async () => {
    toBlob.mockRejectedValue(new Error('canvas tainted'));
    await expect(exportElementToPng(document.createElement('div'))).rejects.toMatchObject({
      name: 'ExportError',
      stage: 'rasterize',
    });
  });

  it('throws ExportError(stage="rasterize") when html-to-image returns null', async () => {
    toBlob.mockResolvedValue(null);
    await expect(exportElementToPng(document.createElement('div'))).rejects.toBeInstanceOf(
      ExportError
    );
  });
});

describe('pngBlobToPdf', () => {
  it('wraps the PNG in a single landscape-A4 page and returns a PDF blob', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const result = await pngBlobToPdf(png);

    expect(jsPdfCtor).toHaveBeenCalledWith({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addImage.mock.calls[0][1]).toBe('PNG');
    expect(output).toHaveBeenCalledWith('blob');
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('application/pdf');
  });

  it('throws ExportError(stage="pdf") when the image cannot be decoded', async () => {
    class BadImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BadImage);
    await expect(pngBlobToPdf(new Blob(['png']))).rejects.toMatchObject({
      name: 'ExportError',
      stage: 'pdf',
    });
  });
});
