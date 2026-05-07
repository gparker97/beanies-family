/**
 * Lightbox state controller for milestone photo viewing.
 *
 * **Module-level singleton** — same pattern as `useQuickAdd`. The state
 * (`isOpen`, `photoIds`) lives at module scope so any deeply-nested
 * component can call `openFor(m)` without prop-drilling, and the page
 * mounts a single `<PhotoViewer>` bound to that shared state.
 *
 * Used by every surface that renders milestones with photo thumbnails
 * (FamilyTimelinePage, BeanMilestonesTab, FamilyScrapbookPage spreads).
 * `openFor(m)` is a no-op when the milestone has no photos so callers
 * don't need to gate it themselves.
 */
import { ref } from 'vue';
import type { Milestone, UUID } from '@/types/models';

const isOpen = ref(false);
const photoIds = ref<UUID[]>([]);

function openFor(m: Milestone): void {
  const ids = m.photoIds ?? [];
  if (ids.length === 0) return;
  photoIds.value = [...ids];
  isOpen.value = true;
}

function close(): void {
  isOpen.value = false;
}

export function useMilestoneLightbox() {
  return { isOpen, photoIds, openFor, close };
}
