<script setup lang="ts">
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { getAccountTypeIcon } from '@/constants/icons';
import type { AccountType } from '@/types/models';

const props = defineProps<{
  type: AccountType;
  size?: 'sm' | 'md' | 'lg';
}>();

const BEANIE_SIZE_MAP = {
  sm: 'xs' as const,
  md: 'sm' as const,
  lg: 'md' as const,
};

const beanieSize = computed(() => BEANIE_SIZE_MAP[props.size || 'md']);
const config = computed(
  () => getAccountTypeIcon(props.type) || { color: '#6b7280', label: 'Other' }
);
</script>

<template>
  <span
    class="inline-flex items-center justify-center"
    :style="{ color: config.color }"
    :title="config.label"
  >
    <BeanieIcon :name="`account-${type}`" :size="beanieSize" />
  </span>
</template>
