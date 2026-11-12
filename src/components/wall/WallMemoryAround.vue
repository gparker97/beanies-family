<script setup lang="ts">
/**
 * The "around the clock" frame's paper pieces (#140): text memories in the note slots, and
 * in any photo slot a text holds (no photo could take it). The photos themselves are the
 * stage's tiles, positioned by the same slot geometry (`WallMemoryPhoto`).
 *
 * Each piece is keyed by its slot AND its entry, so a rotation that changes one slot fades
 * that piece alone; every other piece keeps its element, its fade and its drift. The drift
 * phase follows the slot, never how many pieces are showing.
 */
import WallMemoryNote from '@/components/wall/WallMemoryNote.vue';
import { SLOT_DRIFT_DELAY_S, slotHasTape } from '@/utils/wallSlideshowSlots';
import type { NoteSlotId, Placed, SlideText, TileSlotId } from '@/utils/wallSlideshow';

defineProps<{ texts: Placed<SlideText, TileSlotId | NoteSlotId>[]; reduced: boolean }>();
</script>

<template>
  <div class="mem-around">
    <TransitionGroup name="wall-mem-fade" :css="!reduced">
      <div
        v-for="{ slot, piece } in texts"
        :key="`${slot}:${piece.entry.id}`"
        class="mem-slot wall-fl"
        :class="`wall-mem-${slot}`"
        :style="{ animationDelay: `${SLOT_DRIFT_DELAY_S[slot]}s` }"
      >
        <WallMemoryNote :piece="piece" :tape="slotHasTape(slot)" />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.mem-around {
  filter: saturate(var(--mem-sat, 0.85));
  inset: 0;
  opacity: var(--mem-opacity, 0.62);
  position: absolute;
}

/* The layer's own fade (the stage's `wall-mem-fade`): the scoped opacity above outranks the
   shared fade classes, so without this the layer popped in and out instead of fading. */
.mem-around.wall-mem-fade-enter-from,
.mem-around.wall-mem-fade-leave-to {
  opacity: 0;
}

.mem-slot {
  position: absolute;
}
</style>
