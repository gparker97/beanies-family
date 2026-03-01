<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { MOBILE_TAB_ITEMS } from '@/constants/navigation';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

const tabs = computed(() =>
  MOBILE_TAB_ITEMS.map((item) => ({
    label: t(item.labelKey),
    path: item.path,
    emoji: item.emoji,
    active: route.path === item.path,
  }))
);

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <nav
    class="fixed right-0 bottom-0 left-0 z-40 flex items-stretch border-t border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <button
      v-for="tab in tabs"
      :key="tab.path"
      type="button"
      class="flex min-h-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 transition-colors"
      :class="tab.active ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'"
      @click="navigateTo(tab.path)"
    >
      <!-- Active indicator dot -->
      <span v-if="tab.active" class="bg-primary-500 mb-0.5 h-1 w-1 rounded-full" />
      <span class="text-xl leading-none">{{ tab.emoji }}</span>
      <span class="text-[0.6rem] font-semibold">{{ tab.label }}</span>
    </button>
  </nav>
</template>
