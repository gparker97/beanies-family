/**
 * The decode ladder's contract.
 *
 * ⚠️ THIS FILE IS WHY `runQrLadder` IS EXPORTED AND PURE. This repo's vitest environment is
 * happy-dom, where `canvas.getContext('2d')` returns `null`. A ladder written inside the code
 * that owns the canvas could not be reached by ANY test here: every call would take the
 * "unsupported device" branch without looking at a pixel. That is exactly how `qrDecode.ts`
 * shipped with no test file at all while a contrast defect made the in-app scanner fail about
 * nine times in ten.
 *
 * So these tests drive the decisions through injected seams. Real-pixel decoding is verified
 * in the browser and on a device, which is where it can honestly be verified.
 */
import { describe, it, expect, vi } from 'vitest';
import { runQrLadder, plannedAttempts, type QrRung } from '../qrDecode';

/** A render seam that always succeeds, at the size the spec asks for. */
function renderer(source: { width: number; height: number }) {
  return (spec: { maxDim: number; crop?: number }) => {
    const crop = spec.crop ?? 1;
    const w = Math.max(1, Math.round(source.width * crop));
    const h = Math.max(1, Math.round(source.height * crop));
    const scale = Math.min(1, spec.maxDim / Math.max(w, h));
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  };
}

const BIG = { width: 4032, height: 3024 };

describe('runQrLadder', () => {
  it('stops at the FIRST attempt that reads, and never renders past it', async () => {
    const render = vi.fn(renderer(BIG));
    const out = await runQrLadder({
      source: BIG,
      render,
      decode: async () => 'PAYLOAD',
    });

    expect(out).toMatchObject({ ok: true, data: 'PAYLOAD', rung: 'full-luma' });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: falls through to the BLUE channel when luma cannot read it', async () => {
    // The Heritage Orange case, and the whole point of the change. Every code this app mints
    // is #F15D22 on white: luma 120 vs 255, about half a black-on-white code's separation.
    // The blue channel sees 34 vs 255. This simulates a photo only the blue pass can read.
    const BLUE_MARKER = 34;
    const render = (spec: { maxDim: number; crop?: number }) => {
      const base = renderer(BIG)(spec);
      // Put the signal in the blue byte only; r/g stay at 0 in a way luma would smear.
      for (let i = 0; i < base.data.length; i += 4) base.data[i + 2] = BLUE_MARKER;
      return base;
    };

    const out = await runQrLadder({
      source: BIG,
      render,
      // Reads only if r === the blue marker, i.e. only after toBlueChannel has run.
      decode: async (data) => (data[0] === BLUE_MARKER ? 'PAYLOAD' : null),
    });

    expect(out).toMatchObject({ ok: true, rung: 'full-blue' });
  });

  it('does not mutate the buffer the luma attempt was given', async () => {
    // If toBlueChannel wrote through the caller's array, the order of the attempts inside a
    // step would become load-bearing and a one-line reorder would silently corrupt the luma
    // pass. Copying is what makes the ladder safe to extend.
    const render = (spec: { maxDim: number; crop?: number }) => {
      const base = renderer(BIG)(spec);
      base.data[0] = 111;
      base.data[2] = 222;
      return base;
    };
    const seen: number[] = [];
    await runQrLadder({
      source: BIG,
      render,
      decode: async (data) => {
        seen.push(data[0]!);
        return null;
      },
    });

    // First attempt saw the original red byte; the blue attempt saw the blue one; and the
    // original was still intact when the second attempt read it.
    expect(seen[0]).toBe(111);
    expect(seen[1]).toBe(222);
  });

  it('walks the whole ladder and reports every attempt when nothing reads', async () => {
    const out = await runQrLadder({
      source: BIG,
      render: renderer(BIG),
      decode: async () => null,
    });

    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ reason: 'no-code' });
    expect(out.attempts).toEqual<QrRung[]>(['full-luma', 'full-blue', 'crop-blue', 'large-blue']);
  });

  it('tries the platform decoder FIRST and skips jsQR entirely when it reads', async () => {
    const decode = vi.fn(async () => 'JSQR');
    const out = await runQrLadder({
      source: BIG,
      render: renderer(BIG),
      decode,
      native: async () => 'NATIVE',
    });

    expect(out).toMatchObject({ ok: true, data: 'NATIVE', rung: 'native' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('falls through to jsQR when the platform decoder THROWS, and says so in attempts', async () => {
    // A present-but-broken BarcodeDetector must degrade, not fail the decode — but it must
    // not do so invisibly either, or it reads as merely slow.
    const out = await runQrLadder({
      source: BIG,
      render: renderer(BIG),
      decode: async () => 'JSQR',
      native: async () => {
        throw new Error('detector exploded');
      },
    });

    expect(out).toMatchObject({ ok: true, data: 'JSQR', rung: 'full-luma' });
    expect(out.attempts[0]).toBe('native');
  });

  it('says unsupported-device ONLY when nothing looked at the image', async () => {
    const out = await runQrLadder({
      source: BIG,
      render: () => null, // no 2D context anywhere
      decode: async () => null,
    });

    expect(out).toMatchObject({ ok: false, reason: 'unsupported-device' });
  });

  it('REGRESSION: a platform decoder that examined the photo yields no-code, not unsupported-device', async () => {
    // Telling an Android user their device is unsupported when its own decoder just read the
    // photo is the exact class of wrong message this reason union exists to prevent.
    const out = await runQrLadder({
      source: BIG,
      render: () => null,
      decode: async () => null,
      native: async () => null, // ran to completion, found nothing
    });

    expect(out).toMatchObject({ ok: false, reason: 'no-code' });
  });

  it('yields to the UI between steps so a four-pass ladder cannot freeze the phone', async () => {
    // jsQR is synchronous and O(pixels); the full ladder is ~12MP. Run back-to-back with no
    // break that is a multi-second freeze in which the busy label cannot even paint.
    const yieldToUi = vi.fn(async () => {});
    await runQrLadder({
      source: BIG,
      render: renderer(BIG),
      decode: async () => null,
      yieldToUi,
    });

    // Three steps => two boundaries between them.
    expect(yieldToUi).toHaveBeenCalledTimes(2);
  });
});

describe('plannedAttempts', () => {
  it('plans all four for a large photo', () => {
    expect(plannedAttempts(BIG)).toHaveLength(4);
  });

  it('skips the large pass for an image already below the cap, because it would re-scan identical pixels', () => {
    // Covers every PDF: decodeQrFromPdf renders at MAX_DIM, so the 2600 step clamps to 1 and
    // reproduces exactly what full-blue already tried.
    const planned = plannedAttempts({ width: 1200, height: 900 });
    expect(planned).toEqual<QrRung[]>(['full-luma', 'full-blue', 'crop-blue']);
  });

  it('agrees with what the ladder actually attempts', async () => {
    // The plan is only useful if it is not a second, drifting description of the ladder.
    const small = { width: 1200, height: 900 };
    const out = await runQrLadder({
      source: small,
      render: renderer(small),
      decode: async () => null,
    });
    expect(out.attempts).toEqual(plannedAttempts(small));
  });
});
