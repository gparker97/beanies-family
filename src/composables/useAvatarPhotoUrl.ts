/**
 * Reactively resolve a `FamilyMember.avatarPhotoId` to a displayable URL.
 *
 * Uses `photoStore.getPublicUrl` — direct Drive CDN URL backed by the
 * anyone-with-link grant every photo upload installs (ADR-021). No
 * OAuth fetch, no blob caching, no token rotation to worry about.
 *
 * Returns `{ url, refresh }`. `refresh()` is wired to BeanieAvatar's
 * `@photo-error` — if the `<img>` fires onerror (usually a genuinely
 * deleted Drive file), we mark the photo unresolved so future resolves
 * return null and downstream UI can show a fallback.
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

  watchEffect(() => {
    const id = resolvedId.value;
    if (!id) {
      url.value = null;
      retriedForId = null;
      return;
    }
    if (retriedForId && retriedForId !== id) retriedForId = null;
    url.value = photoStore.getPublicUrl(id, 'thumb');
  });

  function refresh(): void {
    const id = resolvedId.value;
    if (!id) return;
    if (retriedForId === id) {
      // Second failure — flag as genuinely broken so future callers
      // see the null-URL state.
      photoStore.markUnresolved(id);
      url.value = null;
      console.warn('[avatarPhotoUrl] image failed twice — marking unresolved', id);
      return;
    }
    retriedForId = id;
    // Re-read the same URL; `<img>` may have hit a transient Drive
    // hiccup on first paint.
    url.value = photoStore.getPublicUrl(id, 'thumb');
  }

  return { url, refresh };
}
