<script setup lang="ts">
import { computed, ref } from 'vue';
import MemberFilterDropdown from '@/components/common/MemberFilterDropdown.vue';
import SyncStatusIndicator from '@/components/common/SyncStatusIndicator.vue';
import { DISPLAY_CURRENCIES, getCurrencyInfo } from '@/constants/currencies';
import { LANGUAGES, getLanguageInfo } from '@/constants/languages';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { CurrencyCode, LanguageCode } from '@/types/models';

const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const translationStore = useTranslationStore();

const currentMember = computed(() => familyStore.currentMember);
const showCurrencyDropdown = ref(false);
const showLanguageDropdown = ref(false);

const currencyOptions = DISPLAY_CURRENCIES.map((c) => ({
  code: c.code,
  label: `${c.code} - ${c.symbol}`,
  fullLabel: `${c.code} - ${c.name}`,
}));

const currentCurrencyInfo = computed(() => getCurrencyInfo(settingsStore.displayCurrency));
const currentLanguageInfo = computed(() => getLanguageInfo(settingsStore.language));

async function selectCurrency(code: CurrencyCode) {
  await settingsStore.setDisplayCurrency(code);
  showCurrencyDropdown.value = false;
}

async function selectLanguage(code: LanguageCode) {
  showLanguageDropdown.value = false;
  await settingsStore.setLanguage(code);
  await translationStore.loadTranslations(code);
}

function toggleTheme() {
  const newTheme = settingsStore.theme === 'dark' ? 'light' : 'dark';
  settingsStore.setTheme(newTheme);
}

function closeCurrencyDropdown() {
  showCurrencyDropdown.value = false;
}

function closeLanguageDropdown() {
  showLanguageDropdown.value = false;
}
</script>

<template>
  <header
    class="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-800"
  >
    <!-- Left side - Page title or breadcrumb -->
    <div>
      <slot name="left">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          <slot name="title" />
        </h2>
      </slot>
    </div>

    <!-- Right side - User actions -->
    <div class="flex items-center gap-4">
      <!-- Member Filter -->
      <MemberFilterDropdown />

      <!-- Currency selector -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
          @click="showCurrencyDropdown = !showCurrencyDropdown"
          @blur="closeCurrencyDropdown"
        >
          <span>{{ currentCurrencyInfo?.symbol || settingsStore.displayCurrency }}</span>
          <span class="text-gray-500 dark:text-gray-400">{{ settingsStore.displayCurrency }}</span>
          <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <!-- Dropdown menu -->
        <div
          v-if="showCurrencyDropdown"
          class="absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <button
            v-for="option in currencyOptions"
            :key="option.code"
            type="button"
            class="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
            :class="
              option.code === settingsStore.displayCurrency
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                : 'text-gray-700 dark:text-gray-300'
            "
            @mousedown.prevent="selectCurrency(option.code)"
          >
            {{ option.fullLabel }}
          </button>
        </div>
      </div>

      <!-- Language selector -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
          :class="{ 'opacity-75': translationStore.isLoading }"
          @click="showLanguageDropdown = !showLanguageDropdown"
          @blur="closeLanguageDropdown"
        >
          <span>{{ currentLanguageInfo?.flag || '🌐' }}</span>
          <span class="text-gray-500 dark:text-gray-400">{{
            settingsStore.language.toUpperCase()
          }}</span>
          <svg
            v-if="!translationStore.isLoading"
            class="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <svg
            v-else
            class="h-4 w-4 animate-spin text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        <!-- Dropdown menu -->
        <div
          v-if="showLanguageDropdown"
          class="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <button
            v-for="lang in LANGUAGES"
            :key="lang.code"
            type="button"
            class="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
            :class="
              lang.code === settingsStore.language
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                : 'text-gray-700 dark:text-gray-300'
            "
            @mousedown.prevent="selectLanguage(lang.code)"
          >
            {{ lang.flag }} {{ lang.nativeName }}
          </button>
        </div>
      </div>

      <!-- Sync status indicator -->
      <SyncStatusIndicator />

      <!-- Theme toggle -->
      <button
        type="button"
        class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-200"
        @click="toggleTheme"
      >
        <!-- Sun icon -->
        <svg
          v-if="settingsStore.theme === 'dark'"
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        <!-- Moon icon -->
        <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </button>

      <!-- Profile dropdown -->
      <div class="flex items-center gap-3">
        <div v-if="currentMember" class="flex items-center gap-2">
          <!-- Avatar -->
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white"
            :style="{ backgroundColor: currentMember.color || '#3b82f6' }"
          >
            {{ currentMember.name.charAt(0).toUpperCase() }}
          </div>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ currentMember.name }}
          </span>
        </div>
      </div>
    </div>
  </header>
</template>
