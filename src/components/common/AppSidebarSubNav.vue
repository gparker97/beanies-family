<script setup lang="ts">
import type { NavSubItemDef } from '@/constants/navigation';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  items: NavSubItemDef[];
  activePath: string;
}>();

defineEmits<{
  navigate: [path: string];
}>();

const { t } = useTranslation();

/**
 * Match rule for sub-items: exact match wins for the parent-path entry
 * (e.g. /pod), while deeper sub-routes match themselves exactly. We
 * intentionally avoid prefix matching so /pod isn't highlighted when the
 * user is on /pod/cookbook.
 */
function isActive(path: string, activePath: string): boolean {
  return activePath === path;
}
</script>

<template>
  <div class="mt-0.5 ml-6 space-y-0.5 border-l border-white/[0.08] pl-2">
    <button
      v-for="sub in items"
      :key="sub.path"
      class="font-outfit group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-all duration-150"
      :class="
        isActive(sub.path, activePath)
          ? 'border-primary-500 border-l-2 bg-gradient-to-r from-[rgba(241,93,34,0.15)] to-[rgba(230,126,34,0.05)] pl-2 font-semibold text-white/90'
          : 'border-l-2 border-transparent text-white/30 hover:bg-white/[0.04] hover:text-white/60'
      "
      @click="$emit('navigate', sub.path)"
    >
      <span class="w-5 text-center text-sm">{{ sub.emoji }}</span>
      <span class="flex-1">{{ t(sub.labelKey) }}</span>
    </button>
  </div>
</template>
