// base64 → File, for documents handed over by a native share target (#64).
//
// The name is sanitised at THIS boundary because it originates in another app and flows on
// into `new File()` and, after the user confirms, into storage.

import { sanitiseAttachmentBase } from './sanitiseFilename';

/**
 * Decode a base64 payload into a `File`.
 *
 * `type` is the sender's CLAIM and is carried only so the browser has something to report;
 * whether beanies will actually read this file is decided from the resolved file by
 * `isAiPickerAcceptedFile`, never from here.
 */
export function base64ToFile(base64: string, name: string, type: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const safeName = `${sanitiseAttachmentBase(name)}${sanitiseExtension(extension)}`;
  return new File([bytes], safeName, { type });
}

/** Keep a short, alphanumeric extension or drop it entirely. */
function sanitiseExtension(extension: string): string {
  return /^\.[a-zA-Z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '';
}
