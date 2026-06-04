/**
 * Single source of truth for discriminating attachment kinds.
 *
 * The `PhotoAttachment` record (src/types/models.ts) holds both images and
 * PDFs. Every image-vs-PDF branch in the app — the usePhotos accept test,
 * photoStore's compress-vs-passthrough, the media components, the viewer's
 * Replace-button visibility — MUST go through this helper rather than
 * re-deriving from a raw `mime` string scattered per-site. When a third kind
 * arrives, this is the only place to extend.
 */
import type { PhotoAttachment } from '@/types/models';

/** Alias so new (travel-facing) code can read honestly without renaming the storage type. */
export type Attachment = PhotoAttachment;

export type AttachmentKind = 'image' | 'pdf';

export const PDF_MIME = 'application/pdf';

/** Classify an attachment by its MIME type. Unknown/missing mime falls back to 'image'
 *  (the historical default — every pre-PDF attachment is an image). */
export function attachmentKind(a: Pick<PhotoAttachment, 'mime'>): AttachmentKind {
  return a.mime === PDF_MIME ? 'pdf' : 'image';
}

export function isPdf(a: Pick<PhotoAttachment, 'mime'>): boolean {
  return attachmentKind(a) === 'pdf';
}
