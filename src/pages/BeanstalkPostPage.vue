<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useBlog, BLOG_CATEGORIES } from '@/composables/useBlog';
import PublicNav from '@/components/public/PublicNav.vue';
import PublicFooter from '@/components/public/PublicFooter.vue';

const route = useRoute();
const router = useRouter();
const { getPostBySlug, posts } = useBlog();

const post = computed(() => getPostBySlug(route.params.slug as string));
const categoryInfo = computed(() =>
  post.value ? BLOG_CATEGORIES.find((c) => c.id === post.value!.category) : undefined
);

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const currentIndex = computed(() =>
  post.value ? posts.value.findIndex((p) => p.slug === post.value!.slug) : -1
);
const nextPost = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < posts.value.length - 1
    ? posts.value[currentIndex.value + 1]
    : undefined
);
const prevPost = computed(() =>
  currentIndex.value > 0 ? posts.value[currentIndex.value - 1] : undefined
);

const navLinks = [
  { label: 'home', href: '/home' },
  { label: 'blog', href: '/beanstalk' },
  { label: 'help', href: '/help' },
];
</script>

<template>
  <div class="post-page">
    <PublicNav :links="navLinks" />

    <div v-if="post" class="post-content">
      <!-- Back link -->
      <button type="button" class="post-back" @click="router.push('/beanstalk')">
        <svg
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          viewBox="0 0 24 24"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        all posts
      </button>

      <!-- Article header -->
      <header class="post-header">
        <div class="post-header-top">
          <img src="/brand/beanies_father_son_icon_192x192.png" alt="" class="post-header-avatar" />
          <div>
            <span v-if="categoryInfo" class="post-header-cat">
              {{ categoryInfo.emoji }} {{ categoryInfo.label }}
            </span>
          </div>
        </div>
        <h1 class="post-header-title">{{ post.title }}</h1>
        <div class="post-header-meta">
          <span>{{ post.author }}</span>
          <span class="post-header-dot">·</span>
          <span>{{ formatDate(post.date) }}</span>
        </div>
      </header>

      <div class="post-divider" />

      <!-- eslint-disable-next-line vue/no-v-html -->
      <article class="blog-prose" v-html="post.html" />

      <div class="post-divider" />

      <!-- Prev / Next -->
      <div class="post-nav">
        <button
          v-if="prevPost"
          type="button"
          class="post-nav-btn"
          @click="router.push(`/beanstalk/${prevPost.slug}`)"
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <div>
            <div class="post-nav-label">newer</div>
            <div class="post-nav-title">{{ prevPost.title }}</div>
          </div>
        </button>
        <button
          v-if="nextPost"
          type="button"
          class="post-nav-btn post-nav-btn-right"
          @click="router.push(`/beanstalk/${nextPost.slug}`)"
        >
          <div>
            <div class="post-nav-label">older</div>
            <div class="post-nav-title">{{ nextPost.title }}</div>
          </div>
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 404 -->
    <div v-else class="post-404">
      <div class="post-404-emoji">🫘</div>
      <p>this post seems to have wandered off...</p>
      <button type="button" @click="router.push('/beanstalk')">back to blog</button>
    </div>

    <PublicFooter />
  </div>
</template>

<style scoped>
.post-page {
  --deep-slate: #2c3e50;
  --heritage-orange: #f15d22;
  --terracotta: #e67e22;
  --cloud-white: #f8f9fa;

  background: var(--cloud-white);
  min-height: 100vh;
}

/* ── Post content ── */
.post-content {
  margin: 0 auto;
  max-width: 640px;
  padding: 80px 24px 48px;
}

.post-back {
  align-items: center;
  background: none;
  border: none;
  color: rgb(44 62 80 / 35%);
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 4px;
  margin-bottom: 24px;
  transition: color 200ms;
}

.post-back:hover {
  color: var(--heritage-orange);
}

.post-header {
  margin-bottom: 32px;
}

