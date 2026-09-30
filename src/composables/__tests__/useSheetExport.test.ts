import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock the lazy deps BEFORE importing the module under test ────────────────
const toBlob = vi.fn();
vi.mock('html-to-image', () => ({ toBlob: (...args: unknown[]) => toBlob(...args) }));

const jsPdfCtor = vi.fn();
const addImage = vi.fn();
const addPage = vi.fn();
const output = vi.fn(() => new Blob(['pdf'], { type: 'application/pdf' }));
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
    jsPdfCtor(opts);
    return {
      internal: { pageSize: { getWidth: () => 841.89, getHeight: () => 595.28 } },
      addImage,
      addPage,
      output,
    };
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));

import {
  exportElementToPng,
  pngBlobToPdf,
  pngBlobsToPdf,
  ExportError,
} from '@/composables/useSheetExport';

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

  describe('font embedding (built by us, not html-to-image: its getFontEmbedCSS returns "" in prod)', () => {
    /** A sheet using Caveat, with the face declared in a stylesheet like the Google Fonts one. */
    function mountSheet(fontUrl: string): { el: HTMLElement; cleanup: () => void } {
      const style = document.createElement('style');
      style.textContent = `@font-face { font-family: 'Caveat'; font-weight: 700; src: url(${fontUrl}) format('woff2'); unicode-range: U+0000-00FF; }`;
      document.head.appendChild(style);
      const el = document.createElement('div');
      const accent = document.createElement('span');
      accent.style.fontFamily = 'Caveat, cursive';
      accent.textContent = 'every job';
      el.appendChild(accent);
      document.body.appendChild(el);
      return {
        el,
        cleanup: () => {
          style.remove();
          el.remove();
        },
      };
    }

    it('inlines the faces the sheet uses as data: URLs and logs the success', async () => {
      toBlob.mockResolvedValue(new Blob(['png']));
      const fetchMock = vi.fn(async () => new Response(new Blob(['woff2'])));
      vi.stubGlobal('fetch', fetchMock);
      const { el, cleanup } = mountSheet('https://fonts.test/caveat-ok.woff2');
      try {
        await exportElementToPng(el);
      } finally {
        cleanup();
        vi.unstubAllGlobals();
      }
      const opts = toBlob.mock.calls[0][1];
      expect(opts.skipFonts).toBeUndefined();
      expect(opts.fontEmbedCSS).toMatch(/font-family:\s*['"]?Caveat/);
      expect(opts.fontEmbedCSS).toContain('url(data:');
      expect(opts.fontEmbedCSS).not.toContain('fonts.test');
      expect(fetchMock).toHaveBeenCalledWith('https://fonts.test/caveat-ok.woff2');
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          surface: 'sheet-export',
          context: expect.objectContaining({ action: 'font-embed', count: 1 }),
        })
      );
    });

    it('never embeds silently-nothing: a face it cannot fetch is logged and the capture goes bare', async () => {
      toBlob.mockResolvedValue(new Blob(['png']));
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        })
      );
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: {
          load: fontsLoad,
          ready: Promise.resolve(),
          forEach: (cb: (f: { family: string }) => void) => cb({ family: '"Caveat"' }),
        },
      });
      const { el, cleanup } = mountSheet('https://fonts.test/caveat-down.woff2');
      try {
        await exportElementToPng(el);
      } finally {
        cleanup();
        vi.unstubAllGlobals();
      }
      expect(toBlob.mock.calls[0][1]).toMatchObject({ skipFonts: true });
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          surface: 'sheet-export',
          context: expect.objectContaining({
            error_code: 'font-embed-empty',
            detail: 'caveat',
            file_count: 1,
          }),
        })
      );
    });
  });

  it('excludes [data-export-hide] subtrees from the capture, but never the root', async () => {
    toBlob.mockResolvedValue(new Blob(['png']));
    const el = document.createElement('div');

    await exportElementToPng(el);

    const filter = toBlob.mock.calls[0][1].filter as (n: Node) => boolean;

    // The marked node and nothing else. A copy button on the recovery kit is the
    // motivating case: tappable on screen, meaningless rasterised into the PDF.
    const button = document.createElement('button');
    button.setAttribute('data-export-hide', '');
    expect(filter(button)).toBe(false);
    expect(filter(document.createElement('button'))).toBe(true);

    // Text nodes carry no attributes — they must survive rather than throw.
    expect(filter(document.createTextNode('the link'))).toBe(true);

    // Guarding the root is html-to-image's job (it never calls `filter` on it), but a sheet
    // that marked ITSELF would otherwise export as nothing, so pin the assumption.
    el.setAttribute('data-export-hide', '');
    await exportElementToPng(el);
    expect(await exportElementToPng(el)).toBeInstanceOf(Blob);
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

describe('pngBlobsToPdf', () => {
  it('puts each PNG on its own landscape-A4 page, in order', async () => {
    const pngs = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const result = await pngBlobsToPdf(pngs);

    expect(jsPdfCtor).toHaveBeenCalledTimes(1);
    expect(addImage).toHaveBeenCalledTimes(3);
    // The first page comes with the document; each later one is added.
    expect(addPage).toHaveBeenCalledTimes(2);
    expect(addPage).toHaveBeenCalledWith('a4', 'landscape');
    expect(output).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('application/pdf');
  });

  it('a single PNG adds no extra page', async () => {
    await pngBlobsToPdf([new Blob(['a'])]);
    expect(addPage).not.toHaveBeenCalled();
    expect(addImage).toHaveBeenCalledTimes(1);
  });

  it('throws ExportError(stage="pdf") for an empty page list', async () => {
    await expect(pngBlobsToPdf([])).rejects.toMatchObject({ name: 'ExportError', stage: 'pdf' });
    expect(jsPdfCtor).not.toHaveBeenCalled();
  });
});
