<script setup lang="ts">
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { getCategoryById } from '@/constants/categories';

interface Props {
  category: string;
  size?: 'sm' | 'md' | 'lg';
  showBackground?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  showBackground: true,
});

const categoryInfo = computed(() => getCategoryById(props.category));

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return { container: 'w-8 h-8', icon: 'sm' as const };
    case 'lg':
      return { container: 'w-12 h-12', icon: 'lg' as const };
    default:
      return { container: 'w-10 h-10', icon: 'md' as const };
  }
});

const iconColor = computed(() => categoryInfo.value?.color || '#6b7280');
const iconName = computed(() => categoryInfo.value?.icon || 'more-horizontal');
</script>

<template>
  <div
    :class="[
      sizeClasses.container,
      'flex flex-shrink-0 items-center justify-center rounded-lg',
      showBackground ? 'bg-opacity-15' : '',
    ]"
    :style="showBackground ? { backgroundColor: `${iconColor}20` } : {}"
  >
    <BeanieIcon :name="iconName" :size="sizeClasses.icon" :style="{ color: iconColor }" />
  </div>
</template>
