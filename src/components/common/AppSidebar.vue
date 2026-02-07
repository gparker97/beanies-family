<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  icon: string;
}

const navItemDefs: NavItemDef[] = [
  { labelKey: 'nav.dashboard', path: '/dashboard', icon: 'home' },
  { labelKey: 'nav.accounts', path: '/accounts', icon: 'credit-card' },
  { labelKey: 'nav.transactions', path: '/transactions', icon: 'arrow-right-left' },
  { labelKey: 'nav.assets', path: '/assets', icon: 'building' },
  { labelKey: 'nav.goals', path: '/goals', icon: 'target' },
  { labelKey: 'nav.reports', path: '/reports', icon: 'chart-bar' },
  { labelKey: 'nav.forecast', path: '/forecast', icon: 'trending-up' },
  { labelKey: 'nav.family', path: '/family', icon: 'users' },
  { labelKey: 'nav.settings', path: '/settings', icon: 'cog' },
];

const navItems = computed(() =>
  navItemDefs.map(item => ({
    name: t(item.labelKey),
    path: item.path,
    icon: item.icon,
  }))
);

function isActive(path: string): boolean {
  return route.path === path;
}

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <aside class="w-64 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 min-h-screen flex flex-col">
    <!-- Logo -->
    <div class="px-6 py-5 border-b border-gray-200 dark:border-slate-700">
      <h1 class="text-xl font-bold text-blue-600 dark:text-blue-400">
        {{ t('app.name') }}
      </h1>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {{ t('app.tagline') }}
      </p>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <button
        v-for="item in navItems"
        :key="item.path"
        class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
        :class="
          isActive(item.path)
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700'
        "
        @click="navigateTo(item.path)"
      >
        <!-- Icon placeholder - using simple shapes -->
        <span
          class="w-5 h-5 flex items-center justify-center text-current opacity-70"
        >
          <svg
            v-if="item.icon === 'home'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'credit-card'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'arrow-right-left'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'building'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'target'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'chart-bar'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'trending-up'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'users'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          <svg
            v-else-if="item.icon === 'cog'"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </span>

        <span>{{ item.name }}</span>
      </button>
    </nav>

    <!-- Version info -->
    <div class="px-6 py-3 border-t border-gray-200 dark:border-slate-700">
      <p class="text-xs text-gray-400 dark:text-gray-500">
        v1.0.0 - MVP
      </p>
    </div>
  </aside>
</template>
