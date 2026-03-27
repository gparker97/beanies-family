<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import HelpPublicHeader from '@/components/help/HelpPublicHeader.vue';
import HelpArticleCard from '@/components/help/HelpArticleCard.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useHelpSearch } from '@/composables/useHelpSearch';
import {
  HELP_CATEGORIES,
  getPopularArticles,
  getCategoryArticles,
  type HelpCategoryMeta,
} from '@/content/help';

const router = useRouter();
const authStore = useAuthStore();
const { t } = useTranslation();
const { isMobile } = useBreakpoint();
const { prefersReducedMotion } = useReducedMotion();

const searchQuery = ref('');
const { results: searchResults, hasQuery } = useHelpSearch(searchQuery);

const popularArticles = getPopularArticles().slice(0, 3);

function scrollToIndex() {
  const el = document.getElementById('all-articles');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// Category card icon background tints (matching wireframe stripe colors)
const categoryIconBg: Record<string, string> = {
  primary: 'bg-[var(--tint-orange-15)] dark:bg-primary-500/15',
  terracotta: 'bg-[var(--tint-silk-20)] dark:bg-sky-silk-300/15',
  secondary: 'bg-[var(--tint-success-10)] dark:bg-green-500/15',
  'sky-silk': 'bg-[var(--tint-slate-5)] dark:bg-secondary-500/15',
};

// Category card top stripe gradients
const categoryStripe: Record<string, string> = {
  primary: 'bg-gradient-to-r from-primary-500 to-terracotta-400',
  terracotta: 'from-sky-silk-300 to-[#87CEEB] bg-gradient-to-r',
  secondary: 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]',
  'sky-silk': 'bg-gradient-to-r from-secondary-500 to-secondary-400',
};

// TOC group icon backgrounds
const tocIconBg: Record<string, string> = {
  primary: 'bg-[var(--tint-orange-15)] dark:bg-primary-500/15',
  terracotta: 'bg-[var(--tint-silk-20)] dark:bg-sky-silk-300/15',
  secondary: 'bg-[var(--tint-success-10)] dark:bg-green-500/15',
  'sky-silk': 'bg-[var(--tint-slate-5)] dark:bg-secondary-500/15',
};

function navigateCategory(cat: HelpCategoryMeta) {
  router.push(`/help/${cat.id}`);
}
</script>

