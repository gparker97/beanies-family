/**
 * QR code generation for invite links.
 * Brand-themed: Heritage Orange dots with beanies logo overlay in the center.
 */

import QRCode from 'qrcode';

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
