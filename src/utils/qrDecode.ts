/**
 * QR decoding from a user-supplied image (login rethink Phase 3): lets a family redeem
 * their recovery kit by photographing/uploading the printed QR instead of transcribing
 * 32 characters. Lazy-loads `jsqr` (small, zero-dep) so the login bundle stays lean.
 */

export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  try {
    const [{ default: jsQR }, bitmap] = await Promise.all([
      import('jsqr'),
      createImageBitmap(file),
    ]);
    // Downscale very large photos — jsQR is O(pixels) and phone photos are huge.
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, width, height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}
