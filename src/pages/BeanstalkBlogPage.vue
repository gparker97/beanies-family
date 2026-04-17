<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useBlog } from '@/composables/useBlog';
import PublicNav from '@/components/public/PublicNav.vue';
import PublicFooter from '@/components/public/PublicFooter.vue';
import SubstackSubscribe from '@/components/public/SubstackSubscribe.vue';
import { formatDate } from '@/utils/date';
import { MARKETING_URL } from '@/utils/marketing';

const router = useRouter();
const { featuredPost, regularPosts } = useBlog();

const comingSoonCards = [
  { emoji: '✅', title: 'introducing todos', subtitle: 'coming soon' },
  { emoji: '🔍', title: 'best cozi & maple alternatives in 2026', subtitle: 'coming soon' },
];

function openPost(slug: string) {
  router.push(`/blog/${slug}`);
}

const navLinks = [
  { label: 'home', href: `${MARKETING_URL}/`, external: true },
  { label: 'beanstalk', href: '/blog' },
  { label: 'help', href: `${MARKETING_URL}/help`, external: true },
];
</script>

<template>
  <div class="blog-page">
    <PublicNav :links="navLinks" />

    <!-- ═══ Hero header ═══ -->
    <div class="blog-hero">
      <div class="blog-hero-pattern" />
      <div class="blog-hero-content">
        <img
          src="/brand/beanies_family_hugging_transparent_512x512.png"
          alt="the beanies family"
          class="blog-hero-mascot"
        />
        <h1 class="blog-hero-title">welcome to the beanie beanstalk!</h1>
        <p class="blog-hero-tagline">
          the latest beanie news and updates — posted every friday, or roughly whenever I feel like
          it
        </p>
      </div>
    </div>

    <!-- ═══ Content ═══ -->
    <div class="blog-content">
      <!-- Featured post -->
      <button
        v-if="featuredPost"
        type="button"
        class="featured-card"
        @click="openPost(featuredPost.slug)"
      >
        <div class="featured-card-bg" />
        <div class="featured-card-inner">
          <div class="featured-card-left">
            <img
              src="/brand/beanies_father_son_icon_192x192.png"
              alt=""
              class="featured-card-illustration"
            />
          </div>
          <div class="featured-card-right">
            <div class="featured-card-badge">
              <span class="featured-card-badge-dot" />
              featured
            </div>
            <h2 class="featured-card-title">{{ featuredPost.title }}</h2>
            <p class="featured-card-excerpt">{{ featuredPost.excerpt }}</p>
            <div class="featured-card-meta">
              <span>{{ featuredPost.author }}</span>
              <span class="featured-card-meta-dot">·</span>
              <span>{{ formatDate(featuredPost.date) }}</span>
            </div>
          </div>
          <div class="featured-card-arrow">
            <svg
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              viewBox="0 0 24 24"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </button>

      <!-- Published posts grid -->
      <div v-if="regularPosts.length" class="posts-grid">
        <button
          v-for="post in regularPosts"
          :key="post.slug"
          type="button"
          class="post-card"
          @click="openPost(post.slug)"
        >
          <div class="post-card-emoji">{{ post.coverEmoji }}</div>
          <h3 class="post-card-title">{{ post.title }}</h3>
          <p class="post-card-excerpt">{{ post.excerpt }}</p>
          <div class="post-card-meta">
            <span>{{ post.author }}</span>
            <span class="post-card-meta-dot">·</span>
            <span>{{ formatDate(post.date) }}</span>
          </div>
        </button>
      </div>

      <!-- Coming soon grid -->
      <div class="coming-grid">
        <div
          v-for="(card, i) in comingSoonCards"
          :key="i"
          class="coming-card"
          :class="`coming-card-${i % 3}`"
        >
          <div class="coming-card-emoji">{{ card.emoji }}</div>
          <h3 class="coming-card-title">{{ card.title }}</h3>
          <p class="coming-card-sub">{{ card.subtitle }}</p>
        </div>
      </div>

      <!-- Subscribe -->
      <SubstackSubscribe class="subscribe-section" />
    </div>

    <PublicFooter />
  </div>
