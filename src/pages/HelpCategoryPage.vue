<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HelpPublicHeader from '@/components/help/HelpPublicHeader.vue';
import HelpArticleCard from '@/components/help/HelpArticleCard.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import {
  HELP_CATEGORIES,
  getCategoryMeta,
  getCategoryArticles,
  type HelpCategoryMeta,
} from '@/content/help';

const route = useRoute();
const authStore = useAuthStore();
const { t } = useTranslation();

const categoryId = computed(() => route.params.category as string);
const category = computed(() => getCategoryMeta(categoryId.value));
const articles = computed(() => getCategoryArticles(categoryId.value as any));

/** Other categories for the "explore more" section at the bottom */
const otherCategories = computed(() => HELP_CATEGORIES.filter((c) => c.id !== categoryId.value));

// Category stripe gradients (same as landing page)
const categoryStripe: Record<string, string> = {
  primary: 'bg-gradient-to-r from-primary-500 to-terracotta-400',
  terracotta: 'from-sky-silk-300 to-[#87CEEB] bg-gradient-to-r',
  secondary: 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]',
  'sky-silk': 'bg-gradient-to-r from-secondary-500 to-secondary-400',
};

const categoryIconBg: Record<string, string> = {
  primary: 'bg-[var(--tint-orange-15)] dark:bg-primary-500/15',
  terracotta: 'bg-[var(--tint-silk-20)] dark:bg-sky-silk-300/15',
  secondary: 'bg-[var(--tint-success-10)] dark:bg-green-500/15',
  'sky-silk': 'bg-[var(--tint-slate-5)] dark:bg-secondary-500/15',
};

function getCategoryStripe(cat: HelpCategoryMeta) {
  return categoryStripe[cat.color] || categoryStripe.primary;
}
</script>

<template>
  <div>
    <HelpPublicHeader v-if="!authStore.isAuthenticated" />

    <!-- Category hero banner -->
    <div class="relative bg-[var(--color-background)] px-6 pt-8 pb-12 md:pt-12 md:pb-16">
      <!-- Subtle background glow -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          class="absolute inset-0"
          style="
            background: radial-gradient(
              ellipse 60% 80% at 50% 0%,
              var(--tint-silk-10) 0%,
              transparent 70%
            );
          "
        />
      </div>

      <div class="relative z-10 mx-auto max-w-5xl">
        <!-- Breadcrumb -->
        <nav class="mb-6 text-sm text-gray-400 dark:text-gray-500">
          <router-link to="/help" class="hover:text-primary-500 transition-colors">
            {{ t('help.title') }}
          </router-link>
          <span class="mx-2">/</span>
          <span class="text-secondary-500 dark:text-gray-100">
            {{ category ? t(category.labelKey as any) : categoryId }}
          </span>
        </nav>

        <!-- Category header with icon -->
        <div class="flex items-center gap-4">
          <div
            v-if="category"
            class="flex h-14 w-14 items-center justify-center rounded-[18px] text-[28px]"
            :class="categoryIconBg[category.color]"
          >
            {{ category.icon }}
          </div>
          <div>
            <h1
              class="font-outfit text-secondary-500 text-2xl font-bold md:text-3xl dark:text-gray-100"
            >
              {{ category ? t(category.labelKey as any) : categoryId }}
            </h1>
            <p v-if="category" class="mt-1 text-sm text-[var(--color-text-muted)] md:text-base">
              {{ t(category.descriptionKey as any) }}
            </p>
          </div>
        </div>

        <!-- Article count badge -->
        <div
          v-if="articles.length > 0"
          class="font-outfit mt-5 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-4 py-1.5 text-xs font-medium text-[var(--color-text-muted)] shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <span class="text-sm">📄</span>
          {{ articles.length }} {{ articles.length === 1 ? 'article' : 'articles' }}
        </div>
      </div>
    </div>

    <!-- Articles grid -->
    <div class="mx-auto max-w-5xl px-6 pb-16 md:pb-20">
      <div v-if="articles.length > 0" class="grid gap-5 sm:grid-cols-2">
        <HelpArticleCard v-for="article in articles" :key="article.slug" :article="article" />
      </div>

      <!-- No articles fallback -->
      <div v-else class="py-16 text-center">
        <p class="text-lg text-gray-400 dark:text-gray-500">
          {{ t('help.noArticlesInCategory') }}
        </p>
      </div>

      <!-- Explore other categories -->
      <div
        v-if="otherCategories.length > 0"
        class="mt-14 border-t border-[var(--color-border)] pt-10 dark:border-slate-700"
      >
        <h2 class="font-outfit text-secondary-500 mb-6 text-lg font-bold dark:text-gray-100">
          {{ t('help.exploreOtherTopics') }}
        </h2>

        <div class="grid gap-4 sm:grid-cols-3">
          <router-link
            v-for="cat in otherCategories"
            :key="cat.id"
            :to="`/help/${cat.id}`"
            class="group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:border-slate-700 dark:bg-slate-800"
          >
            <!-- Top stripe -->
            <div class="absolute inset-x-0 top-0 h-0.5" :class="getCategoryStripe(cat)" />

            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-[14px] text-lg"
                :class="categoryIconBg[cat.color]"
              >
                {{ cat.icon }}
              </div>
              <div class="min-w-0 flex-1">
                <h3
                  class="font-outfit text-secondary-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 text-sm font-semibold dark:text-gray-100"
                >
                  {{ t(cat.labelKey as any) }}
                </h3>
                <p class="text-xs text-[var(--color-text-muted)]">
                  {{ getCategoryArticles(cat.id).length }} articles
                </p>
              </div>
              <span
                class="text-primary-500 text-sm opacity-0 transition-opacity group-hover:opacity-100"
                >→</span
              >
            </div>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
