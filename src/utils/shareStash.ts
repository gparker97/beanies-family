// Read back the files a Web Share Target POST left in the Cache (#64).
//
// The service worker cannot hand a POST body to a page directly, so it stashes the files and
// redirects with an id. This reads that stash and DELETES it — a share is consumed exactly
// once, and a failed ingest must not leave someone else's document sitting in the cache.

import { sanitiseAttachmentBase } from './sanitiseFilename';
import type { SharedContent } from '@/services/share/types';

const SHARE_CACHE = 'beanies-share-target';

/**
 * Read the batch stashed under `id`, in the order it was shared, then remove every entry.
 *
 * Deletion happens even when a file fails to read, so a poison entry cannot wedge the cache.
 * Returns an empty array when the id is unknown (an expired or already-consumed share).
 */
export async function readAndClearShareStash(id: string): Promise<SharedContent> {
  if (!('caches' in globalThis)) return { files: [] };

  const cache = await caches.open(SHARE_CACHE);
  const keys = (await cache.keys()).filter((req) =>
    new URL(req.url).pathname.startsWith(`/__share/${id}/`)
  );

  // PARTITION before sorting. `stashIndex` parses the last path segment as a number, so the
  // `text` key yields NaN → 0, would sort in among the files, and would come back as a File
  // named "shared" at index 0. The unconditional delete below still covers every key.
  const textPath = `/__share/${id}/text`;
  const textKey = keys.find((req) => new URL(req.url).pathname === textPath);
  const fileKeys = keys.filter((req) => req !== textKey);
  // Restore the shared order: the SW keys entries by index.
  fileKeys.sort((a, b) => stashIndex(a.url) - stashIndex(b.url));

  const files: File[] = [];
  let text: string | undefined;
  try {
    if (textKey) {
      try {
        const res = await cache.match(textKey);
        if (res) text = await res.text();
      } catch (err) {
        console.warn('[share] could not read the stashed text; continuing without it', err);
      }
    }
    for (const key of fileKeys) {
      // PER ENTRY, not around the loop. With one shared try/catch, a single rejecting
      // `blob()` aborted the loop while the `finally` still deleted every entry — so the
      // readable files in that batch were destroyed along with the broken one, and the POST
      // body they came from is long gone. Skip the bad one and keep the rest.
      try {
        const res = await cache.match(key);
        if (!res) continue;
        const blob = await res.blob();
        const rawName = decodeURIComponent(res.headers.get('x-share-name') ?? 'shared');
        const type = res.headers.get('content-type') ?? '';
        const extension = rawName.includes('.') ? rawName.slice(rawName.lastIndexOf('.')) : '';
        const safeExtension = /^\.[a-zA-Z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '';
        // The name comes from whichever app shared it — bound it before it reaches storage.
        files.push(
          new File([blob], `${sanitiseAttachmentBase(rawName)}${safeExtension}`, { type })
        );
      } catch (err) {
        console.warn('[share] could not read one stashed document; skipping it', err);
      }
    }
  } finally {
    // Unconditional: read-then-delete, so a poison entry cannot be retried forever.
    await Promise.all(keys.map((key) => cache.delete(key).catch(() => undefined)));
  }
  return { files, text };
}

function stashIndex(url: string): number {
  const parsed = Number(new URL(url).pathname.split('/').pop());
  return Number.isFinite(parsed) ? parsed : 0;
}
