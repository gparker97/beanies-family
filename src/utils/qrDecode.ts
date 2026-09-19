/**
 * QR decoding from a user-supplied file: lets a family redeem their recovery kit by
 * uploading the saved kit PDF itself or a photo of the printed QR, and lets the in-app
 * scanner read a code off another device's screen. `jsqr` and `pdfjs-dist` are lazy-loaded
 * so the login bundle stays lean.
 *
 * ⚠️ THE HARD PART IS CONTRAST, NOT RESOLUTION, AND THAT IS NOT OBVIOUS.
 *
 * Every QR this app mints is HERITAGE ORANGE on white — `generateInviteQR` (`qrCode.ts`) is
 * the only minting path, and it draws `#F15D22`. jsQR binarises on Rec.709 luma
 * (`0.2126r + 0.7152g + 0.0722b`), and `#F15D22` resolves to luma **120** against white's
 * 255. That is roughly HALF the module/background separation a black-on-white code gives,
 * before a phone photo's JPEG chroma subsampling — which smears precisely the colour channel
 * carrying the signal — auto-white-balance and a downscale have had their turn.
 *
 * Reading the BLUE channel instead recovers it: `#F15D22` has `b = 0x22 = 34`, so separation
 * goes from 120<->255 to 34<->255. It costs one buffer copy and is equally safe for a
 * black-on-white code (0<->255). This is why a code that the phone's own camera app reads
 * instantly could fail here about nine times in ten.
 *
 * ⚠️ `inversionAttempts` IS NOT PASSED, DELIBERATELY. jsQR already defaults to
 * `'attemptBoth'`. Passing it is a no-op and reads as though it were part of a fix.
 *
 * ⚠️ THE DECISIONS LIVE IN `runQrLadder`, WHICH TOUCHES NO BROWSER API, AND THAT IS THE ONLY
 * REASON ANY OF THIS IS TESTED. This repo's vitest environment is happy-dom, where
 * `canvas.getContext('2d')` returns `null` — so a ladder written inside the code that also
 * owns the canvas could not be reached by a single unit test: every call would take the
 * "unsupported device" branch without looking at a pixel. The shell below owns the browser;
 * the runner owns the choices; the seam between them is what makes this verifiable.
 */

import { loadPdfjs, renderPdfPageToBlob } from '@/utils/pdfRender';

/** Downscale target for the ordinary passes. jsQR is O(pixels) and phone photos are huge. */
const MAX_DIM = 1600;
/** The last-resort pass. Never upscales — the scale is clamped to 1. */
const LARGE_DIM = 2600;

/**
 * Why a decode failed. FOUR reasons, because the single `null` this used to return covered
 * four genuinely different situations that need four different things said to the user:
 * only `no-code` is the person's doing, `unsupported-device` wants "try the saved PDF
 * instead", and `decoder-unavailable` is an offline first-load that will work on a retry.
 * Collapsing them meant "we couldn't find a code in that photo" was shown to someone whose
 * browser had simply failed to fetch a chunk.
 */
export type QrDecodeFailure =
  'no-code' | 'unreadable-image' | 'unsupported-device' | 'decoder-unavailable';

export type QrDecodeResult =
  | { ok: true; data: string; rung: QrRung }
  | { ok: false; reason: QrDecodeFailure; rung?: undefined; cause?: unknown };

/** Which attempt produced the answer. Reported by the caller so decode quality is measurable. */
export type QrRung = 'native' | 'full-luma' | 'full-blue' | 'crop-blue' | 'large-blue';

interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type RenderSpec = { maxDim: number; crop?: number };

type LadderStep = {
  render: RenderSpec;
  attempts: readonly { rung: QrRung; channel: 'luma' | 'blue' }[];
};

/**
 * ⚠️ ONE RENDER PER STEP, AND NOTHING IS SHARED BETWEEN STEPS. An earlier design cached a
 * single rendered buffer across rungs and mutated it in place to derive the blue channel,
 * which made the array's ORDER load-bearing: move the blue rung above the luma one and the
 * luma rung silently reads blue-channel pixels. `toBlueChannel` returns a copy instead, so
 * the attempts inside a step are order-independent and the order here is purely a cost
 * preference — try the free one first. Getting it "wrong" costs milliseconds, not
 * correctness.
 *
 * Adding a rung is one line of data, and that line cannot break another.
 */
