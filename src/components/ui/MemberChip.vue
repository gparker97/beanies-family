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

const { getMemberById } = useMemberInfo();

/**
 * The chip is keyed on a member ID that may live inside an entity's
 * `assigneeIds` long after the member was removed (deletes don't rewrite
 * existing activities / todos — the orphaned ID is preserved so the
 * assignment is restored automatically if the member is ever un-archived).
 *
 * When the lookup fails, render nothing rather than a stale "Unknown"
 * pill with a generic gray fallback — every consumer that loops
 * `assigneeIds` then transparently skips orphaned entries instead of
 * needing its own filter pass.
 */
const member = computed(() => getMemberById(props.memberId));
const name = computed(() => member.value?.name ?? '');
const color = computed(() => member.value?.color ?? '');
const initial = computed(() => name.value.charAt(0).toUpperCase());
</script>

<template>
  <template v-if="member">
    <span
      v-if="size === 'dot'"
      class="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[0.5625rem] font-bold text-white ring-1 ring-white dark:ring-slate-800"
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
</template>
