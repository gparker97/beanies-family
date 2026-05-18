<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { LANGUAGES } from '@/constants/languages';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import type { LanguageCode } from '@/types/models';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const translationStore = useTranslationStore();
const showLangMenu = ref(false);

/**
 * Tagline split around the accent word ("bean") so the brand gradient can be
 * applied to that single word without putting HTML into the i18n value.
 * Renders verbatim with no accent if the translator drops the accent word.
 */
function taglineParts() {
  return splitAroundAccent(t('app.tagline'), t('app.taglineAccent'));
}

const currentLanguageInfo = computed(() =>
  LANGUAGES.find((l) => l.code === settingsStore.language)
);

async function selectLanguage(code: LanguageCode) {
  showLangMenu.value = false;
  if (code === settingsStore.language) return;
  await settingsStore.setLanguage(code);
  await translationStore.loadTranslations(code);
}
</script>

<template>
  <div
    class="dark:via-secondary-500 relative flex min-h-screen items-center justify-center bg-gradient-to-br from-[#F8F9FA] via-[#FEF0E8] to-[#EBF5FD] p-4 dark:from-[#1a252f] dark:to-[#1a252f]"
  >
    <!-- Language switcher -->
    <div class="absolute top-4 right-4 z-10">
      <button
        class="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm transition-colors hover:bg-white dark:bg-slate-800/80 dark:hover:bg-slate-800"
        @click="showLangMenu = !showLangMenu"
        @blur="showLangMenu = false"
      >
        <img
          v-if="currentLanguageInfo?.flagIcon"
          :src="currentLanguageInfo.flagIcon"
          :alt="currentLanguageInfo.name"
          class="h-4 w-5"
        />
        <span v-else class="text-sm">{{ currentLanguageInfo?.flag || '🌐' }}</span>
        <span class="text-xs text-gray-600 dark:text-gray-300">{{
          currentLanguageInfo?.nativeName
        }}</span>
        <span class="text-[0.5rem] text-gray-400">▼</span>
      </button>
      <div
        v-if="showLangMenu"
        class="absolute right-0 mt-1 w-40 rounded-xl bg-white p-1 shadow-lg dark:bg-slate-800"
      >
        <button
          v-for="lang in LANGUAGES"
          :key="lang.code"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            lang.code === settingsStore.language
              ? 'bg-primary-500/10 text-primary-500'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700'
          "
          @mousedown.prevent="selectLanguage(lang.code)"
        >
          <img v-if="lang.flagIcon" :src="lang.flagIcon" :alt="lang.name" class="h-4 w-5" />
          <span v-else>{{ lang.flag }}</span>
          <span>{{ lang.nativeName }}</span>
        </button>
      </div>
    </div>

    <div class="w-full max-w-[580px]">
      <div class="mb-8 text-center">
        <img
          src="/brand/beanies_celebrating_line_transparent_600x600.png"
          alt="beanies celebrating"
          class="mx-auto -mb-[7.5rem] w-full max-w-sm"
        />
        <h1 class="font-outfit text-5xl font-bold">
          <span class="text-secondary-500 dark:text-gray-100">beanies</span
          ><span class="text-primary-500">.family</span>
        </h1>
        <!-- Tagline: Outfit italic + tracked + lighter gray, with the single
             word "bean" rendered in the brand gradient (semibold). Echoes the
             gradient accent on "begin" in the welcome prompt below but lands
             on a different word position so the two highlights don't pattern-
             match. -->
        <p
          class="font-outfit mt-2 text-base font-normal tracking-[0.04em] text-gray-500 italic dark:text-gray-400"
        >
          <template v-for="(part, i) in [taglineParts()]" :key="i">
            {{ part.lead
            }}<span
              class="from-primary-500 to-terracotta-400 bg-gradient-to-r bg-clip-text font-semibold text-transparent"
              >{{ part.accent }}</span
            >{{ part.trail }}
          </template>
        </p>
      </div>

      <slot />

      <slot name="below-card" />
    </div>
  </div>
</template>
