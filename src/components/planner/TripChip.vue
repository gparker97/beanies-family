<script setup lang="ts">
/**
 * Trip adapter over the generic `AllDayChip` (#141), alongside `HolidayChip` and
 * `BirthdayChip`. The month grid's lane, a cell's stack and every day list draw a trip
 * through it, so a trip is one bar treatment app-wide (`AllDayChip`'s rounding on the
 * true ends and its 2px start edge), not a hand-rolled band per surface.
 *
 * Ink and edge are `--trip-ink` (Deep Slate on light, the Sky Silk lift on dark) over
 * `--tint-silk-30`, both themed in `style.css`. The emoji comes from data
 * (`tripTypeEmoji`, via `CellVacation.emoji`). Travellers are resolved from the roster
 * with `membersByIds`; `solo` is never set, because a trip is not a "solo chip".
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { membersByIds } from '@/utils/assignees';
import type { CellVacation } from '@/utils/monthCells';
import AllDayChip from '@/components/planner/AllDayChip.vue';

interface Props {
  vacation: CellVacation;
  /** First cell of the run (the trip's true first day). */
  isStart: boolean;
  /** Last cell of the run (the trip's true last day). */
  isEnd: boolean;
  /** Draw the name. Unset = follow `isStart` (AllDayChip's tri-state). */
  showLabel?: boolean;
}
const props = withDefaults(defineProps<Props>(), { showLabel: undefined });
// The native event passes through, so a parent's `@click.stop` works.
const emit = defineEmits<{ click: [event: MouseEvent] }>();

const familyStore = useFamilyStore();
const travellers = computed(() => membersByIds(familyStore.members, props.vacation.travellerIds));
</script>

<template>
  <AllDayChip
    :title="vacation.name"
    color="var(--trip-ink)"
    bg-color="var(--tint-silk-30)"
    :leading-emoji="vacation.emoji"
    :is-start="isStart"
    :is-end="isEnd"
    :show-label="showLabel"
    :faces="travellers"
    testid="trip-chip"
    @click="(e: MouseEvent) => emit('click', e)"
  />
</template>
