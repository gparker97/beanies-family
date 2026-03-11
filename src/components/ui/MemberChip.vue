<script setup lang="ts">
import { computed } from 'vue';
import { useMemberInfo } from '@/composables/useMemberInfo';

const props = withDefaults(
  defineProps<{
    memberId: string;
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' }
);

const { getMemberName, getMemberColor } = useMemberInfo();

const name = computed(() => getMemberName(props.memberId));
const color = computed(() => getMemberColor(props.memberId));
</script>

<template>
  <span
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
