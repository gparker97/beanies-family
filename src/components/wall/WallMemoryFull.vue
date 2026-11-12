<script setup lang="ts">
/**
 * The full-screen frame's overlay (#140): a scrim under the bottom edge so the clock and
 * caption read over any photo, the caption bottom-right in Caveat, and up to two pins (a
 * saying or note taped in) in the top corners. The photo itself is the stage's tile.
 *
 * Pins are keyed by slot and entry and the caption by its photo, so only what changed fades.
 */
import WallMemoryNote from '@/components/wall/WallMemoryNote.vue';
import { SLOT_DRIFT_DELAY_S, slotHasTape } from '@/utils/wallSlideshowSlots';
import type { PinSlotId, Placed, SlidePhoto, SlideText } from '@/utils/wallSlideshow';

defineProps<{ photo: SlidePhoto; pins: Placed<SlideText, PinSlotId>[]; reduced: boolean }>();
</script>

<template>
  <div class="mem-full">
    <div class="mem-scrim" />
    <TransitionGroup name="wall-mem-fade" :css="!reduced">
      <div
        v-for="{ slot, piece } in pins"
        :key="`${slot}:${piece.entry.id}`"
        class="mem-pin wall-fl"
        :class="`mem-${slot}`"
        :style="{ animationDelay: `${SLOT_DRIFT_DELAY_S[slot]}s` }"
      >
        <WallMemoryNote :piece="piece" :tape="slotHasTape(slot)" size="pin" />
      </div>
      <p
        v-if="photo.caption"
        :key="`cap:${photo.photoId}`"
        class="mem-full-cap font-caveat wall-memory-full-cap"
      >
        {{ photo.caption }}
      </p>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.mem-full {
  inset: 0;
  position: absolute;
}

.mem-scrim {
  background: linear-gradient(
    to top,
    rgb(9 14 20 / 88%) 0%,
    rgb(9 14 20 / 30%) 38%,
    transparent 62%
  );
  inset: 0;
  position: absolute;
}

/* Pins sit a little brighter than the photo, as in the mockup (level + 0.2, capped at 1). */
.mem-pin {
  filter: saturate(var(--mem-sat, 0.85));
  opacity: min(1, calc(var(--mem-opacity, 0.62) + 0.2));
  position: absolute;
  z-index: 2;
}

.mem-pin1 {
  right: 3.5%;
  rotate: 3deg;
  top: 7%;
  width: 23%;
}

.mem-pin2 {
  left: 3.5%;
  rotate: -3deg;
  top: 8%;
  width: 21%;
}

/* A portrait wall is narrow: the landscape widths gave a pin ~125 px and a word per line. */
.wall-portrait .mem-pin1 {
  width: 34%;
}

.wall-portrait .mem-pin2 {
  width: 32%;
}

.mem-full-cap {
  bottom: 2.2rem;
  color: #e7edf3;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
  max-width: 45%;
  position: absolute;
  right: 2.4rem;
  text-align: right;
  z-index: 2;
}
</style>
