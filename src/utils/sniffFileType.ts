// Decide what a file actually IS from its first bytes (#64).
//
// At the share boundary the declared MIME comes from another app — on Android it is whatever
// the sender's own ContentProvider reports — so trusting it means trusting an arbitrary
// third party about what we are about to send to the model. The inverse matters just as
// much: a provider that reports nothing gives `type: ''`, and a perfectly good JPEG would be
// rejected as unreadable on a technicality.
//
// Only the formats the readers actually accept are recognised. Anything else returns null,
// which the caller treats as "beanies cannot read that" — the honest answer.

/** Bytes needed to recognise every signature below. */
const SNIFF_BYTES = 16;

export type SniffedType =
  'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';

/**
 * Read the leading bytes and return the real type, or null when it is not something the
 * readers accept.
 *
 * HEIC/HEIF are deliberately NOT sniffed: their `ftyp` box shares a container with formats
 * we do not accept, and the in-app pickers already hand HEIC through by declared type on
 * iOS. A HEIC arriving with a correct declared type is handled by the caller's fallback.
 */
export async function sniffFileType(file: File): Promise<SniffedType | null> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  if (head.length < 4) return null;

  const startsWith = (...bytes: number[]): boolean => bytes.every((b, i) => head[i] === b);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'; // %PDF
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif'; // GIF8
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45) {
    return 'image/webp';
  }
  return null;
}
