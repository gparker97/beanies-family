<script setup lang="ts">
/** Presentational: one event, coloured by whose it is. No store imports. */
import { computed } from 'vue';
import { isSharedEvent } from '@/utils/assignees';
import type { FamilyActivity, FamilyMember } from '@/types/models';

const props = defineProps<{
  activity: FamilyActivity;
  colour: string;
  time: string;
  /**
   * The roster, so an assignee id can be told from a person. Passed in rather than read
   * from a store because this component is presentational — and it is the SAME map the
   * parent already built for `wallActivityColour`, so the chip's border and its colour
   * cannot disagree about whether an event is shared.
   */
  membersById: Map<string, FamilyMember>;
}>();
defineEmits<{ open: [] }>();
const isAllDay = computed(() => !props.activity.startTime);

/**
 * A shared event needs to read as "one thing that concerns more than one of us" rather
 * than as a separate personal obligation in each lane. The colour already differs (never a
 * member hue); the dashed edge carries the same meaning independently of hue, which
 * matters at three metres and for anyone who cannot rely on colour alone.
 *
 * Counted over resolvable members, not raw ids: an `assigneeIds` that still carries a
 * removed member, a pet, or a duplicate from a merge is not a second owner.
 */
const isShared = computed(() => isSharedEvent(props.activity, (id) => props.membersById.has(id)));
</script>

<template>
  <button
    type="button"
    class="wall-chip shrink-0 rounded-xl border-l-[5px] px-2.5 py-1.5 text-left"
    :class="[
      isAllDay ? 'bg-[var(--tint-orange-8)]' : 'bg-[var(--tint-slate-5)]',
      isShared ? 'border-dashed' : '',
    ]"
    :style="{ borderLeftColor: colour }"
    @click="$emit('open')"
  >
    <span class="font-inter wall-chip-time block font-semibold text-[var(--muted-text,#4d5d6c)]">
      {{ time }}
    </span>
    <span
      class="font-outfit text-secondary-500 wall-chip-title block leading-tight font-semibold dark:text-gray-100"
    >
      {{ activity.title }}
    </span>
  </button>
</template>
