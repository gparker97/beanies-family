<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SyncStatusIndicator from '@/components/common/SyncStatusIndicator.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const syncStore = useSyncStore();

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
  navItemDefs.map((item) => ({
    name: t(item.labelKey),
    path: item.path,
    icon: item.icon,
  }))
);

const hoveredPath = ref('');

function isActive(path: string): boolean {
  return route.path === path;
}

function navigateTo(path: string) {
  router.push(path);
}
</script>

<template>
  <aside
    class="flex h-full w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
  >
    <!-- Logo & Branding -->
    <div class="border-b border-gray-200 py-1 pr-5 dark:border-slate-700">
      <div class="flex items-center gap-3">
        <!-- Logo -->
        <img
          src="/brand/beanies_logo_transparent_150x150.png"
          alt="beanies.family"
          class="h-24 w-24 flex-shrink-0"
        />
        <!-- Text -->
        <div class="-ml-5 min-w-0">
          <h1 class="font-outfit text-xl leading-tight font-bold">
            <span class="text-secondary-500 dark:text-gray-100">beanies</span
            ><span class="text-primary-500">.family</span>
          </h1>
          <p class="mt-0.5 text-xs font-medium tracking-wide text-gray-400 dark:text-gray-500">
            every bean counts
          </p>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      <button
        v-for="item in navItems"
        :key="item.path"
        class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
        :class="
          isActive(item.path)
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400 font-medium'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700'
        "
        @click="navigateTo(item.path)"
        @mouseenter="hoveredPath = item.path"
        @mouseleave="hoveredPath = ''"
      >
        <BeanieIcon
          :name="item.icon"
          size="md"
          :class="
            isActive(item.path)
              ? 'animate-beanie-glow'
              : hoveredPath === item.path
                ? 'animate-beanie-wobble'
                : 'opacity-70'
          "
        />

        <span>{{ item.name }}</span>
      </button>
    </nav>

    <!-- Data status & version -->
    <div class="border-t border-gray-200 px-4 py-3 dark:border-slate-700">
      <!-- File name -->
      <div v-if="syncStore.isConfigured && syncStore.fileName" class="mb-1 flex items-center gap-2">
        <div class="flex w-5 flex-shrink-0 justify-center">
          <SyncStatusIndicator />
        </div>
        <p
          class="truncate text-[10px] text-gray-400 dark:text-gray-500"
          :title="syncStore.fileName"
        >
          {{ syncStore.fileName }}
        </p>
      </div>
      <!-- Encryption / file status — always visible -->
      <div
        class="mb-2 flex items-center gap-2"
        :title="
          !syncStore.isConfigured
            ? 'No data file configured — data stored in browser only'
            : syncStore.isEncryptionEnabled
              ? 'Your data file is encrypted with AES-256-GCM'
              : 'Your data file is not encrypted — enable encryption in Settings'
        "
      >
        <div class="flex w-5 flex-shrink-0 justify-center">
          <BeanieIcon
            v-if="syncStore.isConfigured && syncStore.isEncryptionEnabled"
            name="lock"
            size="sm"
            class="text-emerald-500"
          />
          <BeanieIcon
            v-else-if="syncStore.isConfigured"
            name="unlock"
            size="sm"
            class="text-amber-500"
          />
          <BeanieIcon v-else name="file" size="sm" class="text-gray-400" />
        </div>
        <span
          class="truncate text-xs"
          :class="
            !syncStore.isConfigured
              ? 'text-gray-400 dark:text-gray-500'
              : syncStore.isEncryptionEnabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
          "
        >
          {{
            !syncStore.isConfigured
              ? 'No data file'
              : syncStore.isEncryptionEnabled
                ? 'Data encrypted'
                : 'Not encrypted'
          }}
        </span>
      </div>
      <!-- Version -->
      <p class="text-[10px] text-gray-400 dark:text-gray-500">v1.0.0 - MVP</p>
    </div>
  </aside>
</template>