const LADDER: readonly LadderStep[] = [
  {
    render: { maxDim: MAX_DIM },
    attempts: [
      { rung: 'full-luma', channel: 'luma' }, // what shipped before; cheapest
      { rung: 'full-blue', channel: 'blue' }, // the Heritage Orange fix
    ],
  },
  {
    render: { maxDim: MAX_DIM, crop: 0.5 },
    attempts: [{ rung: 'crop-blue', channel: 'blue' }], // people aim at the middle
  },
  {
    render: { maxDim: LARGE_DIM },
    attempts: [{ rung: 'large-blue', channel: 'blue' }], // last resort, most expensive
  },
];

/** Output dimensions a spec produces for a source of this size. Pure; never upscales. */
function outputSize(
  source: { width: number; height: number },
  spec: RenderSpec
): { width: number; height: number } {
  const crop = spec.crop ?? 1;
  const w = Math.max(1, Math.round(source.width * crop));
  const h = Math.max(1, Math.round(source.height * crop));
  const scale = Math.min(1, spec.maxDim / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Which attempts a source of these dimensions actually costs.
 *
 * Exported for test, and it asserts something real rather than the order of a constant: a
 * 1200x900 photo plans THREE attempts, not four, because the `LARGE_DIM` step clamps to 1
 * and reproduces pixels `full-blue` already tried. That covers every PDF, since
 * `decodeQrFromPdf` renders at `MAX_DIM`.
 */
export function plannedAttempts(source: { width: number; height: number }): readonly QrRung[] {
  const seen = new Set<string>();
  const planned: QrRung[] = [];
  for (const step of LADDER) {
    const { width, height } = outputSize(source, step.render);
    for (const attempt of step.attempts) {
      // ⚠️ `crop` IS PART OF THE IDENTITY, not just the size. A centre crop of a 4032x3024
      // photo lands at the same 1600x1200 as the uncropped render but contains COMPLETELY
      // DIFFERENT PIXELS. Keying on dimensions alone silently skipped the crop pass — the
      // one added because people aim at the middle.
      const tuple = `${width}x${height}:${step.render.crop ?? 1}:${attempt.channel}`;
      if (seen.has(tuple)) continue;
      seen.add(tuple);
      planned.push(attempt.rung);
    }
  }
  return planned;
}

/**
 * Copy `b` into `r` and `g` so jsQR's luma resolves to the blue value.
 *
 * Returns a NEW buffer rather than writing through the caller's — see the LADDER comment.
 */
function toBlueChannel(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  for (let i = 0; i < out.length; i += 4) {
    const b = out[i + 2]!;
    out[i] = b;
    out[i + 1] = b;
  }
  return out;
}

export type LadderOutcome =
  | { ok: true; data: string; rung: QrRung; attempts: readonly QrRung[] }
  | { ok: false; reason: 'no-code' | 'unsupported-device'; attempts: readonly QrRung[] };

/**
 * Every decision, and no browser API. See the file header for why this seam exists.
 *
 * `decode` is ASYNC so the shell can defer `import('jsqr')` until the native attempt has
 * failed: otherwise an Android device whose `BarcodeDetector` succeeds still pays for a
 * chunk it never uses, and an offline first-load reports `decoder-unavailable` even though
 * the platform decoder could have read the code.
 */
export async function runQrLadder(deps: {
  source: { width: number; height: number };
  /** null => this render could not be produced (no 2D context, or out of memory). */
  render: (spec: RenderSpec) => ImageDataLike | null;
  /** A rejection propagates; the shell classifies it. */
  decode: (data: Uint8ClampedArray, width: number, height: number) => Promise<string | null>;
  /** Supplied only when the platform has BarcodeDetector. May throw; caught here. */
  native?: () => Promise<string | null>;
  /** Awaited BETWEEN STEPS so the browser can paint. Tests pass nothing. */
  yieldToUi?: () => Promise<void>;
}): Promise<LadderOutcome> {
  const attempts: QrRung[] = [];
  /**
   * ⚠️ TRACKS WHETHER ANYTHING ACTUALLY LOOKED AT THE IMAGE, which is what separates the two
   * failure reasons once there is more than one render. With a single render, "the render
   * failed" and "we never saw a pixel" were the same statement; they are not any more.
   */
  let examined = false;

  if (deps.native) {
    attempts.push('native');
    try {
      const data = await deps.native();
      if (data) return { ok: true, data, rung: 'native', attempts };
      // It ran and found nothing. Something DID look at the image.
      examined = true;
    } catch {
      // A present-but-broken platform decoder. Fall through to jsQR rather than fail; the
      // caller reports the fall-through via `attempts`, so this is not a silent swallow.
    }
  }

  const seen = new Set<string>();
  let stepIndex = 0;
  for (const step of LADDER) {
    if (stepIndex++ > 0) await deps.yieldToUi?.();

    let rendered: ImageDataLike | null | undefined;
    for (const attempt of step.attempts) {
      if (rendered === undefined) rendered = deps.render(step.render);
      if (rendered === null) break; // this render is unavailable; try the next step
      // Same identity rule as `plannedAttempts`, and it must stay the same or the two
      // disagree — which a test asserts directly.
      const tuple = `${rendered.width}x${rendered.height}:${step.render.crop ?? 1}:${attempt.channel}`;
      if (seen.has(tuple)) continue;
      seen.add(tuple);
      examined = true;
      attempts.push(attempt.rung);

      const pixels = attempt.channel === 'blue' ? toBlueChannel(rendered.data) : rendered.data;
      const data = await deps.decode(pixels, rendered.width, rendered.height);
      if (data) return { ok: true, data, rung: attempt.rung, attempts };
    }
  }

  // ⚠️ `unsupported-device` ONLY when nothing looked at the image. Telling an Android user
  // their device is unsupported when its platform decoder just examined their photo would
  // be exactly the class of wrong message this reason union exists to prevent.
  return { ok: false, reason: examined ? 'no-code' : 'unsupported-device', attempts };
}

/** Render page 1 of a PDF (the kit is one page) to a blob the shell can decode. */
async function renderPdfFirstPage(file: File): Promise<Blob> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    return await renderPdfPageToBlob(await doc.getPage(1), MAX_DIM, 0.95);
  } finally {
    await doc.destroy();
  }
}