</template>

<style scoped>
.blog-page {
  --deep-slate: #2c3e50;
  --heritage-orange: #f15d22;
  --terracotta: #e67e22;
  --cloud-white: #f8f9fa;

  background: var(--cloud-white);
  min-height: 100vh;
}

/* ── Hero ── */
.blog-hero {
  overflow: hidden;
  padding: 100px 24px 48px;
  position: relative;
  text-align: center;
}

.blog-hero-pattern {
  background-image:
    radial-gradient(circle at 25% 25%, var(--heritage-orange) 1px, transparent 1px),
    radial-gradient(circle at 75% 75%, var(--terracotta) 1px, transparent 1px);
  background-size: 32px 32px;
  inset: 0;
  opacity: 0.03;
  position: absolute;
}

.blog-hero-content {
  position: relative;
  z-index: 1;
}

.blog-hero-mascot {
  animation: hero-bounce 600ms ease-out;
  filter: drop-shadow(0 12px 32px rgb(44 62 80 / 10%));
  height: 160px;
  margin: 0 auto 20px;
  width: 160px;
}

.blog-hero-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 2.25rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.blog-hero-tagline {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  margin-top: 8px;
  opacity: 0.4;
}

@keyframes hero-bounce {
  0% {
    opacity: 0;
    transform: translateY(-20px);
  }

  60% {
    opacity: 1;
    transform: translateY(4px);
  }

  100% {
    transform: translateY(0);
  }
}

/* ── Content ── */
.blog-content {
  margin: 0 auto;
  max-width: 800px;
  padding: 0 24px 48px;
}

/* ── Featured card ── */
.featured-card {
  border: none;
  border-radius: 24px;
  cursor: pointer;
  display: block;
  margin-bottom: 40px;
  overflow: hidden;
  position: relative;
  text-align: left;
  transition:
    transform 200ms ease,
    box-shadow 200ms ease;
  width: 100%;
}

.featured-card:hover {
  box-shadow: 0 16px 48px rgb(241 93 34 / 15%);
  transform: translateY(-2px);
}

.featured-card-bg {
  background: linear-gradient(
    135deg,
    var(--heritage-orange) 0%,
    var(--terracotta) 40%,
    #d4721e 100%
  );
  inset: 0;
  position: absolute;
}

.featured-card-bg::after {
  background-image:
    radial-gradient(circle at 20% 80%, white 1.5px, transparent 1.5px),
    radial-gradient(circle at 80% 20%, white 1px, transparent 1px);
  background-size:
    28px 28px,
    20px 20px;
  content: '';
  inset: 0;
  opacity: 0.06;
  position: absolute;
}

.featured-card-inner {
  align-items: center;
  display: flex;
  gap: 20px;
  padding: 28px 24px;
  position: relative;
}

.featured-card-left {
  flex-shrink: 0;
}

.featured-card-illustration {
  backdrop-filter: blur(8px);
  background: rgb(255 255 255 / 15%);
  border-radius: 20px;
  height: 80px;
  padding: 8px;
  width: 80px;
}

.featured-card-right {
  flex: 1;
  min-width: 0;
}

