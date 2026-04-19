/**
 * Reactively resolve a `FamilyMember.avatarPhotoId` to a displayable URL.
 *
 * Uses `photoStore.getBlobUrl` — authorized `alt=media` download turned
 * into a `blob:` URL via `URL.createObjectURL`. That path was picked
 * over the Drive `thumbnailLink` approach after repeated "photo fails
 * to load after a reload" reports: `lh3.googleusercontent.com` URLs
 * embed short-lived tokens that rotate well inside our cache TTL and
 * don't survive fresh `<img>` mounts. Blob URLs live in-process and
 * don't rotate, which is what we want for the small-number-of-photos
 * avatar surface.
 *
 * Tradeoff: full-size image download (no CDN-side resize), but avatar
 * files are compressed to 1024px at q=0.92 so they're typically <100KB.
 *
 * Returns `{ url, refresh }`. `refresh()` is wired to BeanieAvatar's
 * `@photo-error` — drops the cache + retries once. Most of the time
 * it's a no-op (blob URLs don't go bad) but it's there for the rare
 * case where Drive replaced the underlying file.
 */
import { computed, ref, watchEffect, unref, type MaybeRefOrGetter } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';
import type { UUID } from '@/types/models';

export function useAvatarPhotoUrl(avatarPhotoId: MaybeRefOrGetter<UUID | undefined>) {
  const photoStore = usePhotoStore();
  const url = ref<string | null>(null);
  let retriedForId: UUID | null = null;

  const resolvedId = computed<UUID | undefined>(() => {
    const v = avatarPhotoId;
    return typeof v === 'function' ? v() : unref(v);
  });

  async function resolve(id: UUID): Promise<void> {
    try {
      url.value = await photoStore.getBlobUrl(id);
    } catch (e) {
      console.warn('[avatarPhotoUrl] resolve failed', e);
      url.value = null;
    }
  }

  watchEffect(async () => {
    const id = resolvedId.value;
    if (!id) {
      url.value = null;
      retriedForId = null;
      return;
    }
    if (retriedForId && retriedForId !== id) retriedForId = null;
    await resolve(id);
  });

  async function refresh(): Promise<void> {
    const id = resolvedId.value;
    if (!id) return;
    if (retriedForId === id) return;
    retriedForId = id;
    photoStore.invalidateThumbCache(id);
    await resolve(id);
  }

  return { url, refresh };
}
