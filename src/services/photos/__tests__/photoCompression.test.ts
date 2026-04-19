import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compress, CompressionError } from '../photoCompression';

/**
 * happy-dom doesn't implement a real canvas backend, so we mock
 * createImageBitmap and the canvas API. These tests verify the sizing /
 * scaling / mime logic — not actual pixel encoding. The visual quality of
 * the output is covered by manual testing.
 */

interface MockBitmap {
  width: number;
  height: number;
  close: () => void;
}

function mockBitmap(width: number, height: number): MockBitmap {
  return { width, height, close: vi.fn() };
}

function stubCanvasAndBitmap(bitmap: MockBitmap): { drawImage: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  const toBlob = (cb: (b: Blob | null) => void) => {
    // Return a dummy blob; tests assert on sizing, not pixel content.
    cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
  };
  const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
  const originalCreateElement = document.createElement.bind(document);

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob,
      } as unknown as HTMLCanvasElement;
      return canvas;
    }
    return originalCreateElement(tag);
  }) as typeof document.createElement);

  globalThis.createImageBitmap = vi
    .fn()
    .mockResolvedValue(bitmap) as unknown as typeof createImageBitmap;

  return { drawImage };
}

function makeFile(sizeBytes: number, type: string): File {
  // happy-dom computes file.size from the input parts, so pad with repeated bytes.
  const data = new Uint8Array(sizeBytes);
  return new File([data], 'input.jpg', { type });
}

describe('photoCompression.compress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downscales a 4000×3000 image so the long edge is ≤ 2048', async () => {
    stubCanvasAndBitmap(mockBitmap(4000, 3000));
    const result = await compress(makeFile(5_000_000, 'image/jpeg'));
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2048);
    expect(result.mime).toBe('image/jpeg');
  });

  it('preserves aspect ratio when downscaling', async () => {
    stubCanvasAndBitmap(mockBitmap(4000, 3000));
    const result = await compress(makeFile(5_000_000, 'image/jpeg'));
    // 4000/3000 = 4/3 ≈ 1.333
    const ratio = result.width / result.height;
    expect(ratio).toBeCloseTo(4 / 3, 2);
  });

  it('preserves portrait aspect ratio', async () => {
    stubCanvasAndBitmap(mockBitmap(3000, 4000));
    const result = await compress(makeFile(5_000_000, 'image/jpeg'));
    expect(result.height).toBeGreaterThan(result.width);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2048);
  });

  it('early-returns the original file when it is a small JPEG within the cap', async () => {
    const bitmap = mockBitmap(1024, 768);
    stubCanvasAndBitmap(bitmap);
    const original = makeFile(100 * 1024, 'image/jpeg'); // 100KB
    const result = await compress(original);
    expect(result.blob).toBe(original);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  it('does not early-return for a PNG even if small', async () => {
    const bitmap = mockBitmap(800, 600);
    stubCanvasAndBitmap(bitmap);
    const original = makeFile(100 * 1024, 'image/png');
    const result = await compress(original);
    expect(result.blob).not.toBe(original);
    expect(result.mime).toBe('image/jpeg');
  });

  it('does not early-return for a JPEG above the size threshold', async () => {
    const bitmap = mockBitmap(1024, 768);
    stubCanvasAndBitmap(bitmap);
    const original = makeFile(2 * 1024 * 1024, 'image/jpeg'); // 2MB
    const result = await compress(original);
    expect(result.blob).not.toBe(original);
  });

  it('respects custom maxDimension (avatar path uses 1024)', async () => {
    stubCanvasAndBitmap(mockBitmap(4000, 3000));
    const result = await compress(makeFile(5_000_000, 'image/jpeg'), { maxDimension: 1024 });
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1024);
  });

  it('accepts custom JPEG quality without changing other defaults', async () => {
    const { drawImage } = stubCanvasAndBitmap(mockBitmap(1024, 768));
    // Force a recompression path (PNG input, size above threshold).
    await compress(makeFile(2 * 1024 * 1024, 'image/png'), { quality: 0.92 });
    expect(drawImage).toHaveBeenCalled();
  });

  it('wraps decode failures in CompressionError with a helpful message', async () => {
    globalThis.createImageBitmap = vi
      .fn()
      .mockRejectedValue(new Error('unsupported')) as unknown as typeof createImageBitmap;
    const heic = makeFile(500_000, 'image/heic');
    await expect(compress(heic)).rejects.toBeInstanceOf(CompressionError);
    await expect(compress(heic)).rejects.toThrow(/HEIC/);
  });
});
