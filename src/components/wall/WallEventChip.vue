<script setup lang="ts">
/** Presentational: one event, coloured by whose it is. No store imports. */
import { computed } from 'vue';
import type { FamilyActivity } from '@/types/models';

const props = defineProps<{ activity: FamilyActivity; colour: string; time: string }>();
defineEmits<{ open: [] }>();
const isAllDay = computed(() => !props.activity.startTime);
</script>

<template>
  <button
    type="button"
    class="wall-chip shrink-0 rounded-xl border-l-[5px] px-2.5 py-1.5 text-left"
    :class="isAllDay ? 'bg-[var(--tint-orange-8)]' : 'bg-[var(--tint-slate-5)]'"
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
