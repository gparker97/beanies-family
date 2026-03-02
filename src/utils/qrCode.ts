/**
 * QR code generation for invite links.
 * Uses brand colors: Deep Slate dots on white background.
 */

import QRCode from 'qrcode';

/** Generate a PNG data-URL QR code for an invite link. */
export async function generateInviteQR(inviteUrl: string): Promise<string> {
  return QRCode.toDataURL(inviteUrl, {
    width: 256,
    margin: 2,
    color: {
      dark: '#2C3E50', // Deep Slate
      light: '#FFFFFF',
    },
  });
}
