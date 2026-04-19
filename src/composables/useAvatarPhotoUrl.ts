/**
 * Reactively resolve a `FamilyMember.avatarPhotoId` to a Drive thumbnail URL.
 *
 * Returns `null` when there's no avatar, during resolution, or on error —
 * callers pass the result straight to `<BeanieAvatar :photo-url="url" />`,
 * which falls back to the beanie variant.
 *
 * Also exposes `refresh()`: invalidates the photoStore thumb-URL cache and
 * re-resolves. Intended for the `@photo-error` event flow — Drive CDN
 * tokens can rotate within our 30-min cache TTL, and a fresh fetch often
 * yields a working URL. We retry at most once per mount to avoid loops.
 *
 * Used by BeanCard (grid), BeanAvatarPicker (modal preview), and any
 * future surface that displays member avatars.
 */
import { computed, ref, watchEffect, unref, type MaybeRefOrGetter } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';
import type { UUID } from '@/types/models';

export function useAvatarPhotoUrl(
  avatarPhotoId: MaybeRefOrGetter<UUID | undefined>,
  size: 'thumb' | 'full' = 'thumb'
) {
  const photoStore = usePhotoStore();
  const url = ref<string | null>(null);
  let retriedForId: UUID | null = null;

  const resolvedId = computed<UUID | undefined>(() => {
    const v = avatarPhotoId;
    return typeof v === 'function' ? v() : unref(v);
  });

  async function resolve(id: UUID): Promise<void> {
    try {
      url.value = await photoStore.getImageUrl(id, size);
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
    // Reset retry budget when the id changes.
    if (retriedForId && retriedForId !== id) retriedForId = null;
    await resolve(id);
  });

  /**
   * Call when an `<img>` error fires on the current URL — drops the cache
   * for this driveFileId and re-resolves. No-op after one retry (so an
   * actually-broken photo doesn't loop).
   */
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
