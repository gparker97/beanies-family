/**
 * `accept` string for the AI document-reader file pickers (the consent-gated
 * "read a photo / document" flows — both the activity/invite reader and the
 * travel/itinerary reader).
 *
 * - `image/*` (rather than a specific MIME list) reliably surfaces the
 *   "Take Photo / Camera" entry in the mobile file chooser, and the client
 *   compresses whatever is picked to JPEG before extraction, so any
 *   browser-decodable image works.
 * - `application/pdf,.pdf` makes PDFs selectable on every platform (a bare MIME
 *   list with `heic/heif` can collapse the dialog filter and hide PDFs). Both
 *   readers rasterize a picked PDF's first page to an image client-side before
 *   sending — the extraction Lambda is image-only and never sees the PDF.
 *
 * Neither picker sets the input's `capture` attribute, so the camera is offered
 * as an OPTION in the chooser rather than forced open (which would hide the file
 * browser, and with it PDFs).
 */
export const AI_PICKER_ACCEPT = 'image/*,application/pdf,.pdf';
