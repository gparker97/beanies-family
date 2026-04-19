/**
 * Reactively resolve a `FamilyMember.avatarPhotoId` to a Drive thumbnail URL.
 *
 * Returns `null` when there's no avatar, during resolution, or on error —
 * callers pass the result straight to `<BeanieAvatar :photo-url="url" />`,
 * which falls back to the beanie variant.
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

  const resolvedId = computed<UUID | undefined>(() => {
    const v = avatarPhotoId;
    return typeof v === 'function' ? v() : unref(v);
  });

  watchEffect(async () => {
    const id = resolvedId.value;
    if (!id) {
      url.value = null;
      return;
    }
    try {
      url.value = await photoStore.getImageUrl(id, size);
    } catch (e) {
      console.warn('[avatarPhotoUrl] resolve failed', e);
      url.value = null;
    }
  });

  return url;
}