<template>
  <div>
    <!-- Public header for unauthenticated visitors -->
    <HelpPublicHeader v-if="!authStore.isAuthenticated" />

    <!-- ══════ SECTION 1: HERO ══════ -->
    <section class="relative bg-[var(--color-background)] px-6 py-16 md:py-24">
      <!-- Decorative floating circles (match wireframe) — clipped wrapper -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          class="absolute -top-[120px] -right-[60px] h-80 w-80 rounded-full bg-[var(--tint-orange-8)]"
          :class="{ 'animate-[float_8s_ease-in-out_infinite]': !prefersReducedMotion }"
        />
        <div
          class="absolute -bottom-20 -left-10 h-60 w-60 rounded-full bg-[var(--tint-silk-20)]"
          :class="{ 'animate-[float_10s_ease-in-out_infinite_reverse]': !prefersReducedMotion }"
        />
        <!-- Subtle radial gradients behind content -->
        <div
          class="absolute inset-0"
          style="
            background:
              radial-gradient(ellipse 80% 60% at 20% 90%, var(--tint-silk-20) 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 85% 20%, var(--tint-orange-8) 0%, transparent 60%);
          "
        />
      </div>

      <div class="relative z-10 mx-auto max-w-[1200px]">
        <div
          class="flex items-center justify-center gap-15 text-left"
          :class="{ 'flex-col-reverse text-center': isMobile }"
        >
          <!-- Left: text + search -->
          <div class="max-w-[560px] flex-1">
            <!-- Badge -->
            <div
              class="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2 text-xs font-medium shadow-[var(--card-shadow)] dark:border-slate-700 dark:bg-slate-800"
              :class="{ 'font-outfit': true }"
            >
              <span
                class="h-2 w-2 rounded-full bg-[#27AE60]"
                :class="{ 'animate-pulse': !prefersReducedMotion }"
              />
              {{ t('help.heroBadge') }}
            </div>

            <!-- Title: "how can we help?" with "help" in orange -->
            <h1
              class="font-outfit text-secondary-500 text-4xl leading-tight font-extrabold md:text-5xl dark:text-gray-100"
            >
              how can we
              <span class="text-primary-500">help</span>?
            </h1>

            <p class="mt-4 max-w-[540px] text-lg text-[var(--color-text-muted)]">
              {{ t('help.subtitle') }}
            </p>

            <!-- Search bar -->
            <div class="relative mt-10 max-w-[560px]">
              <span class="absolute top-1/2 left-5 -translate-y-1/2 text-xl opacity-40"> 🔍</span>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('help.searchPlaceholder')"
                class="focus:border-sky-silk-300 dark:focus:border-sky-silk-300 w-full rounded-3xl border-2 border-[var(--color-border)] bg-white py-[18px] pr-6 pl-14 text-[17px] text-[var(--color-text)] shadow-[var(--soft-shadow)] transition-[border-color,box-shadow] duration-200 focus:shadow-[0_8px_40px_rgba(174,214,241,0.2)] focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                style="font-family: 'Source Serif 4', Georgia, serif; font-style: italic"
              />

              <!-- Search hints -->
              <div
                v-if="!hasQuery"
                class="font-outfit mt-3 text-xs tracking-wide text-[var(--color-text-muted)]"
              >
                Try:
                <span
                  class="mx-0.5 rounded-md bg-[var(--tint-slate-5)] px-2 py-0.5 font-medium dark:bg-slate-700"
                  >getting started</span
                >
                <span
                  class="mx-0.5 rounded-md bg-[var(--tint-slate-5)] px-2 py-0.5 font-medium dark:bg-slate-700"
                  >encryption</span
                >
                <span
                  class="mx-0.5 rounded-md bg-[var(--tint-slate-5)] px-2 py-0.5 font-medium dark:bg-slate-700"
                  >how net worth works</span
                >
                <span
                  class="mx-0.5 rounded-md bg-[var(--tint-slate-5)] px-2 py-0.5 font-medium dark:bg-slate-700"
                  >privacy</span
                >
              </div>

              <!-- Search results dropdown -->
              <div
                v-if="hasQuery && searchResults.length > 0"
                class="absolute top-full right-0 left-0 z-20 mt-2 max-h-80 overflow-y-auto rounded-3xl bg-white p-2 shadow-lg dark:bg-slate-800"
              >
                <router-link
                  v-for="article in searchResults.slice(0, 8)"
                  :key="article.slug"
                  :to="`/help/${article.category}/${article.slug}`"
                  class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <span class="text-lg">{{ article.icon }}</span>
                  <div>
                    <div class="text-secondary-500 text-sm font-medium dark:text-gray-100">
                      {{ article.title }}
                    </div>
                    <div class="text-xs text-gray-400">{{ article.readTime }} min read</div>
                  </div>
                </router-link>
              </div>

              <!-- No results -->
              <div
                v-else-if="hasQuery && searchResults.length === 0"
                class="absolute top-full right-0 left-0 z-20 mt-2 rounded-3xl bg-white p-6 text-center shadow-lg dark:bg-slate-800"
              >
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ t('help.noResults') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Right: Mascot image -->
          <div v-if="!isMobile" class="relative shrink-0">
            <div
              class="absolute top-1/2 left-1/2 -z-10 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style="background: radial-gradient(circle, var(--tint-orange-15) 0%, transparent 70%)"
            />
            <img
              src="/brand/beanies_family_hugging_transparent_512x512.png"
              alt="The beanies family hugging"
              class="h-[280px] w-[280px] object-contain drop-shadow-[0_12px_32px_rgba(44,62,80,0.10)]"
              :class="{ 'animate-[gentle-bob_4s_ease-in-out_infinite]': !prefersReducedMotion }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- ══════ SECTION 2: CATEGORY CARDS ══════ -->
    <section class="border-t border-[var(--color-border)] py-16 md:py-20">
      <div class="mx-auto max-w-[1200px] px-6 md:px-8">
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <button
            v-for="cat in HELP_CATEGORIES"
            :key="cat.id"
            class="relative block cursor-pointer overflow-hidden rounded-3xl bg-white p-7 text-left shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            @click="navigateCategory(cat)"
          >
            <!-- Top color stripe -->
            <div class="absolute inset-x-0 top-0 h-1" :class="categoryStripe[cat.color]" />

            <!-- Icon in tinted square -->
            <div
              class="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] text-[26px]"
              :class="categoryIconBg[cat.color]"
            >
              {{ cat.icon }}
            </div>

            <h3
              class="font-outfit text-secondary-500 text-lg leading-tight font-bold dark:text-gray-100"
            >
              {{ t(cat.labelKey as any) }}
            </h3>
            <p class="mt-2 text-sm leading-snug text-[var(--color-text-muted)]">
              {{ t(cat.descriptionKey as any) }}
            </p>
            <span
              class="font-outfit text-primary-500 dark:text-primary-400 mt-4 inline-block text-xs font-semibold tracking-wide"
            >
              {{ getCategoryArticles(cat.id).length }} articles →
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- ══════ SECTION 3: POPULAR ARTICLES ══════ -->
    <section class="border-t border-[var(--color-border)] py-16 md:py-20">
      <div class="mx-auto max-w-[1200px] px-6 md:px-8">
        <!-- Header with "View all articles" link -->
        <div class="mb-8 flex items-center justify-between">
          <h2
            class="font-outfit text-secondary-500 text-2xl font-bold md:text-[28px] dark:text-gray-100"
          >
            {{ t('help.popularArticles') }}
          </h2>
          <button
            class="font-outfit text-primary-500 hover:text-primary-600 dark:text-primary-400 flex cursor-pointer items-center gap-1 text-sm font-semibold transition-[gap] duration-200 hover:gap-2"
            @click="scrollToIndex"
          >
            {{ t('help.viewAllArticles') }} ↓
          </button>
        </div>

        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <HelpArticleCard
            v-for="article in popularArticles"
            :key="article.slug"
            :article="article"
          />
        </div>
      </div>
    </section>

    <!-- ══════ SECTION 4: SECURITY SPOTLIGHT ══════ -->
    <section class="border-t border-[var(--color-border)] py-16 md:py-20">
      <div class="mx-auto max-w-[1200px] px-6 md:px-8">
        <div class="grid items-center gap-10 md:gap-16 lg:grid-cols-2">
          <!-- Left: prose + feature list -->
          <div>
            <h2
              class="font-outfit text-secondary-500 text-3xl leading-tight font-extrabold md:text-4xl dark:text-gray-100"
            >
              {{ t('help.securitySpotlightTitle') }}
            </h2>
            <p class="mt-4 text-lg leading-relaxed text-[var(--color-text-muted)]">
              {{ t('help.securitySpotlightDesc') }}
            </p>

            <!-- Security features list -->
            <ul class="mt-8 flex flex-col gap-5">
              <li class="flex items-start gap-4">
                <div
                  class="dark:bg-primary-500/15 flex h-11 w-11 min-w-[44px] items-center justify-center rounded-[14px] bg-[var(--tint-orange-15)] text-xl"
                >
                  🔐
                </div>
                <div>
                  <h4 class="font-outfit text-[15px] font-semibold">
                    {{ t('help.securityFeature1Title') }}
                  </h4>
                  <p class="text-sm leading-snug text-[var(--color-text-muted)]">
                    {{ t('help.securityFeature1Desc') }}
                  </p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <div
                  class="dark:bg-sky-silk-300/15 flex h-11 w-11 min-w-[44px] items-center justify-center rounded-[14px] bg-[var(--tint-silk-20)] text-xl"
                >
                  🔑
                </div>
                <div>
                  <h4 class="font-outfit text-[15px] font-semibold">
                    {{ t('help.securityFeature2Title') }}
                  </h4>
                  <p class="text-sm leading-snug text-[var(--color-text-muted)]">
                    {{ t('help.securityFeature2Desc') }}
                  </p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <div
                  class="flex h-11 w-11 min-w-[44px] items-center justify-center rounded-[14px] bg-[var(--tint-success-10)] text-xl dark:bg-green-500/15"
                >
                  👪
                </div>
                <div>
                  <h4 class="font-outfit text-[15px] font-semibold">
                    {{ t('help.securityFeature3Title') }}
                  </h4>
                  <p class="text-sm leading-snug text-[var(--color-text-muted)]">
                    {{ t('help.securityFeature3Desc') }}
                  </p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <div
                  class="dark:bg-secondary-500/15 flex h-11 w-11 min-w-[44px] items-center justify-center rounded-[14px] bg-[var(--tint-slate-5)] text-xl"
                >
                  💻
                </div>
                <div>
                  <h4 class="font-outfit text-[15px] font-semibold">
                    {{ t('help.securityFeature4Title') }}
                  </h4>
                  <p class="text-sm leading-snug text-[var(--color-text-muted)]">
                    {{ t('help.securityFeature4Desc') }}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <!-- Right: encryption flow diagram -->
          <div>
            <div
              class="rounded-[var(--sq-lg,32px)] bg-white p-8 shadow-[var(--soft-shadow)] md:p-10 dark:bg-slate-800"
            >
              <div
                class="font-outfit mb-7 text-xs font-semibold tracking-[0.1em] text-[var(--color-text-muted)] uppercase"
              >
                {{ t('help.diagramTitle') }}
              </div>

              <div class="flex flex-col gap-3">
                <!-- Step 1 -->
                <div
                  class="font-outfit dark:bg-primary-500/10 flex items-center gap-3.5 rounded-2xl bg-[var(--tint-orange-8)] px-[18px] py-3.5 text-sm font-medium transition-transform hover:translate-x-1"
                >
                  <span
                    class="bg-primary-500 flex h-7 w-7 min-w-[28px] items-center justify-center rounded-[10px] text-xs font-bold text-white"
                    >1</span
                  >
                  {{ t('help.diagramStep1') }}
                </div>
                <div class="text-center text-[var(--color-text-muted)] opacity-40">↓</div>
                <!-- Step 2 -->
                <div
                  class="font-outfit dark:bg-sky-silk-300/10 flex items-center gap-3.5 rounded-2xl bg-[var(--tint-silk-10)] px-[18px] py-3.5 text-sm font-medium transition-transform hover:translate-x-1"
                >
                  <span
                    class="bg-sky-silk-300 text-secondary-500 flex h-7 w-7 min-w-[28px] items-center justify-center rounded-[10px] text-xs font-bold"
                    >2</span
                  >
                  {{ t('help.diagramStep2') }}
                </div>
                <div class="text-center text-[var(--color-text-muted)] opacity-40">↓</div>
                <!-- Step 3 -->
                <div
                  class="font-outfit flex items-center gap-3.5 rounded-2xl bg-[var(--tint-success-10)] px-[18px] py-3.5 text-sm font-medium transition-transform hover:translate-x-1 dark:bg-green-500/10"
                >
                  <span
                    class="flex h-7 w-7 min-w-[28px] items-center justify-center rounded-[10px] bg-[#27AE60] text-xs font-bold text-white"
                    >3</span
                  >
                  {{ t('help.diagramStep3') }}
                </div>
                <div class="text-center text-[var(--color-text-muted)] opacity-40">↓</div>
                <!-- Step 4 -->
                <div
                  class="font-outfit bg-secondary-500 dark:bg-secondary-500/20 flex items-center gap-3.5 rounded-2xl px-[18px] py-3.5 text-sm font-medium text-white transition-transform hover:translate-x-1 dark:text-gray-300"
                >
                  <span
                    class="bg-secondary-500 dark:bg-secondary-600 flex h-7 w-7 min-w-[28px] items-center justify-center rounded-[10px] text-xs font-bold text-white"
                    >4</span
                  >
                  {{ t('help.diagramStep4') }}
                </div>
              </div>

              <div
                class="mt-6 border-t border-[var(--color-border)] pt-5 text-center text-xs text-[var(--color-text-muted)] italic dark:border-slate-700"
              >
                {{ t('help.diagramCaption') }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════ SECTION 5: FULL ARTICLE INDEX ══════ -->
    <section
      id="all-articles"
      class="scroll-mt-8 border-t border-[var(--color-border)] bg-white py-16 md:py-20 dark:bg-slate-800/50"
    >
      <div class="mx-auto max-w-[1200px] px-6 md:px-8">
        <div class="mb-10 text-center">
          <h2
            class="font-outfit text-secondary-500 text-2xl font-bold md:text-[28px] dark:text-gray-100"
          >
            {{ t('help.allArticles') }}
          </h2>
          <p class="mx-auto mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
            {{ t('help.allArticlesSubtitle') }}
          </p>
        </div>

        <div class="grid gap-6 sm:gap-8 lg:grid-cols-2">
          <router-link
            v-for="cat in HELP_CATEGORIES"
            :key="cat.id"
            :to="`/help/${cat.id}`"
            class="group relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-background)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:border-slate-700 dark:bg-slate-800/80"
          >
            <!-- Top color stripe -->
            <div class="h-1" :class="categoryStripe[cat.color]" />

            <div class="p-7">
              <!-- Group header -->
              <div class="mb-5 flex items-center gap-3.5">
                <div
                  class="flex h-11 w-11 items-center justify-center rounded-[16px] text-xl"
                  :class="tocIconBg[cat.color]"
                >
                  {{ cat.icon }}
                </div>
                <div class="min-w-0 flex-1">
                  <h3
                    class="font-outfit text-secondary-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 text-lg font-bold dark:text-gray-100"
                  >
                    {{ t(cat.labelKey as any) }}
                  </h3>
                  <p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {{ getCategoryArticles(cat.id).length }} articles
                  </p>
                </div>
                <span
                  class="text-primary-500 text-sm opacity-0 transition-opacity group-hover:opacity-100"
                  >→</span
                >
              </div>

              <!-- Article links — show up to 4, with overflow hint -->
              <ul class="flex flex-col gap-0.5">
                <li v-for="article in getCategoryArticles(cat.id).slice(0, 4)" :key="article.slug">
                  <span class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm">
                    <span class="min-w-[20px] text-center text-base opacity-40">{{
                      article.icon
                    }}</span>
                    <span class="text-secondary-500 dark:text-gray-300">{{ article.title }}</span>
                  </span>
                </li>
                <li v-if="getCategoryArticles(cat.id).length > 4">
                  <span
                    class="text-primary-500 dark:text-primary-400 font-outfit mt-1 ml-3 inline-block text-xs font-semibold"
                  >
                    +{{ getCategoryArticles(cat.id).length - 4 }} more →
                  </span>
                </li>
              </ul>
            </div>
          </router-link>
        </div>
      </div>
    </section>

    <!-- ══════ SECTION 6: CHATBOT TEASER ══════ -->
    <section class="relative overflow-hidden py-16 md:py-20">
      <div
        class="bg-secondary-500 dark:from-secondary-600 dark:to-secondary-700 absolute inset-0 bg-gradient-to-br from-[var(--color-secondary-500)] to-[var(--color-secondary-600)] dark:bg-gradient-to-br"
      />
      <!-- Decorative glow -->
      <div
        class="pointer-events-none absolute top-[-100px] left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full"
        style="background: radial-gradient(circle, rgb(241 93 34 / 12%) 0%, transparent 70%)"
      />

      <div class="relative z-10 mx-auto max-w-[1200px] px-6 text-center text-white md:px-8">
        <!-- Coming soon badge -->
        <div
          class="font-outfit text-primary-500 mb-5 inline-flex items-center gap-1.5 rounded-full bg-[rgba(241,93,34,0.15)] px-4 py-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          ✨ Coming Soon
        </div>

        <h2 class="font-outfit text-3xl font-extrabold md:text-4xl">
          {{ t('help.chatbotTeaser') }}
        </h2>
        <p class="mx-auto mt-4 max-w-[520px] text-lg text-white/70">
          {{ t('help.chatbotTeaserDesc') }}
        </p>

        <!-- Chat preview -->
        <div
          class="mx-auto mt-9 max-w-[440px] rounded-3xl border border-white/10 bg-white/6 p-6 text-left backdrop-blur-[10px]"
        >
          <!-- User message -->
          <div class="mb-4 flex gap-2.5">
            <div
              class="flex h-8 w-8 min-w-[32px] items-center justify-center rounded-[10px] bg-[rgba(241,93,34,0.2)] text-base"
            >
              🧑
            </div>
            <div class="rounded-[14px] bg-white/8 px-4 py-2.5 text-sm leading-snug text-white/90">
              How is my net worth calculated?
            </div>
          </div>
          <!-- Bot message -->
          <div class="mb-4 flex gap-2.5">
            <div
              class="flex h-8 w-8 min-w-[32px] items-center justify-center rounded-[10px] bg-[rgba(174,214,241,0.2)] text-base"
            >
              🥫
            </div>
            <div
              class="text-sky-silk-300 rounded-[14px] bg-white/8 px-4 py-2.5 text-sm leading-snug"
            >
              {{ t('help.chatbotMockAnswer') }}
            </div>
          </div>
          <!-- Input preview -->
          <div
            class="font-outfit flex items-center gap-2.5 rounded-[14px] border border-white/8 bg-white/6 px-4 py-3 text-xs text-white/30 italic"
          >
            💬 {{ t('help.chatbotInputPlaceholder') }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(20px);
  }
}

@keyframes gentle-bob {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }
}
</style>
