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
