<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { LANGUAGES } from '@/constants/languages';
import type { LanguageCode } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const settingsStore = useSettingsStore();
const translationStore = useTranslationStore();

const showAbout = ref(false);
const showLangMenu = ref(false);

const currentLanguageInfo = computed(() =>
  LANGUAGES.find((l) => l.code === settingsStore.language)
);

async function selectLanguage(code: LanguageCode) {
  showLangMenu.value = false;
  if (code === settingsStore.language) return;
  await settingsStore.setLanguage(code);
  await translationStore.loadTranslations(code);
}

function goToWelcome() {
  router.push('/welcome');
}

const features = [
  { icon: '🐷', key: 'homepage.featureFinance' as const },
  { icon: '📅', key: 'homepage.featurePlanner' as const },
  { icon: '✅', key: 'homepage.featureTodo' as const },
  { icon: '🔒', key: 'homepage.featurePrivacy' as const },
];
</script>

<template>
  <div
    class="dark:via-secondary-500 relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#F8F9FA] via-[#FEF0E8] to-[#EBF5FD] p-4 dark:from-[#1a252f] dark:to-[#1a252f]"
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

    <div class="w-full max-w-lg text-center">
      <!-- Hero -->
      <div class="mb-8">
        <img
          src="/brand/beanies_celebrating_line_transparent_600x600.png"
          alt="beanies celebrating"
          class="mx-auto -mb-[7.5rem] w-full max-w-sm"
        />
        <h1 class="font-outfit text-5xl font-bold">
          <span class="text-secondary-500 dark:text-gray-100">beanies</span
          ><span class="text-primary-500">.family</span>
        </h1>
        <p class="mt-2 text-lg text-gray-600 dark:text-gray-400">{{ t('app.tagline') }}</p>
        <p class="mx-auto mt-4 max-w-md text-sm text-gray-500 dark:text-gray-400">
          {{ t('homepage.heroDescription') }}
        </p>
      </div>

      <!-- Feature pills -->
      <div class="mb-8 flex flex-wrap justify-center gap-3">
        <span
          v-for="feature in features"
          :key="feature.key"
          class="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm dark:bg-slate-800/80 dark:text-gray-300"
        >
          <span>{{ feature.icon }}</span>
          <span>{{ t(feature.key) }}</span>
        </span>
      </div>

      <!-- CTA buttons -->
      <div class="mb-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          data-testid="homepage-get-started"
          class="from-primary-500 to-terracotta-400 font-outfit w-full rounded-2xl bg-gradient-to-r px-8 py-3.5 text-lg font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl sm:w-auto"
          @click="goToWelcome"
        >
          {{ t('homepage.getStarted') }}
        </button>
        <button
          data-testid="homepage-about-toggle"
          class="font-outfit text-secondary-500 w-full rounded-2xl bg-white px-8 py-3.5 text-lg font-semibold shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl sm:w-auto dark:bg-slate-800 dark:text-gray-200"
          @click="showAbout = !showAbout"
        >
          {{ t('homepage.about') }}
        </button>
      </div>

      <!-- About section (collapsible) -->
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 -translate-y-2"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="showAbout"
          data-testid="homepage-about-section"
          class="mx-auto mb-6 max-w-md rounded-3xl bg-white/90 p-6 text-left shadow-lg backdrop-blur-sm dark:bg-slate-800/90"
        >
          <p class="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {{ t('homepage.aboutDescription') }}
          </p>
          <div class="mt-4 flex items-center gap-3">
            <span
              class="bg-primary-500/10 text-primary-500 rounded-full px-3 py-1 text-xs font-semibold"
            >
              {{ t('homepage.betaBadge') }}
            </span>
            <span class="text-xs text-gray-400">{{ t('app.version') }}</span>
          </div>
          <a
            href="https://github.com/gparker97/beanies-family"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-500 hover:text-primary-600 mt-3 inline-flex items-center gap-1 text-sm font-medium"
          >
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
              />
            </svg>
            {{ t('homepage.viewOnGithub') }}
          </a>
        </div>
      </Transition>

      <!-- Sign in link -->
      <div class="mt-2">
        <button
          class="text-sm text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          @click="goToWelcome"
        >
          {{ t('homepage.signIn') }}
        </button>
      </div>
    </div>
  </div>
</template>
