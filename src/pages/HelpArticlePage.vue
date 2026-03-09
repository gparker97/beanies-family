<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import HelpPublicHeader from '@/components/help/HelpPublicHeader.vue';
import HelpArticleRenderer from '@/components/help/HelpArticleRenderer.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { showToast } from '@/composables/useToast';
import {
  getArticle,
  getCategoryMeta,
  getCategoryArticles,
  type ArticleSection,
} from '@/content/help';

const route = useRoute();
const authStore = useAuthStore();
const { t } = useTranslation();
const { isDesktop } = useBreakpoint();

const categoryId = computed(() => route.params.category as string);
const slug = computed(() => route.params.slug as string);
const article = computed(() => getArticle(categoryId.value, slug.value));
const category = computed(() => getCategoryMeta(categoryId.value));
const categoryArticles = computed(() => getCategoryArticles(categoryId.value as any));

// TOC: extract headings from sections
const headings = computed(() => {
  if (!article.value) return [];
  return article.value.sections
    .filter((s: ArticleSection) => s.type === 'heading' && s.id)
    .map((s: ArticleSection) => ({
      id: s.id!,
      text: s.content,
      level: s.level ?? 2,
    }));
});

// Scroll-spy for TOC
const activeHeadingId = ref('');
let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeHeadingId.value = entry.target.id;
        }
      }
    },
    { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
  );

  // Observe heading elements after a tick
  setTimeout(() => {
    for (const h of headings.value) {
      const el = document.getElementById(h.id);
      if (el) observer!.observe(el);
    }
  }, 100);
});

onUnmounted(() => {
  observer?.disconnect();
});

// Feedback
const feedbackGiven = ref<'yes' | 'no' | null>(null);

function giveFeedback(helpful: 'yes' | 'no') {
  feedbackGiven.value = helpful;
  try {
    const key = `help_feedback_${categoryId.value}_${slug.value}`;
    localStorage.setItem(key, helpful);
  } catch {
    // localStorage unavailable
  }
  showToast('success', t('help.feedbackThanks'));
}

// Load saved feedback
onMounted(() => {
  try {
    const key = `help_feedback_${categoryId.value}_${slug.value}`;
    const saved = localStorage.getItem(key);
    if (saved === 'yes' || saved === 'no') feedbackGiven.value = saved;
  } catch {
    // localStorage unavailable
  }
});
</script>

<template>
  <div>
    <HelpPublicHeader v-if="!authStore.isAuthenticated" />

    <div v-if="article" class="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
      <div class="flex gap-8">
        <!-- Left sidebar: category nav (desktop only) -->
        <aside v-if="isDesktop" class="w-56 shrink-0">
          <div class="sticky top-8">
            <h3
              class="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
            >
              {{ category ? t(category.labelKey as any) : categoryId }}
            </h3>
            <nav class="space-y-1">
              <router-link
                v-for="a in categoryArticles"
                :key="a.slug"
                :to="`/help/${a.category}/${a.slug}`"
                class="block rounded-xl px-3 py-2 text-sm transition-colors"
                :class="
                  a.slug === slug
                    ? 'text-primary-500 dark:bg-primary-500/10 dark:text-primary-400 bg-[var(--tint-orange-8)] font-medium'
                    : 'hover:text-secondary-500 text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200'
                "
              >
                {{ a.icon }} {{ a.title }}
              </router-link>
            </nav>
          </div>
        </aside>

        <!-- Center: article content -->
        <article class="min-w-0 flex-1">
          <!-- Breadcrumb -->
          <nav class="mb-6 text-sm text-gray-400 dark:text-gray-500">
            <router-link to="/help" class="hover:text-primary-500">
              {{ t('help.title') }}
            </router-link>
            <span class="mx-2">/</span>
            <router-link :to="`/help/${categoryId}`" class="hover:text-primary-500">
              {{ category ? t(category.labelKey as any) : categoryId }}
            </router-link>
            <span class="mx-2">/</span>
            <span class="text-secondary-500 dark:text-gray-100">
              {{ article.title }}
            </span>
          </nav>

          <!-- Article meta -->
          <div class="mb-8">
            <h1
              class="font-outfit text-secondary-500 text-2xl font-bold md:text-3xl dark:text-gray-100"
            >
              {{ article.icon }} {{ article.title }}
            </h1>
            <div class="mt-2 flex items-center gap-4 text-sm text-gray-400 dark:text-gray-500">
              <span>{{ article.readTime }} min read</span>
              <span>·</span>
              <span>Updated {{ article.updatedDate }}</span>
            </div>
          </div>

          <!-- Article body -->
          <HelpArticleRenderer :sections="article.sections" />

          <!-- Feedback widget -->
          <div
            class="mt-12 rounded-2xl border border-gray-100 p-6 text-center dark:border-slate-700"
          >
            <p class="text-secondary-500 text-sm font-medium dark:text-gray-100">
              {{ t('help.wasHelpful') }}
            </p>
            <div v-if="!feedbackGiven" class="mt-3 flex justify-center gap-3">
              <button
                class="text-secondary-500 dark:bg-sky-silk-300/10 dark:hover:bg-primary-500/10 rounded-xl bg-[var(--tint-silk-20)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--tint-orange-8)] dark:text-gray-300"
                @click="giveFeedback('yes')"
              >
                👍 {{ t('help.yes') }}
              </button>
              <button
                class="text-secondary-500 dark:bg-sky-silk-300/10 dark:hover:bg-primary-500/10 rounded-xl bg-[var(--tint-silk-20)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--tint-orange-8)] dark:text-gray-300"
                @click="giveFeedback('no')"
              >
                👎 {{ t('help.no') }}
              </button>
            </div>
            <p v-else class="mt-2 text-sm text-gray-400 dark:text-gray-500">
              {{ t('help.feedbackThanks') }}
            </p>
          </div>
        </article>

        <!-- Right sidebar: TOC (desktop only) -->
        <aside v-if="isDesktop && headings.length > 0" class="w-48 shrink-0">
          <div class="sticky top-8">
            <h3
              class="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
            >
              {{ t('help.onThisPage') }}
            </h3>
            <nav class="space-y-1">
              <a
                v-for="h in headings"
                :key="h.id"
                :href="`#${h.id}`"
                class="block text-sm transition-colors"
                :class="[
                  h.level === 3 ? 'pl-3' : '',
                  activeHeadingId === h.id
                    ? 'text-primary-500 dark:text-primary-400 font-medium'
                    : 'hover:text-secondary-500 text-gray-400 dark:text-gray-500 dark:hover:text-gray-300',
                ]"
              >
                {{ h.text }}
              </a>
            </nav>
          </div>
        </aside>
      </div>
    </div>

    <!-- Not found -->
    <div v-else class="py-20 text-center">
      <p class="text-lg text-gray-400 dark:text-gray-500">
        {{ t('help.articleNotFound') }}
      </p>
      <router-link
        to="/help"
        class="text-primary-500 hover:text-primary-600 mt-4 inline-block text-sm font-medium"
      >
        ← {{ t('help.backToHelp') }}
      </router-link>
    </div>
  </div>
</template>
