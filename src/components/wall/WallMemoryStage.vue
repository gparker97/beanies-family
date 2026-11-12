<script setup lang="ts">
/**
 * The sleeping wall's memories (#140): runs `useWallSlideshow`, mounts every deck photo
 * ONCE for the whole night and shows the frame's pieces over the dark night face.
 *
 * One `<img>` per deck photo, keyed on `photoId:renderKey` (a retry remounts one, nothing
 * else does), never `loading="lazy"`: rotation only moves opacity, so it issues no request,
 * which is what lets the wall run offline overnight. The photo tiles are persistent and
 * take a slot from the frame; above them, each paper piece is keyed by its own slot and entry,
 * so a rotation fades only the pieces that changed and every other piece stays as it is.
 *
 * Everything here is `pointer-events: none` and hidden from assistive tech: the night
 * overlay underneath is the tap-to-wake target.
 */
import { computed, watch } from 'vue';
import WallMemoryAround from '@/components/wall/WallMemoryAround.vue';
import WallMemoryFull from '@/components/wall/WallMemoryFull.vue';
import WallMemoryPhoto from '@/components/wall/WallMemoryPhoto.vue';
import './wallMemorySlots.css';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useWallSlideshow } from '@/composables/useWallSlideshow';
import type { UUID } from '@/types/models';
import type { PhotoSlotId, SlideshowFrame } from '@/utils/wallSlideshow';

const props = defineProps<{
  /** The wall is in portrait (`.wall-portrait`), so the frame has four slots, not seven. */
  portrait?: boolean;
}>();
const emit = defineEmits<{ layout: [layout: SlideshowFrame['layout']] }>();

const { frame, deck, images, brightness } = useWallSlideshow({
  shape: () => (props.portrait ? 'portrait' : 'landscape'),
});
const { prefersReducedMotion } = useReducedMotion();

watch(
  () => frame.value.layout,
  (layout) => emit('layout', layout),
  { immediate: true }
);

/** Where each deck photo sits in this frame, with the caption to show. */
const placed = computed(() => {
  const map = new Map<UUID, { slot: PhotoSlotId; caption?: string }>();
  const f = frame.value;
  if (f.layout === 'full') {
    map.set(f.photo.photoId, { slot: 'full', caption: f.photo.caption });
  } else if (f.layout === 'around') {
    for (const { slot, piece } of f.photos)
      map.set(piece.photoId, { slot, caption: piece.caption });
  }
  return map;
});

const style = computed(() => ({
  '--mem-opacity': String(brightness.value.opacity),
  '--mem-sat': String(brightness.value.saturation),
}));
</script>

<template>
  <div class="mem-stage" :style="style" aria-hidden="true">
    <div class="mem-photos">
      <WallMemoryPhoto
        v-for="d in deck"
        :key="`${d.photoId}:${d.renderKey}`"
        :url="d.url"
        :place="placed.get(d.photoId)?.slot ?? null"
        :caption="placed.get(d.photoId)?.caption"
        :reduced="prefersReducedMotion"
        @load="images.onLoad(d.photoId, $event)"
        @error="images.onError(d.photoId)"
      />
    </div>
    <!-- Keyed by layout only: inside each, the pieces fade one by one (TransitionGroup). -->
    <Transition name="wall-mem-fade" :css="!prefersReducedMotion">
      <WallMemoryAround
        v-if="frame.layout === 'around'"
        key="around"
        :texts="frame.texts"
        :reduced="prefersReducedMotion"
      />
      <WallMemoryFull
        v-else-if="frame.layout === 'full'"
        key="full"
        :photo="frame.photo"
        :pins="frame.pins"
        :reduced="prefersReducedMotion"
      />
    </Transition>
  </div>
</template>

<style scoped>
.mem-stage {
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
}

/* Brightness applies to the photos as one layer, like the mockup's .mem. */
.mem-photos {
  filter: saturate(var(--mem-sat, 0.85));
  inset: 0;
  opacity: var(--mem-opacity, 0.62);
  position: absolute;
}
</style>