.post-header-top {
  align-items: center;
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.post-header-avatar {
  background: linear-gradient(135deg, rgb(241 93 34 / 8%), rgb(174 214 241 / 8%));
  border-radius: 14px;
  height: 48px;
  padding: 4px;
  width: 48px;
}

.post-header-cat {
  background: rgb(44 62 80 / 4%);
  border-radius: 20px;
  color: rgb(44 62 80 / 45%);
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 3px 10px;
}

.post-header-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.75rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.post-header-meta {
  align-items: center;
  color: rgb(44 62 80 / 35%);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  gap: 6px;
  margin-top: 12px;
}

.post-header-dot {
  opacity: 0.4;
}

.post-divider {
  background: linear-gradient(90deg, transparent, rgb(44 62 80 / 8%), transparent);
  height: 1px;
  margin: 32px 0;
}

/* ── Prose ── */
.blog-prose :deep(h2) {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  margin: 2rem 0 0.75rem;
}

.blog-prose :deep(h3) {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.05rem;
  font-weight: 600;
  margin: 1.5rem 0 0.5rem;
}

.blog-prose :deep(p) {
  color: rgb(44 62 80 / 70%);
  font-size: 0.9375rem;
  line-height: 1.8;
  margin-bottom: 1rem;
}

.blog-prose :deep(strong) {
  color: var(--deep-slate);
  font-weight: 600;
}

.blog-prose :deep(em) {
  font-style: italic;
}

.blog-prose :deep(a) {
  color: var(--heritage-orange);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.blog-prose :deep(a:hover) {
  color: var(--terracotta);
}

.blog-prose :deep(ul),
.blog-prose :deep(ol) {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.blog-prose :deep(li) {
  color: rgb(44 62 80 / 70%);
  font-size: 0.9375rem;
  line-height: 1.8;
  margin-bottom: 0.35rem;
}

.blog-prose :deep(ul li) {
  list-style-type: disc;
}

.blog-prose :deep(ol li) {
  list-style-type: decimal;
}

.blog-prose :deep(blockquote) {
  border-left: 3px solid var(--heritage-orange);
  color: rgb(44 62 80 / 55%);
  font-style: italic;
  margin: 1.5rem 0;
  padding-left: 1rem;
}

.blog-prose :deep(code) {
  background: rgb(44 62 80 / 4%);
  border-radius: 6px;
  font-size: 0.85em;
  padding: 0.15em 0.4em;
}

.blog-prose :deep(hr) {
  background: rgb(44 62 80 / 8%);
  border: none;
  height: 1px;
  margin: 2rem 0;
}

/* ── Post nav ── */
.post-nav {
  display: flex;
  gap: 12px;
}

.post-nav-btn {
  align-items: center;
  background: white;
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 16px;
  cursor: pointer;
  display: flex;
  flex: 1;
  gap: 10px;
  padding: 16px;
  text-align: left;
  transition:
    border-color 200ms,
    box-shadow 200ms;
}

.post-nav-btn:hover {
  border-color: rgb(241 93 34 / 15%);
  box-shadow: 0 4px 16px rgb(241 93 34 / 6%);
}

.post-nav-btn-right {
  justify-content: flex-end;
  text-align: right;
}

.post-nav-btn svg {
  color: rgb(44 62 80 / 25%);
  flex-shrink: 0;
}

.post-nav-btn:hover svg {
  color: var(--heritage-orange);
}

.post-nav-label {
  color: rgb(44 62 80 / 35%);
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.post-nav-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-top: 2px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-nav-btn:hover .post-nav-title {
  color: var(--heritage-orange);
}

/* ── 404 ── */
.post-404 {
  padding: 120px 24px;
  text-align: center;
}

.post-404-emoji {
  font-size: 2.5rem;
  margin-bottom: 8px;
}

.post-404 p {
  color: rgb(44 62 80 / 40%);
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
}

.post-404 button {
  background: none;
  border: none;
  color: var(--heritage-orange);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  margin-top: 12px;
}

.post-404 button:hover {
  text-decoration: underline;
}

/* ── Mobile ── */
@media (width <= 520px) {
  .post-content {
    padding-top: 100px;
  }

  .post-header-title {
    font-size: 1.375rem;
  }
}
</style>
