<script setup lang="ts">
/**
 * A list of tickable jobs that REORDERS smoothly.
 *
 * Jobs sort outstanding-first, so ticking one sends it to the bottom of its
 * column. Without a move transition that is a teleport — the row vanishes from
 * under the finger and reappears elsewhere, while the beans rise from the space
 * it just left. `<TransitionGroup>` gives Vue's FLIP treatment: the row glides,
 * and everything below it slides up to meet it.
 *
 * The move is DELAYED so the reward lands first. The eye follows the beans, the
 * strike sweeps, and only then does the list resettle — a sequence rather than
 * a scramble.
 *
 * One component rather than three TransitionGroups, so the board, the lanes and
 * the drill-in sheet cannot drift into three different reorder feels.
 */
import WallJobRow from '@/components/wall/WallJobRow.vue';
import type { WallJob } from '@/types/wall';

defineProps<{
  jobs: WallJob[];
  isPending: (job: WallJob) => boolean;
  /** Optional per-row owner label, for lists that mix people. */
  ownerLabel?: (job: WallJob) => string;
  /** That owner's colour, for the pill on a mixed list. */
  ownerColor?: (job: WallJob) => string | undefined;
}>();
const emit = defineEmits<{ toggle: [WallJob] }>();
</script>

<template>
  <TransitionGroup name="wall-job" tag="div" class="wall-job-list">
    <WallJobRow
      v-for="job in jobs"
      :key="job.key"
      :job="job"
      :pending="isPending(job)"
      :owner-label="ownerLabel?.(job)"
      :owner-color="ownerColor?.(job)"
      @toggle="emit('toggle', $event)"
    />
  </TransitionGroup>
</template>

<style scoped>
.wall-job-list {
  display: flex;
  flex-direction: column;
}

.wall-job-move {
  transition: transform 460ms cubic-bezier(0.22, 0.9, 0.28, 1) 160ms;
}

@media (prefers-reduced-motion: reduce) {
  .wall-job-move {
    transition: none;
  }
}
</style>
