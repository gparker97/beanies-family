<script setup lang="ts">
/**
 * Presentational: one event, coloured by whose it is. No store imports.
 *
 * It takes a resolved `identity` rather than deriving one, for the same reason
 * `ActivityOwnerStack` does: the rule is written once in `useActivityIdentity`,
 * and the parent has already computed it to lay the chip out. Deriving here
 * would classify per chip per render and could disagree with its own parent.
 */
import { computed } from 'vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import type { ActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';

const props = defineProps<{
  activity: FamilyActivity;
  identity: ActivityIdentity;
  time: string;
}>();
defineEmits<{ open: [] }>();

const isAllDay = computed(() => !props.activity.startTime);
</script>

<template>
  <button
    type="button"
    class="wall-chip flex shrink-0 items-center gap-2 rounded-xl border-l-[5px] px-2.5 py-1.5 text-left"
    :class="identity.dashed ? 'border-dashed' : ''"
    :style="identity.style"
    @click="$emit('open')"
  >
    <span class="min-w-0 flex-1">
      <span class="font-inter wall-chip-time block font-semibold text-[var(--muted-text,#4d5d6c)]">
        <!--
          The category glyph, which used to be carried by hue. Kept beside the time
          rather than the title so a long title still truncates against the same edge.
        -->
        <span aria-hidden="true">{{ identity.emoji }}</span>
        {{ time }}
        <span v-if="isAllDay" class="sr-only">{{ activity.title }}</span>
      </span>
      <span
        class="font-outfit text-secondary-500 wall-chip-title block truncate leading-tight font-semibold dark:text-gray-100"
      >
        {{ activity.title }}
      </span>
    </span>
    <!--
      Right-anchored, so the title's left edge is identical on every chip regardless of
      how many beans are on it. In a bean LANE this is empty for a solo event — the lane
      header already names that bean — so a face here always means "someone else too".
    -->
    <ActivityOwnerStack :members="identity.stackMembers" size="xs" />
  </button>
</template>