.featured-card-badge {
  align-items: center;
  color: rgb(255 255 255 / 80%);
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-weight: 700;
  gap: 6px;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.featured-card-badge-dot {
  animation: pulse-dot 2s ease-in-out infinite;
  background: white;
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

.featured-card-title {
  color: white;
  font-family: Outfit, sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
}

.featured-card:hover .featured-card-title {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.featured-card-excerpt {
  -webkit-box-orient: vertical;
  color: rgb(255 255 255 / 60%);
  display: -webkit-box;
  font-size: 0.8125rem;
  -webkit-line-clamp: 2;
  line-height: 1.6;
  margin-top: 8px;
  overflow: hidden;
}

.featured-card-meta {
  align-items: center;
  color: rgb(255 255 255 / 40%);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  gap: 6px;
  margin-top: 12px;
}

.featured-card-meta-dot {
  opacity: 0.3;
}

.featured-card-arrow {
  align-items: center;
  background: rgb(255 255 255 / 10%);
  border-radius: 50%;
  color: rgb(255 255 255 / 60%);
  display: flex;
  flex-shrink: 0;
  height: 40px;
  justify-content: center;
  transition:
    background 200ms,
    color 200ms;
  width: 40px;
}

.featured-card:hover .featured-card-arrow {
  background: white;
  color: var(--heritage-orange);
}

/* ── Published posts grid ── */
.posts-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, 1fr);
  margin-bottom: 40px;
}

@media (width <= 480px) {
  .posts-grid {
    grid-template-columns: 1fr;
  }
}

.post-card {
  background: white;
  border: 1.5px solid rgb(44 62 80 / 8%);
  border-radius: 20px;
  cursor: pointer;
  padding: 28px 20px;
  text-align: left;
  transition:
    transform 200ms ease,
    border-color 200ms,
    box-shadow 200ms;
  width: 100%;
}

.post-card:hover {
  border-color: var(--heritage-orange);
  box-shadow: 0 8px 24px rgb(241 93 34 / 8%);
  transform: translateY(-2px);
}

.post-card-emoji {
  font-size: 2rem;
  margin-bottom: 12px;
}

.post-card-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 8px;
}

.post-card:hover .post-card-title {
  color: var(--heritage-orange);
}

.post-card-excerpt {
  -webkit-box-orient: vertical;
  color: var(--deep-slate);
  display: -webkit-box;
  font-size: 0.8125rem;
  -webkit-line-clamp: 3;
  line-height: 1.6;
  opacity: 0.5;
  overflow: hidden;
}

.post-card-meta {
  align-items: center;
  color: var(--deep-slate);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  gap: 6px;
  margin-top: 12px;
  opacity: 0.3;
}

.post-card-meta-dot {
  opacity: 0.5;
}

/* ── Subscribe ── */
.subscribe-section {
  margin-top: 40px;
}

/* ── Coming soon grid ── */
.coming-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, 1fr);
}

@media (width <= 480px) {
  .coming-grid {
    grid-template-columns: 1fr;
  }
}

.coming-card {
  border: 1.5px dashed rgb(44 62 80 / 8%);
  border-radius: 20px;
  padding: 28px 20px;
  text-align: center;
  transition: border-color 200ms;
}

.coming-card:hover {
  border-color: rgb(44 62 80 / 15%);
}

.coming-card-0 {
  background: linear-gradient(135deg, rgb(241 93 34 / 4%), rgb(230 126 34 / 2%));
}

.coming-card-1 {
  background: linear-gradient(135deg, rgb(174 214 241 / 8%), rgb(174 214 241 / 3%));
}

.coming-card-2 {
  background: linear-gradient(135deg, rgb(39 174 96 / 5%), rgb(39 174 96 / 2%));
}

.coming-card-emoji {
  font-size: 2rem;
  margin-bottom: 12px;
}

.coming-card-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.coming-card-sub {
  color: var(--heritage-orange);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  opacity: 0.6;
  text-transform: lowercase;
}

/* ── Mobile ── */
@media (width <= 520px) {
  .blog-hero {
    padding-top: 120px;
  }

  .blog-hero-mascot {
    height: 120px;
    width: 120px;
  }

  .blog-hero-title {
    font-size: 1.75rem;
  }

  .featured-card-inner {
    flex-direction: column;
    text-align: center;
  }

  .featured-card-arrow {
    display: none;
  }
}
</style>
