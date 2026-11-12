<script setup lang="ts">
/**
 * The error boundary around the sleep slideshow (#140), and nothing else.
 *
 * The night overlay is the only way to wake the wall, so a throw anywhere in the slideshow
 * (setup included, which is why `useWallSlideshow` runs in the child stage) must never take
 * it down. The boundary is scoped here, not on the page, where it would swallow errors from
 * every wall view. On a throw it reports, stops rendering the stage for the rest of its
 * life, tells the page to use the plain night layout, and returns false.
 */
import { onErrorCaptured, ref } from 'vue';
import WallMemoryStage from '@/components/wall/WallMemoryStage.vue';
import { reportError } from '@/utils/errorReporter';
import type { SlideshowFrame } from '@/utils/wallSlideshow';

defineProps<{
  /** The wall is in portrait (`.wall-portrait`): passed to the stage's frame. */
  portrait?: boolean;
}>();
const emit = defineEmits<{ layout: [layout: SlideshowFrame['layout']] }>();

const failed = ref(false);

onErrorCaptured((error, _instance, info) => {
  // A stage whose setup threw can still be rendered once, half-built: that second error is
  // the same fault, so one report per night.
  if (failed.value) return false;
  reportError({
    surface: 'wall-slideshow',
    message: 'slideshow stage threw; the night face is plain for the rest of the night',
    severity: 'error',
    error,
    context: { detail: info },
  });
  failed.value = true;
  emit('layout', 'plain');
  return false;
});
</script>

<template>
  <WallMemoryStage v-if="!failed" :portrait="portrait" @layout="emit('layout', $event)" />
</template>
