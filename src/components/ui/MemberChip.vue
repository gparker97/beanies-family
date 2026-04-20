<script setup lang="ts">
import { computed } from 'vue';
import { useMemberInfo } from '@/composables/useMemberInfo';

// 'dot' — 16px colored circle with a single initial. Use in cramped
// contexts (lane-packed timeline cards, tablet-width calendar columns)
// where full-name pills would wrap or overflow.
// 'sm'  — compact name pill for inline labels and dense grids.
// 'md'  — gradient pill used on hero rows / filter chips where readability
// trumps density.
const props = withDefaults(
  defineProps<{
    memberId: string;
    size?: 'dot' | 'sm' | 'md';
  }>(),
  { size: 'sm' }
);

const { getMemberName, getMemberColor } = useMemberInfo();

const name = computed(() => getMemberName(props.memberId));
const color = computed(() => getMemberColor(props.memberId));
const initial = computed(() => name.value.charAt(0).toUpperCase());
</script>

<template>
  <span
    v-if="size === 'dot'"
    class="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-1 ring-white dark:ring-slate-800"
    :style="{ backgroundColor: color }"
    :title="name"
    :aria-label="name"
  >
    {{ initial }}
  </span>
  <span
    v-else
    class="inline-flex items-center text-xs font-medium text-white"
    :class="
      size === 'sm'
        ? 'rounded-full px-2 py-0.5'
        : 'font-outfit rounded-full px-3 py-1.5 font-semibold'
    "
    :style="{
      background: size === 'sm' ? color : `linear-gradient(135deg, ${color}, ${color}cc)`,
    }"
  >
    {{ name }}
  </span>
</template>
