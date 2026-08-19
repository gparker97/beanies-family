/**
 * Read a Blob as a base64 `data:` URL. The single shared implementation — used
 * by the sheet export (PDF embedding) and the AI document-extraction image
 * payload. Rejects with the underlying `FileReader` error (callers may wrap it
 * in a domain-specific error).
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
