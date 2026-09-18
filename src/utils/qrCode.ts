/**
 * QR code generation for invite links.
 * Brand-themed: Heritage Orange dots with beanies logo overlay in the center.
 */

import QRCode from 'qrcode';
import { logEvent } from '@/services/telemetry/logEvent';

/** Logo path for center overlay (relative to public/) */
const LOGO_PATH = '/brand/beanies_logo_transparent_logo_only_192x192.png';

/** Load an image as HTMLImageElement */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Overlay the beanies logo onto a QR data URL. Returns the composited data URL. */
async function addLogoOverlay(qrDataUrl: string, size: number): Promise<string> {
  if (typeof document === 'undefined') return qrDataUrl;

  const logoFraction = 0.22;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrDataUrl;

  // Draw QR code
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, 0, 0, size, size);

  // Overlay beanies logo in center with white circle backing
  try {
    const logo = await loadImage(LOGO_PATH);
    const logoSize = Math.round(size * logoFraction);
    const padding = Math.round(logoSize * 0.2);
    const circleRadius = (logoSize + padding) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // White circle background (clears QR modules behind logo)
    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // Subtle Heritage Orange ring around the circle
    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(241, 93, 34, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw logo centered
    ctx.drawImage(logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
  } catch {
    // If logo fails to load, QR still works fine without it
  }

  return canvas.toDataURL('image/png');
}

/** Generate a PNG data-URL QR code with beanies logo overlay. */
export async function generateInviteQR(inviteUrl: string): Promise<string> {
  const size = 320;

  // Generate base QR as data URL (works in node + browser)
  const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'H', // High EC so logo doesn't break scanning
    color: {
      dark: '#F15D22', // Heritage Orange
      light: '#FFFFFF',
    },
  });

  // In browser, composite the logo overlay
  return addLogoOverlay(qrDataUrl, size);
}

/**
 * The ONE place a QR failure is handled.
 *
 * A QR is always an *extra* — every surface that draws one also shows the code or link it
 * encodes, so a render failure degrades rather than breaks. What it must never do is
 * degrade SILENTLY: `catch { qr = '' }` on a screen whose entire job is "scan this" leaves
 * a blank space and no signal anywhere, and that exact `catch` had been written twice
 * before this helper existed (`useMintedLink`, and `RecoveryKitDisplay`, which had no log
 * at all).
 *
 * Returns a discriminated result rather than throwing, because every caller's correct
 * response is the same: render the fallback and say the picture did not draw.
 */
export async function renderQr(
  source: string,
  ctx: { surface: string; kind: string }
): Promise<{ dataUrl: string } | { unavailable: true }> {
  try {
    return { dataUrl: await generateInviteQR(source) };
  } catch (e) {
    logEvent({
      level: 'warn',
      surface: ctx.surface,
      message: 'QR render failed; the code it encodes is still shown',
      context: { action: 'qr_render_failed', kind: ctx.kind },
      // Carry the cause. A "QR failed" line with no error is the same dead end as the
      // silent catch this replaced, just one step further along.
      error: e,
    });
    return { unavailable: true };
  }
}
