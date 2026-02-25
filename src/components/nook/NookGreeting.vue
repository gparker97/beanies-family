<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useFamilyStore } from '@/stores/familyStore';

const { t } = useTranslation();
const { isUnlocked, toggle } = usePrivacyMode();
const familyStore = useFamilyStore();

const memberName = computed(() => familyStore.currentMember?.name || '');

const greetingParts = computed(() => {
  const raw = t('nook.welcomeHome');
  const idx = raw.indexOf('{name}');
  if (idx === -1) return { before: raw, after: '' };
  return { before: raw.slice(0, idx), after: raw.slice(idx + 6) };
});

const todayDate = computed(() =>
  new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
);
</script>

<template>
  <div class="flex items-center justify-between">
    <!-- Left: Greeting -->
    <div>
      <h1
        class="font-outfit text-secondary-500 text-[1.5rem] leading-tight font-bold dark:text-gray-100"
      >
        {{ greetingParts.before }}<span class="text-primary-500">{{ memberName }}</span
        >{{ greetingParts.after }}
      </h1>
      <p class="text-secondary-500/40 mt-1 text-[0.8rem] dark:text-gray-400">
        {{ todayDate }} &middot; {{ t('nook.familyAtAGlance') }}
      </p>
    </div>

    <!-- Right: Icon buttons -->
    <div class="flex items-center gap-2">
      <!-- Notification bell -->
      <button
        type="button"
        class="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] bg-white shadow-sm transition-colors hover:bg-gray-50 dark:bg-slate-700 dark:shadow-none dark:hover:bg-slate-600"
      >
        <span class="text-base">🔔</span>
      </button>

      <!-- Privacy toggle -->
      <button
        type="button"
        class="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] bg-white shadow-sm transition-colors hover:bg-gray-50 dark:bg-slate-700 dark:shadow-none dark:hover:bg-slate-600"
        @click="toggle()"
      >
        <span class="text-base">{{ isUnlocked ? '👁️' : '🔒' }}</span>
      </button>
    </div>
  </div>
</template>
