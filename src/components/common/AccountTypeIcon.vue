<script setup lang="ts">
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { getAccountTypeIcon } from '@/constants/icons';
import type { AccountType } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  type: AccountType;
  size?: 'sm' | 'md' | 'lg';
}>();

const { t } = useTranslation();

const BEANIE_SIZE_MAP = {
  sm: 'xs' as const,
  md: 'sm' as const,
  lg: 'md' as const,
};

const beanieSize = computed(() => BEANIE_SIZE_MAP[props.size || 'md']);
const config = computed(() => getAccountTypeIcon(props.type) || { color: '#6b7280' });
</script>

<template>
  <span
    class="inline-flex items-center justify-center"
    :style="{ color: config.color }"
    :title="t(('accounts.type.' + props.type) as UIStringKey)"
  >
    <BeanieIcon :name="`account-${type}`" :size="beanieSize" />
  </span>
</template>