/** A macrotask, not a microtask: only this actually releases the frame so the UI can paint. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Decode a QR from an image OR the kit PDF itself.
 *
 * ⚠️ The `cause` is carried on the failure rather than being swallowed, so the ONE place
 * that reports can attach a real stack. Callers that re-report a bare reason string produce
 * a CloudWatch entry with nothing behind it.
 */
export async function decodeQrFromImageFile(file: File): Promise<QrDecodeResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let bitmap: ImageBitmap | null = null;
  try {
    const source = isPdf ? await renderPdfFirstPage(file) : file;
    bitmap = await createImageBitmap(source);
    const frame = bitmap;

    // Memoised on FIRST ACTUAL USE, after the native attempt has had its turn.
    let jsQR: typeof import('jsqr').default | null = null;

    const outcome = await runQrLadder({
      source: { width: frame.width, height: frame.height },
      render: (spec) => {
        const crop = spec.crop ?? 1;
        const sw = Math.max(1, Math.round(frame.width * crop));
        const sh = Math.max(1, Math.round(frame.height * crop));
        const sx = Math.round((frame.width - sw) / 2);
        const sy = Math.round((frame.height - sh) / 2);
        const { width, height } = outputSize({ width: frame.width, height: frame.height }, spec);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Memory pressure or a hardened browser. NOT "no code in this photo" — nothing was
        // looked at, and the runner distinguishes the two.
        if (!ctx) return null;
        ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      },
      decode: async (data, width, height) => {
        jsQR ??= (await import('jsqr')).default;
        return jsQR(data, width, height)?.data ?? null;
      },
      native: nativeDetector(frame),
      yieldToUi,
    });

    return outcome.ok
      ? { ok: true, data: outcome.data, rung: outcome.rung }
      : { ok: false, reason: outcome.reason };
  } catch (cause) {
    // A rejected `import('jsqr')` / `loadPdfjs()` is an offline first-load, which retries
    // fine once the chunk is cached. Anything else is the file itself.
    const isChunkFailure =
      cause instanceof Error && /import|chunk|dynamically imported module/i.test(cause.message);
    return {
      ok: false,
      reason: isChunkFailure ? 'decoder-unavailable' : 'unreadable-image',
      cause,
    };
  } finally {
    // Never closed before this, so every scan leaked a full decoded frame until GC.
    bitmap?.close();
  }
}

/**
 * The platform decoder, when there is one.
 *
 * Native on Android Chrome and substantially better than jsQR, which is why it goes first.
 * Absent in happy-dom, so unit tests exercise the jsQR path unless they stub it explicitly.
 */
function nativeDetector(frame: ImageBitmap): (() => Promise<string | null>) | undefined {
  const Ctor = (
    globalThis as unknown as {
      BarcodeDetector?: new (o: { formats: string[] }) => {
        detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
      };
    }
  ).BarcodeDetector;
  if (!Ctor) return undefined;
  return async () => {
    const found = await new Ctor({ formats: ['qr_code'] }).detect(frame);
    return found[0]?.rawValue ?? null;
  };
}
