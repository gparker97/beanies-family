<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HelpPublicHeader from '@/components/help/HelpPublicHeader.vue';
import HelpArticleCard from '@/components/help/HelpArticleCard.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { getCategoryMeta, getCategoryArticles } from '@/content/help';

const route = useRoute();
const authStore = useAuthStore();
const { t } = useTranslation();

const categoryId = computed(() => route.params.category as string);
const category = computed(() => getCategoryMeta(categoryId.value));
const articles = computed(() => getCategoryArticles(categoryId.value as any));
</script>

<template>
  <div>
    <HelpPublicHeader v-if="!authStore.isAuthenticated" />

    <div class="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <!-- Breadcrumb -->
      <nav class="mb-6 text-sm text-gray-400 dark:text-gray-500">
        <router-link to="/help" class="hover:text-primary-500">
          {{ t('help.title') }}
        </router-link>
        <span class="mx-2">/</span>
        <span class="text-secondary-500 dark:text-gray-100">
          {{ category ? t(category.labelKey as any) : categoryId }}
        </span>
      </nav>

      <!-- Category header -->
      <div class="mb-8">
        <div class="flex items-center gap-3">
          <span v-if="category" class="text-3xl">{{ category.icon }}</span>
          <h1
            class="font-outfit text-secondary-500 text-2xl font-bold md:text-3xl dark:text-gray-100"
          >
            {{ category ? t(category.labelKey as any) : categoryId }}
          </h1>
        </div>
        <p v-if="category" class="mt-2 text-gray-500 dark:text-gray-400">
          {{ t(category.descriptionKey as any) }}
        </p>
      </div>

      <!-- Articles grid -->
      <div v-if="articles.length > 0" class="grid gap-4 sm:grid-cols-2">
        <HelpArticleCard v-for="article in articles" :key="article.slug" :article="article" />
      </div>

      <!-- No articles fallback -->
      <div v-else class="py-12 text-center">
        <p class="text-gray-400 dark:text-gray-500">
          {{ t('help.noArticlesInCategory') }}
        </p>
      </div>
    </div>
  </div>
</template>
