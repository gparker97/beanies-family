import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  exportPixelRatio,
  useSheetExportRunner,
  type SheetExportRunnerOptions,
} from '@/composables/useSheetExportRunner';
import * as sheetExport from '@/composables/useSheetExport';
import { SHEET_EXPORT_FONTS } from '@/components/export/sheetExportFonts';
import { showToast } from '@/composables/useToast';
import { deliverFile } from '@/utils/deliverFile';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('@/utils/deliverFile', () => ({ deliverFile: vi.fn() }));
vi.mock('@/composables/useSheetExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSheetExport')>()),
  exportElementToPng: vi.fn(),
  pngBlobsToPdf: vi.fn(),
  prewarmSheetExport: vi.fn(),
}));

const exportElementToPng = vi.mocked(sheetExport.exportElementToPng);
const pngBlobsToPdf = vi.mocked(sheetExport.pngBlobsToPdf);

function sized(w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetWidth', { value: w });
  Object.defineProperty(el, 'offsetHeight', { value: h });
  return el;
}

const root = sized(1123, 900);
const pages = [sized(1123, 800), sized(1123, 800), sized(1123, 800)];

function baseOptions(over: Partial<SheetExportRunnerOptions> = {}): SheetExportRunnerOptions {
  return {
    surface: 'deck-export',
    perfName: 'deck-export',
    build: vi.fn(),
    el: () => root,
    pageEls: () => pages,
    filename: () => 'beanies-deck',
    kind: { image: 'meal-plan-png', pdf: 'meal-plan-pdf' },
    shareTitle: () => 'share title',
    failedKey: 'mealPlanner.export.failed',
    failedHelpKey: 'mealPlanner.export.failedHelp',
    fonts: ['500 15px Outfit'],
    ...over,
  };
}

/** Runs the composable inside a component so its onMounted prewarm has a scope. */
function setup(options: SheetExportRunnerOptions) {
  let api!: ReturnType<typeof useSheetExportRunner>;
  mount(
    defineComponent({
      setup() {
        api = useSheetExportRunner(options);
        return () => h('div');
      },
    })
  );
  return api;
}

function errorToasts() {
  return vi.mocked(showToast).mock.calls.filter((c) => c[0] === 'error');
}

describe('exportPixelRatio', () => {
  it('is 2 for a one-page sheet', () => {
    expect(exportPixelRatio(sized(1123, 800))).toBe(2);
  });

  it('is clamped so a tall stacked sheet stays under the iOS canvas limit', () => {
    const el = sized(1123, 5 * 800);
    const ratio = exportPixelRatio(el);
    expect(ratio).toBeLessThan(2);
    expect(1123 * 4000 * ratio * ratio).toBeLessThanOrEqual(16e6 + 1);
  });

  it('falls back to 2 for an unmeasurable element', () => {
    expect(exportPixelRatio(sized(0, 0))).toBe(2);
  });
});

describe('useSheetExportRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportElementToPng.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }));
    pngBlobsToPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    vi.mocked(deliverFile).mockResolvedValue({ delivered: true } as never);
  });

  it('prewarms the export deps on mount', () => {
    setup(baseOptions());
    expect(sheetExport.prewarmSheetExport).toHaveBeenCalledTimes(1);
  });

  it('PDF: rasterises each page and hands the PNGs to pngBlobsToPdf in order', async () => {
    const api = setup(baseOptions());
    await api.run('pdf');

    expect(exportElementToPng.mock.calls.map((c) => c[0])).toEqual(pages);
    const blobs = await Promise.all(exportElementToPng.mock.results.map((r) => r.value));
    expect(pngBlobsToPdf).toHaveBeenCalledWith(blobs);
    expect(vi.mocked(deliverFile).mock.calls[0]![0]).toMatchObject({
      filename: 'beanies-deck.pdf',
      mimeType: 'application/pdf',
      kind: 'meal-plan-pdf',
      title: 'share title',
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('image: rasterises the stacked root once, with the shared + extra fonts', async () => {
    const api = setup(baseOptions());
    await api.run('image');

    expect(exportElementToPng).toHaveBeenCalledTimes(1);
    const [el, opts] = exportElementToPng.mock.calls[0]!;
    expect(el).toBe(root);
    expect(opts?.fonts).toEqual([...SHEET_EXPORT_FONTS, '500 15px Outfit']);
    expect(opts?.pixelRatio).toBe(2);
    expect(pngBlobsToPdf).not.toHaveBeenCalled();
    expect(vi.mocked(deliverFile).mock.calls[0]![0]).toMatchObject({
      filename: 'beanies-deck.png',
      kind: 'meal-plan-png',
    });
  });

  it('logs export-start under the given surface', async () => {
    const api = setup(baseOptions());
    await api.run('image');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'deck-export',
        context: { action: 'export-start', format: 'image' },
      })
    );
  });

  it('ignores a second run while one is in flight', async () => {
    const api = setup(baseOptions());
    const first = api.run('pdf');
    expect(api.exportingFormat.value).toBe('pdf');
    await api.run('image');
    await first;
    expect(deliverFile).toHaveBeenCalledTimes(1);
  });

  it('a sheet that did not mount: one toast at stage render, busy flag cleared', async () => {
    const api = setup(baseOptions({ el: () => null }));
    await api.run('image');
    await flushPromises();

    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0]).toEqual([
      'error',
      'mealPlanner.export.failed',
      'mealPlanner.export.failedHelp',
      expect.objectContaining({
        surface: 'deck-export',
        context: { format: 'image', stage: 'render' },
      }),
    ]);
    expect(api.exporting.value).toBe(false);
    expect(api.exportMounting.value).toBe(false);
  });

  it('a build that throws a plain Error is reported at stage render', async () => {
    const api = setup(
      baseOptions({
        build: () => {
          throw new Error('bad model');
        },
      })
    );
    await api.run('pdf');

    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0]![3]).toMatchObject({ context: { format: 'pdf', stage: 'render' } });
    expect(api.exporting.value).toBe(false);
  });

  it('a page rasterise failure stops before the PDF and reports once', async () => {
    exportElementToPng.mockRejectedValueOnce(
      new sheetExport.ExportError('rasterize', new Error('x'))
    );
    const api = setup(baseOptions());
    await api.run('pdf');

    expect(pngBlobsToPdf).not.toHaveBeenCalled();
    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0]![3]).toMatchObject({ context: { format: 'pdf', stage: 'rasterize' } });
    expect(api.exportMounting.value).toBe(false);
  });
});
