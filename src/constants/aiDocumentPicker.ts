import { isPdfFile } from '@/utils/pdfExtractionImages';
import { sniffFileType } from '@/utils/sniffFileType';

/**
 * `accept` string for the AI document-reader file pickers (the consent-gated
 * "read a photo / document" flows — both the activity/invite reader and the
 * travel/itinerary reader).
 *
 * - `image/*` (rather than a specific MIME list) lets the client compress
 *   whatever is picked to JPEG before extraction, so any browser-decodable image
 *   works.
 * - `application/pdf,.pdf` makes PDFs selectable on every platform (a bare MIME
 *   list with `heic/heif` can collapse the dialog filter and hide PDFs). Both
 *   readers rasterize a picked PDF's first page to an image client-side before
 *   sending — the extraction Lambda is image-only and never sees the PDF.
 *
 * CAMERA, by surface: in a desktop/mobile **web browser**, this mixed accept (no
 * `capture` attribute) still surfaces a "Take Photo / Camera" entry in the
 * browser's own chooser. But in the **native Capacitor WebView** the mixed
 * image+PDF accept routes straight to the system documents picker (SAF), which
 * has NO camera entry — the camera intent only appears for an image-only accept
 * or with `capture`. So the AI readers do NOT rely on this constant for the
 * camera on native: `AiDocumentPicker.vue` shows a Take-a-photo / Choose-a-file
 * chooser on touch-primary devices, with a dedicated image-only `capture` input
 * for the camera and THIS accept for the file path.
 */
export const AI_PICKER_ACCEPT = 'image/*,application/pdf,.pdf';

/**
 * Per-file size cap for anything entering the AI readers (#64, plan §6.2).
 *
 * The share boundary is exported to every app on the device, so a hostile or careless sender
 * can hand over an arbitrarily large file. Compression happens BEFORE this would matter for
 * the request body, but decoding a huge image is itself the expensive step, so the cap is
 * applied to the file as received rather than after the canvas work.
 */
export const AI_PICKER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Can beanies read this file? The ONE answer to that question (#64).
 *
 * Lives beside `AI_PICKER_ACCEPT` deliberately: the picker's `accept` string and the share
 * target's filter are the same policy, and a second MIME list somewhere else would drift.
 *
 * Decides from the file's own BYTES where it can, because at the share boundary the declared
 * type comes from another app's ContentProvider. Where the bytes match no signature we fall
 * back to the declared type — that is what keeps HEIC/HEIF working, since its container is
 * shared with formats we do not accept and cannot be sniffed safely.
 *
 * So this is NOT "never trust the sender": a file whose bytes match nothing is still accepted
 * on its claim alone. The bound that actually matters is downstream — nothing is persisted
 * without the user confirming it in a review modal, so a mislabelled file costs one failed
 * extraction, not a bad record.
 */
export async function isAiPickerAcceptedFile(file: File): Promise<boolean> {
  if (file.size === 0 || file.size > AI_PICKER_MAX_BYTES) return false;
  try {
    if (await sniffFileType(file)) return true;
  } catch {
    // An unreadable slice is itself a reason to distrust the file; fall through to the
    // declared type rather than treating a read failure as acceptance.
  }
  return file.type.startsWith('image/') || isPdfFile(file);
}
