import { ref, computed, nextTick, onMounted } from 'vue';
import {
  exportElementToPng,
  pngBlobsToPdf,
  prewarmSheetExport,
  ExportError,
  type ExportStage,
} from '@/composables/useSheetExport';
import { SHEET_EXPORT_FONTS } from '@/components/export/sheetExportFonts';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { deliverFile, type FileKind } from '@/utils/deliverFile';
import { record as recordPerf } from '@/utils/perfTiming';
import { logEvent } from '@/services/telemetry/logEvent';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Share = a PNG to the OS share sheet; PDF = download (share sheet on iOS). */
export type SheetExportFormat = 'image' | 'pdf';

export interface SheetExportRunnerOptions {
  /** Kebab-case surface for the start log and the failure report, e.g. `'plan-export'`. */
  surface: string;
  /** perfTiming label for build + rasterize. */
  perfName: string;
  /** Populate the sheet's view-model. Runs before the off-screen host mounts. */
  build: () => void | Promise<void>;
  /** The mounted sheet root (for a multi-page sheet, the stacked wrapper). Rasterised for PNG. */
  el: () => HTMLElement | null | undefined;
  /** One element per PDF page, in order. Default: `[el()]`, a one-page PDF of the whole sheet. */
  pageEls?: () => HTMLElement[];
  /** File name WITHOUT extension; the runner appends `.png` / `.pdf`. */
  filename: () => string;
  /** deliverFile kind per format. */
  kind: Record<SheetExportFormat, FileKind>;
  /** Share-sheet title, already translated. */
  shareTitle: () => string;
  /** Failure toast copy: title + help. */
  failedKey: UIStringKey;
  failedHelpKey: UIStringKey;
  /** Font faces the sheet's body uses beyond the shared shell's `SHEET_EXPORT_FONTS`. */
  fonts?: readonly string[];
}

/** iOS Safari refuses a canvas above ~16.7M pixels; stay under it with some margin. */
const MAX_CANVAS_PIXELS = 16e6;
const DEFAULT_PIXEL_RATIO = 2;

/**
 * Capture scale for an element: 2× (crisp on retina and when scaled into a PDF), lowered
 * for a tall stacked sheet so `w * h * ratio²` stays under the iOS canvas limit — past it,
 * Safari hands back a blank image rather than an error.
 */
export function exportPixelRatio(el: HTMLElement): number {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!(w > 0 && h > 0)) return DEFAULT_PIXEL_RATIO;
  return Math.min(DEFAULT_PIXEL_RATIO, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
}

/**
 * The export workflow every shareable sheet runs: busy flag → build → mount the
 * off-screen sheet → rasterise → (PDF) paginate → deliver → unmount.
 *
 * Failure contract: whichever stage throws, exactly ONE error toast fires (its
 * auto-report carries `surface` and `context: { format, stage }`) and `finally`
 * clears the busy flag and unmounts the sheet, so a throw can never leak the host.
 * `deliverFile` owns the delivery toast/report/telemetry for its own outcomes.
 *
 * The caller renders the host itself (`<div v-if="exportMounting">` + the sheet) so
 * the sheet inherits Pinia / i18n / theme, and binds its buttons to `run` /
 * `exportingFormat`. Call from `setup` (it prewarms the lazy export deps on mount).
 */
export function useSheetExportRunner(options: SheetExportRunnerOptions) {
  const { t } = useTranslation();
  const fonts = [...SHEET_EXPORT_FONTS, ...(options.fonts ?? [])];

  /** Gates the declarative off-screen host. */
  const exportMounting = ref(false);
  /** Which format is exporting (null = idle), so each button can show its own busy state. */
  const exportingFormat = ref<SheetExportFormat | null>(null);
  const exporting = computed(() => exportingFormat.value !== null);

  // Warm the code-split export deps so a later Share tap doesn't lose its iOS
  // user-activation window awaiting the chunk fetch.
  onMounted(() => prewarmSheetExport());

  function png(el: HTMLElement): Promise<Blob> {
    return exportElementToPng(el, {
      fonts,
      backgroundColor: '#F8F9FA',
      pixelRatio: exportPixelRatio(el),
    });
  }

  async function run(format: SheetExportFormat): Promise<void> {
    if (exportingFormat.value) return;
    exportingFormat.value = format;
    // `stage` is declared before the try so the catch can read it. Everything
    // else (incl. the start log) lives INSIDE the try so any throw still hits the
    // finally that clears the busy flag.
    let stage: ExportStage = 'render';
    try {
      const started = performance.now();
      // Retained as the absence-detection key: a start with no delivery event.
      logEvent({
        level: 'info',
        surface: options.surface,
        message: 'export started',
        context: { action: 'export-start', format },
      });

      // 1. Build the view-model + mount the sheet off-screen.
      await options.build();
      exportMounting.value = true;
      await nextTick();
      const root = options.el();
      if (!root) throw new ExportError('render', new Error('export sheet did not mount'));
      const pages = format === 'pdf' ? (options.pageEls?.() ?? [root]) : [root];
      if (pages.length === 0) throw new ExportError('render', new Error('export has no pages'));

      // 2. Rasterize (fonts-ready gated inside the engine). Pages one at a time:
      //    each is its own canvas, so memory stays one page deep.
      stage = 'rasterize';
      const pngs: Blob[] = [];
      for (const page of pages) pngs.push(await png(page));
      recordPerf(options.perfName, performance.now() - started, {
        perf_entity_count: pages.length,
      });

      // 3. PDF wraps the same PNGs, one per page.
      let blob = pngs[0]!;
      let ext = 'png';
      let mime = 'image/png';
      if (format === 'pdf') {
        stage = 'pdf';
        blob = await pngBlobsToPdf(pngs);
        ext = 'pdf';
        mime = 'application/pdf';
      }

      // 4. Deliver. The seam decides the mechanism per platform and owns the
      //    toast, the report and the delivery telemetry (surface `file-delivery`);
      //    its return value is deliberately unused, there is nothing after it to gate.
      stage = 'deliver';
      await deliverFile({
        blob,
        filename: `${options.filename()}.${ext}`,
        mimeType: mime,
        title: options.shareTitle(),
        kind: format === 'pdf' ? options.kind.pdf : options.kind.image,
      });
    } catch (err) {
      const failStage = err instanceof ExportError ? err.stage : stage;
      // ONE call: showToast('error') auto-invokes reportError with this
      // surface/error/context, so a separate reportError would double-report.
      showToast('error', t(options.failedKey), t(options.failedHelpKey), {
        surface: options.surface,
        error: err,
        context: { format, stage: failStage },
      });
    } finally {
      // Unmounting the host in `finally` means a thrown error can never leak it.
      exportMounting.value = false;
      exportingFormat.value = null;
    }
  }

  return { exportMounting, exportingFormat, exporting, run };
}
