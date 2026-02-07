<script setup lang="ts">
import { computed } from 'vue';
import { getCategoryById } from '@/constants/categories';

const props = defineProps<{
  categoryId: string;
  size?: 'sm' | 'md' | 'lg';
}>();

const category = computed(() => getCategoryById(props.categoryId));

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'w-3.5 h-3.5';
    case 'lg': return 'w-5 h-5';
    default: return 'w-4 h-4';
  }
});

// Map icon names to SVG paths
const iconPaths: Record<string, string> = {
  // Employment
  'briefcase': 'M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 5h4v2h-4V5z',
  'code': 'M8 5l-5 7 5 7M16 5l5 7-5 7',

  // Investments
  'dollar-sign': 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  'trending-up': 'M23 6l-9.5 9.5-5-5L1 18',

  // Other Income
  'gift': 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z',
  'plus-circle': 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v8M8 12h8',
  'refresh': 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',

  // Property
  'home': 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',

  // Entertainment
  'film': 'M19.82 2H4.18A2.18 2.18 0 002 4.18v15.64A2.18 2.18 0 004.18 22h15.64A2.18 2.18 0 0022 19.82V4.18A2.18 2.18 0 0019.82 2zM7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5',
  'palette': 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.78-.13 2.61-.37l-1.26-3.78A4 4 0 1115 10.6l3.78 1.26c.25-.83.37-1.68.37-2.61C22 6.5 17.5 2 12 2zM12 14a2 2 0 110-4 2 2 0 010 4z',
  'repeat': 'M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3',

  // Family
  'users': 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  'book': 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
  'paw': 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',

  // Financial
  'credit-card': 'M1 5a2 2 0 012-2h18a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5zM1 10h22',
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'file-text': 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',

  // Food
  'coffee': 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3',
  'utensils': 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2v0a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
  'shopping-cart': 'M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6M9 22a1 1 0 100-2 1 1 0 000 2zM20 22a1 1 0 100-2 1 1 0 000 2z',

  // Housing
  'tool': 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  'zap': 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',

  // Other
  'heart-handshake': 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7 7-7zM12 5L9.04 7.96a2.5 2.5 0 000 3.54L12 14.5l2.96-2.96a2.5 2.5 0 000-3.54L12 5z',
  'more-horizontal': 'M12 12m-1 0a1 1 0 102 0 1 1 0 10-2 0M19 12m-1 0a1 1 0 102 0 1 1 0 10-2 0M5 12m-1 0a1 1 0 102 0 1 1 0 10-2 0',

  // Personal
  'shirt': 'M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z',
  'activity': 'M22 12h-4l-3 9L9 3l-3 9H2',
  'heart': 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',

  // Transportation
  'settings': 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z',
  'car': 'M16 6h2l3 6v5h-2M5 13h14M6 17h2M16 17h2M7 6h7l3 6H4l3-6zM4 13v5a1 1 0 001 1h1',
  'fuel': 'M3 22V5a2 2 0 012-2h8a2 2 0 012 2v17H3zM13 10h2a2 2 0 012 2v5M18 12h1a2 2 0 012 2v6M7 8h4M7 12h4',
  'train': 'M4 11V5a2 2 0 012-2h12a2 2 0 012 2v6M4 11h16M4 11v5a2 2 0 002 2h12a2 2 0 002-2v-5M7.5 15.5h.01M16.5 15.5h.01M9 21l-2-3M15 21l2-3',

  // Travel
  'airplane': 'M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z',
  'hotel': 'M18 2H6a2 2 0 00-2 2v16l8-4 8 4V4a2 2 0 00-2-2z',
};

// Icons that need stroke instead of fill
const strokeIcons = new Set([
  'code', 'dollar-sign', 'trending-up', 'gift', 'plus-circle', 'refresh', 'home',
  'film', 'repeat', 'users', 'book', 'paw', 'credit-card', 'shield', 'file-text',
  'coffee', 'utensils', 'shopping-cart', 'tool', 'zap', 'heart-handshake',
  'shirt', 'activity', 'heart', 'settings', 'car', 'fuel', 'train', 'airplane', 'hotel'
]);
</script>

<template>
  <span
    v-if="category"
    class="inline-flex items-center justify-center rounded"
    :class="sizeClasses"
    :style="{ color: category.color }"
    :title="category.name"
  >
    <svg
      v-if="iconPaths[category.icon]"
      :class="sizeClasses"
      fill="none"
      :stroke="strokeIcons.has(category.icon) ? 'currentColor' : 'none'"
      :fill-opacity="strokeIcons.has(category.icon) ? '0' : '1'"
      viewBox="0 0 24 24"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        :d="iconPaths[category.icon]"
        :fill="strokeIcons.has(category.icon) ? 'none' : 'currentColor'"
      />
    </svg>
    <!-- Fallback for unknown icons -->
    <svg v-else :class="sizeClasses" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
    </svg>
  </span>
</template>
