<script setup lang="ts">
import type { HelpArticle } from '@/content/help';
import { getCategoryMeta } from '@/content/help';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  article: HelpArticle;
}>();

const { t } = useTranslation();
const category = getCategoryMeta(props.article.category);

const colorClasses: Record<string, string> = {
  primary: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400',
  terracotta: 'bg-orange-50 text-terracotta-400 dark:bg-terracotta-400/10 dark:text-terracotta-400',
  secondary: 'bg-secondary-50 text-secondary-500 dark:bg-secondary-500/10 dark:text-sky-silk-300',
  'sky-silk': 'bg-sky-silk-50 text-secondary-400 dark:bg-sky-silk-300/10 dark:text-sky-silk-300',
};
</script>

<template>
  <router-link
    :to="`/help/${article.category}/${article.slug}`"
    class="group block rounded-3xl bg-white p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
  >
    <div class="mb-3 flex items-center gap-2">
      <span
        v-if="category"
        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
        :class="colorClasses[category.color] || colorClasses.primary"
      >
        {{ category.icon }} {{ t(category.labelKey as any) }}
      </span>
      <span class="ml-auto text-xs text-gray-400 dark:text-gray-500">
        {{ article.readTime }} min read
      </span>
    </div>
    <h3
      class="font-outfit text-secondary-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 mb-1.5 text-base font-semibold dark:text-gray-100"
    >
      {{ article.icon }} {{ article.title }}
    </h3>
    <p class="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
      {{ article.excerpt }}
    </p>
  </router-link>
</template>
