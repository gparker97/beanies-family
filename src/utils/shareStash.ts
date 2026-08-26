// Read back the files a Web Share Target POST left in the Cache (#64).
//
// The service worker cannot hand a POST body to a page directly, so it stashes the files and
// redirects with an id. This reads that stash and DELETES it — a share is consumed exactly
// once, and a failed ingest must not leave someone else's document sitting in the cache.

import { sanitiseAttachmentBase } from './sanitiseFilename';

const SHARE_CACHE = 'beanies-share-target';

/**
 * Read the batch stashed under `id`, in the order it was shared, then remove every entry.
 *
 * Deletion happens even when a file fails to read, so a poison entry cannot wedge the cache.
 * Returns an empty array when the id is unknown (an expired or already-consumed share).
 */
export async function readAndClearShareStash(id: string): Promise<File[]> {
  if (!('caches' in globalThis)) return [];

  const cache = await caches.open(SHARE_CACHE);
  const keys = (await cache.keys()).filter((req) =>
    new URL(req.url).pathname.startsWith(`/__share/${id}/`)
  );
  // Restore the shared order: the SW keys entries by index.
  keys.sort((a, b) => stashIndex(a.url) - stashIndex(b.url));

  const files: File[] = [];
  try {
    for (const key of keys) {
      const res = await cache.match(key);
      if (!res) continue;
      const blob = await res.blob();
      const rawName = decodeURIComponent(res.headers.get('x-share-name') ?? 'shared');
      const type = res.headers.get('content-type') ?? '';
      const extension = rawName.includes('.') ? rawName.slice(rawName.lastIndexOf('.')) : '';
      const safeExtension = /^\.[a-zA-Z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '';
      // The name comes from whichever app shared it — bound it before it reaches storage.
      files.push(new File([blob], `${sanitiseAttachmentBase(rawName)}${safeExtension}`, { type }));
    }
  } finally {
    // Unconditional: read-then-delete, so one unreadable entry cannot strand the rest.
    await Promise.all(keys.map((key) => cache.delete(key)));
  }
  return files;
}

function stashIndex(url: string): number {
  const parsed = Number(new URL(url).pathname.split('/').pop());
  return Number.isFinite(parsed) ? parsed : 0;
}
