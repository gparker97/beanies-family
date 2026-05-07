<script setup lang="ts">
/**
 * Milestone thumbnail — the photo-or-emoji square shown next to a
 * milestone's title in lists, timelines, and any future cross-family
 * view.
 *
 * Behavior:
 *   - When the milestone has ≥1 photo, the root element is a button
 *     that emits `open-lightbox` on click (with `event.stopPropagation`
 *     so it doesn't fall through to a wrapping card click). Cursor is
 *     `zoom-in` and a subtle hover scale signals tap-to-enlarge.
 *   - With multiple photos, a small `+N` pip in the corner hints there
 *     are more inside the lightbox.
 *   - With no photos, the root is a plain `<div>` and clicks do
 *     nothing — the parent card's click still works normally.
 *
 * Styling fall-through: Vue's automatic class inheritance forwards
 * `class` to the root element, so callers can position the thumbnail
 * (e.g. `absolute top-1 left-...` + outline ring on the timeline)
 * without the component needing to know about layout context.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMilestonesStore } from '@/stores/milestonesStore';
import { usePhotoStore } from '@/stores/photoStore';
import { MILESTONE_CATEGORIES } from '@/constants/milestoneCategories';
import type { Milestone } from '@/types/models';

const props = withDefaults(
  defineProps<{
    milestone: Milestone;
    /** 'sm' = 48px (default); 'md' = 56–64px responsive. */
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' }
);

const emit = defineEmits<{
  /** Emitted only when the milestone actually has photos to show. */
  'open-lightbox': [];
}>();

const { t } = useTranslation();
const milestonesStore = useMilestonesStore();
const photoStore = usePhotoStore();

const photoCount = computed(() => props.milestone.photoIds?.length ?? 0);
const hasPhotos = computed(() => photoCount.value > 0);

const photoUrl = computed(() => {
  const id = props.milestone.photoIds?.[0];
  if (!id) return null;
  return photoStore.getPublicUrl(id, 'thumb');
});

const emoji = computed(() => {
  const safe = milestonesStore.safeCategoryFor(props.milestone);
  const cat = MILESTONE_CATEGORIES.find((c) => c.id === safe);
  return cat?.emoji ?? '\u{2728}';
});

// `sm` = 48px → 56px responsive (timeline rail).
// `md` = 56px → 64px responsive (per-bean card list).
const sizeClasses = computed(() =>
  props.size === 'md' ? 'h-14 w-14 sm:h-16 sm:w-16' : 'h-12 w-12 sm:h-14 sm:w-14'
);

function handleClick(e: MouseEvent): void {
  if (!hasPhotos.value) return;
  e.stopPropagation();
  emit('open-lightbox');
}
</script>

<template>
  <!-- Root element keeps no position class so callers can pass any
       layout context (`absolute` on the timeline rail, normal flow in
       the bean tab) without colliding with the component's own
       positioning. The inner wrapper provides the positioning context
       the multi-photo badge needs. -->
  <component
    :is="hasPhotos ? 'button' : 'div'"
    :type="hasPhotos ? 'button' : undefined"
    :aria-label="hasPhotos ? t('photos.viewer.open') : undefined"
    class="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_3px_10px_rgba(44,62,80,0.12)]"
    :class="[sizeClasses, hasPhotos ? 'cursor-zoom-in transition-transform hover:scale-105' : '']"
    @click="handleClick"
  >
    <span class="relative flex h-full w-full items-center justify-center">
      <img
        v-if="photoUrl"
        :src="photoUrl"
        referrerpolicy="no-referrer"
        alt=""
        loading="lazy"
        class="absolute inset-0 h-full w-full object-cover"
      />
      <span
        v-else
        class="flex h-full w-full items-center justify-center text-2xl sm:text-3xl"
        aria-hidden="true"
        :style="{ background: 'var(--tint-orange-8)' }"
      >
        {{ emoji }}
      </span>
      <span
        v-if="photoCount > 1"
        class="font-outfit pointer-events-none absolute right-1 bottom-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-black/65 px-1 text-[9px] font-bold text-white"
        aria-hidden="true"
      >
        +{{ photoCount - 1 }}
      </span>
    </span>
  </component>
</template>
