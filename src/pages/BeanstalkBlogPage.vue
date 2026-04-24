<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useBlog, type BlogPost } from '@/composables/useBlog';
import PublicNav from '@/components/public/PublicNav.vue';
import PublicFooter from '@/components/public/PublicFooter.vue';
import SubstackSubscribe from '@/components/public/SubstackSubscribe.vue';
import { formatDate } from '@/utils/date';
import { MARKETING_URL } from '@/utils/marketing';

const router = useRouter();
const { featuredPost, regularPosts, posts } = useBlog();

function openPost(slug: string) {
  router.push(`/blog/${slug}`);
}

const navLinks = [
  { label: 'home', href: `${MARKETING_URL}/`, external: true },
  { label: 'beanstalk', href: '/blog' },
  { label: 'help', href: `${MARKETING_URL}/help`, external: true },
];

// ── Per-issue tints: cycle one of five brand-palette washes so each
// post reads as a distinct edition in the series. Mirrors the Astro
// index tint map verbatim so the Vue-rendered beanstalk looks the
// same as the marketing-site beanstalk.
interface IssueTint {
  hex: string;
  wash: string;
  accentOn: string;
  ink: string;
}
const TINTS: IssueTint[] = [
  {
    hex: '#f15d22',
    wash: 'linear-gradient(140deg, #fff6ef 0%, #ffe9d6 100%)',
    accentOn: 'rgb(241 93 34 / 18%)',
    ink: '#a83a11',
  },
  {
    hex: '#c76a21',
    wash: 'linear-gradient(140deg, #fff5e8 0%, #f5e1c2 100%)',
    accentOn: 'rgb(199 106 33 / 22%)',
    ink: '#7d420f',
  },
  {
    hex: '#3a82b3',
    wash: 'linear-gradient(140deg, #f1f8fd 0%, #dceaf6 100%)',
    accentOn: 'rgb(58 130 179 / 22%)',
    ink: '#1f4d6d',
  },
  {
    hex: '#b58a2a',
    wash: 'linear-gradient(140deg, #fbf6e8 0%, #f3e4bc 100%)',
    accentOn: 'rgb(181 138 42 / 22%)',
    ink: '#6c4f15',
  },
  {
    hex: '#2c3e50',
    wash: 'linear-gradient(140deg, #f2f4f7 0%, #dde3ec 100%)',
    accentOn: 'rgb(44 62 80 / 20%)',
    ink: '#1a2533',
  },
];

function tintFor(issue: number): IssueTint {
  return TINTS[(issue - 1) % TINTS.length]!;
}

function tintStyle(post: BlogPost): Record<string, string> {
  const t = tintFor(post.issueNumber);
  return {
    '--tint': t.hex,
    '--tint-ink': t.ink,
    '--wash': t.wash,
    '--accent-on': t.accentOn,
  };
}

function firstLetter(title: string): string {
  const m = title.match(/[A-Za-z]/);
  return (m?.[0] ?? title[0] ?? '•').toLowerCase();
}

function formatStamp(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d
    .toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

const totalIssues = computed(() => posts.value.length);
const latestStamp = computed(() => (posts.value[0] ? formatStamp(posts.value[0].date) : ''));
</script>

<template>
  <div class="beanstalk">
    <PublicNav :links="navLinks" />

    <!-- ══════════════ MASTHEAD ══════════════ -->
    <header class="masthead">
      <div class="masthead-wash" aria-hidden="true" />
      <img
        src="/brand/beanies_family_hugging_transparent_512x512.png"
        alt=""
        class="masthead-mascot"
        aria-hidden="true"
      />
      <div class="masthead-rule-top" aria-hidden="true">
        <span>THE BEANSTALK</span>
        <span class="masthead-rule-divider">·</span>
        <span>EST. 2026</span>
        <span class="masthead-rule-divider">·</span>
        <span>A BEANIES FAMILY PUBLICATION</span>
      </div>
      <h1 class="masthead-title">
        <span class="masthead-title-over">the</span>
        <span class="masthead-title-under">beanstalk.</span>
      </h1>
      <p class="masthead-pitch">
        a weekly dispatch from the bean patch
        <span class="masthead-pitch-em">- friday mornings</span>, greg writing, not a newsletter.
      </p>
      <p class="masthead-issue">
        <span class="masthead-issue-chip">VOL. 01</span>
        <span class="masthead-issue-dot">·</span>
        <span class="masthead-issue-chip">{{ totalIssues }} ISSUES</span>
        <template v-if="latestStamp">
          <span class="masthead-issue-dot">·</span>
          <span class="masthead-issue-stamp">LATEST {{ latestStamp }}</span>
        </template>
      </p>
    </header>

    <div class="masthead-divider" aria-hidden="true">
      <span class="masthead-divider-glyph">🫘</span>
    </div>

    <!-- ══════════════ FEATURED ══════════════ -->
    <div v-if="featuredPost" class="beanstalk-content">
      <button
        type="button"
        class="issue issue-featured"
        :class="featuredPost.coverImage ? 'issue-has-image' : 'issue-plate-variant'"
        :style="tintStyle(featuredPost)"
        :aria-label="`Read: ${featuredPost.title}`"
        @click="openPost(featuredPost.slug)"
      >
        <div class="issue-media" aria-hidden="true">
          <template v-if="featuredPost.coverImage">
            <div class="issue-media-frame">
              <img :src="featuredPost.coverImage" alt="" />
              <span class="issue-media-tape issue-media-tape-tl" />
              <span class="issue-media-tape issue-media-tape-br" />
            </div>
          </template>
          <template v-else>
            <div class="issue-plate">
              <span class="issue-plate-letter">{{ firstLetter(featuredPost.title) }}</span>
              <span v-if="featuredPost.coverEmoji" class="issue-plate-stamp">{{
                featuredPost.coverEmoji
              }}</span>
              <span class="issue-plate-grid" aria-hidden="true" />
            </div>
          </template>
        </div>
        <div class="issue-body">
          <p class="issue-kicker">
            <span class="issue-kicker-dot" aria-hidden="true" />
            <span class="issue-kicker-label">THIS WEEK'S ISSUE</span>
            <span class="issue-kicker-divider">·</span>
            <span class="issue-kicker-issue"
              >ISSUE {{ String(featuredPost.issueNumber).padStart(2, '0') }}</span
            >
          </p>
          <h2 class="issue-title issue-title-featured">{{ featuredPost.title }}</h2>
          <p v-if="featuredPost.subtitle" class="issue-sub">{{ featuredPost.subtitle }}</p>
          <p class="issue-byline">
            <span class="issue-byline-author">{{ featuredPost.author }}</span>
            <span class="issue-byline-dot">·</span>
            <span class="issue-byline-date">{{ formatDate(featuredPost.date) }}</span>
            <template v-if="featuredPost.category">
              <span class="issue-byline-dot">·</span>
              <span class="issue-byline-cat">{{ featuredPost.category }}</span>
            </template>
          </p>
          <span class="issue-cta">
            read the issue
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
      </button>

      <!-- ══════════════ BACK ISSUES ══════════════ -->
      <template v-if="regularPosts.length">
        <div class="section-rule" aria-hidden="true">
          <span>BACK ISSUES</span>
        </div>
        <section class="issues-grid" aria-label="Back issues">
          <button
            v-for="post in regularPosts"
            :key="post.slug"
            type="button"
            class="issue"
            :class="post.coverImage ? 'issue-has-image' : 'issue-plate-variant'"
            :style="tintStyle(post)"
            :aria-label="`Read: ${post.title}`"
            @click="openPost(post.slug)"
          >
            <div class="issue-media" aria-hidden="true">
              <template v-if="post.coverImage">
                <div class="issue-media-frame">
                  <img :src="post.coverImage" alt="" />
                  <span class="issue-media-tape issue-media-tape-tl" />
                </div>
              </template>
              <template v-else>
                <div class="issue-plate">
                  <span class="issue-plate-letter">{{ firstLetter(post.title) }}</span>
                  <span v-if="post.coverEmoji" class="issue-plate-stamp">{{
                    post.coverEmoji
                  }}</span>
                  <span class="issue-plate-grid" aria-hidden="true" />
                </div>
              </template>
            </div>
            <div class="issue-body">
              <p class="issue-kicker">
                <span class="issue-kicker-dot" aria-hidden="true" />
                <span class="issue-kicker-issue"
                  >ISSUE {{ String(post.issueNumber).padStart(2, '0') }}</span
                >
                <template v-if="post.category">
                  <span class="issue-kicker-divider">·</span>
                  <span class="issue-kicker-cat">{{ post.category }}</span>
                </template>
              </p>
              <h3 class="issue-title">{{ post.title }}</h3>
              <p v-if="post.subtitle" class="issue-sub">{{ post.subtitle }}</p>
              <p class="issue-byline">
                <span class="issue-byline-author">{{ post.author }}</span>
                <span class="issue-byline-dot">·</span>
                <span class="issue-byline-date">{{ formatDate(post.date) }}</span>
              </p>
            </div>
          </button>
        </section>
      </template>

      <SubstackSubscribe class="subscribe-section" />
    </div>

    <PublicFooter />
  </div>
</template>

<style scoped>
.beanstalk {
  --deep-slate: #2c3e50;
  --heritage-orange: #f15d22;
  --terracotta: #e67e22;
  --cloud-white: #f8f9fa;
  --ink: #1f2d3d;
  --muted: rgb(44 62 80 / 60%);
  --hairline: rgb(44 62 80 / 8%);
  --font-display: outfit, system-ui, sans-serif;
  --font-serif: 'Source Serif 4', georgia, serif;

  background: var(--cloud-white);
  background-image:
    radial-gradient(circle at 8% 12%, rgb(241 93 34 / 4%) 0%, transparent 40%),
    radial-gradient(circle at 92% 88%, rgb(174 214 241 / 6%) 0%, transparent 45%);
  min-height: 100vh;
  overflow-x: hidden;
  position: relative;
}

/* ══════════════ MASTHEAD ══════════════ */
.masthead {
  box-sizing: border-box;
  margin: 0 auto;
  max-width: 980px;
  padding: 120px 32px 48px;
  position: relative;
  text-align: center;
}

.masthead-wash {
  background:
    radial-gradient(circle at 22% 35%, rgb(241 93 34 / 10%) 0%, transparent 42%),
    radial-gradient(circle at 78% 70%, rgb(230 126 34 / 7%) 0%, transparent 45%);
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.masthead-mascot {
  bottom: 0;
  filter: drop-shadow(0 12px 28px rgb(44 62 80 / 12%));
  height: 160px;
  opacity: 0.9;
  pointer-events: none;
  position: absolute;
  right: -20px;
  transform: rotate(8deg);
  width: 160px;
  z-index: 0;
}

.masthead-rule-top {
  align-items: center;
  color: var(--heritage-orange);
  display: inline-flex;
  font-family: var(--font-display);
  font-size: 0.68rem;
  font-weight: 700;
  gap: 10px;
  justify-content: center;
  letter-spacing: 0.26em;
  margin-bottom: 28px;
  padding: 8px 18px;
  position: relative;
  text-transform: uppercase;
}

.masthead-rule-top::before,
.masthead-rule-top::after {
  background: linear-gradient(
    to right,
    transparent,
    color-mix(in srgb, var(--heritage-orange) 35%, transparent),
    transparent
  );
  content: '';
  display: block;
  flex: 1;
  height: 1px;
  margin: 0 10px;
  max-width: 80px;
}

.masthead-rule-divider {
  opacity: 0.55;
}

.masthead-title {
  color: var(--deep-slate);
  font-family: var(--font-serif);
  line-height: 0.9;
  margin: 0 0 22px;
  position: relative;
  z-index: 1;
}

.masthead-title-over {
  display: block;
  font-size: clamp(1.8rem, 3.6vw, 2.6rem);
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.005em;
  opacity: 0.75;
}

.masthead-title-under {
  color: var(--deep-slate);
  display: block;
  font-family: var(--font-serif);
  font-size: clamp(4rem, 11vw, 8rem);
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.035em;
  margin-top: 2px;
}

.masthead-pitch {
  color: rgb(44 62 80 / 78%);
  font-family: var(--font-serif);
  font-size: clamp(1.05rem, 1.6vw, 1.2rem);
  font-style: italic;
  font-weight: 400;
  line-height: 1.55;
  margin: 0 auto 26px;
  max-width: 620px;
  position: relative;
  z-index: 1;
}

.masthead-pitch-em {
  color: var(--heritage-orange);
  font-style: italic;
  font-weight: 500;
}

.masthead-issue {
  align-items: center;
  color: var(--muted);
  display: inline-flex;
  flex-wrap: wrap;
  font-family: var(--font-display);
  font-size: 0.72rem;
  font-weight: 700;
  gap: 10px;
  justify-content: center;
  letter-spacing: 0.22em;
  margin: 0;
  position: relative;
  text-transform: uppercase;
  z-index: 1;
}

.masthead-issue-chip {
  background: rgb(44 62 80 / 4%);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  color: var(--deep-slate);
  padding: 6px 12px;
}

.masthead-issue-stamp {
  color: var(--heritage-orange);
  font-weight: 700;
}

.masthead-issue-dot {
  opacity: 0.45;
}

.masthead-divider {
  align-items: center;
  color: var(--heritage-orange);
  display: flex;
  gap: 18px;
  justify-content: center;
  margin: 0 auto 48px;
  max-width: 540px;
  padding: 0 32px;
}

.masthead-divider::before,
.masthead-divider::after {
  background: linear-gradient(to right, transparent, rgb(241 93 34 / 30%), transparent);
  content: '';
  flex: 1;
  height: 1px;
}

.masthead-divider-glyph {
  font-size: 0.9rem;
  letter-spacing: 0.3em;
  opacity: 0.6;
}

.beanstalk-content {
  margin: 0 auto;
  max-width: 980px;
  padding: 0 32px 32px;
}

/* ══════════════ ISSUE CARDS ══════════════ */
.issue {
  background: var(--wash);
  border: 1px solid color-mix(in srgb, var(--tint) 14%, var(--hairline));
  border-radius: 24px;
  color: var(--ink);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  overflow: hidden;
  position: relative;
  text-align: left;
  transition:
    border-color 220ms ease,
    box-shadow 220ms ease,
    transform 220ms ease;
  width: 100%;
}

.issue::after {
  background: linear-gradient(
    160deg,
    transparent 30%,
    rgb(255 255 255 / 32%) 65%,
    transparent 100%
  );
  content: '';
  inset: 0;
  mix-blend-mode: overlay;
  opacity: 0.55;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.issue:hover {
  border-color: color-mix(in srgb, var(--tint) 48%, transparent);
  box-shadow: 0 24px 48px -20px color-mix(in srgb, var(--tint) 40%, transparent);
  transform: translateY(-3px);
}

.issue > * {
  position: relative;
  z-index: 1;
}

.issue-featured {
  display: grid;
  gap: 0;
  grid-template-columns: 1.05fr 1fr;
  margin-bottom: 56px;
}

.issue-media {
  aspect-ratio: 16 / 10;
  background: color-mix(in srgb, var(--tint) 8%, white);
  border-right: 1px solid color-mix(in srgb, var(--tint) 12%, transparent);
  overflow: hidden;
  position: relative;
}

.issue-media-frame {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, rgb(255 255 255 / 12%) 100%), #fbf7ee;
  box-shadow:
    inset 0 0 0 8px rgb(255 255 255 / 70%),
    inset 0 0 0 9px color-mix(in srgb, var(--tint) 18%, transparent);
  height: 100%;
  padding: 14px;
  position: relative;
  width: 100%;
}

.issue-media-frame img {
  border-radius: 6px;
  display: block;
  filter: saturate(1.02) contrast(1.02);
  height: 100%;
  object-fit: cover;
  transition:
    transform 500ms ease,
    filter 500ms ease;
  width: 100%;
}

.issue:hover .issue-media-frame img {
  filter: saturate(1.08) contrast(1.04);
  transform: scale(1.02);
}

.issue-media-tape {
  background: rgb(255 255 255 / 55%);
  border: 1px solid rgb(255 255 255 / 35%);
  box-shadow: 0 2px 4px rgb(44 62 80 / 12%);
  height: 14px;
  position: absolute;
  width: 44px;
  z-index: 2;
}

.issue-media-tape-tl {
  left: 8px;
  top: 6px;
  transform: rotate(-18deg);
}

.issue-media-tape-br {
  bottom: 6px;
  right: 8px;
  transform: rotate(-18deg);
}

.issue-plate {
  align-items: center;
  color: var(--tint-ink);
  display: flex;
  height: 100%;
  justify-content: center;
  min-height: 240px;
  position: relative;
}

.issue-plate-letter {
  font-family: var(--font-serif);
  font-size: clamp(9rem, 22vw, 16rem);
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.06em;
  line-height: 0.82;
  margin-bottom: -0.08em;
  opacity: 0.82;
  position: relative;
  z-index: 1;
}

.issue-plate-stamp {
  align-items: center;
  background: white;
  border: 1px solid color-mix(in srgb, var(--tint) 26%, transparent);
  border-radius: 50%;
  box-shadow: 0 6px 16px -4px color-mix(in srgb, var(--tint) 30%, transparent);
  display: inline-flex;
  font-size: 1.25rem;
  height: 42px;
  justify-content: center;
  position: absolute;
  right: 20px;
  top: 20px;
  transform: rotate(6deg);
  width: 42px;
  z-index: 2;
}

.issue-plate-grid {
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--tint) 10%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--tint) 10%, transparent) 1px,
      transparent 1px
    );
  background-size: 28px 28px;
  inset: 0;
  mask-image: radial-gradient(circle at center, black 20%, transparent 85%);
  opacity: 0.5;
  position: absolute;
  z-index: 0;
}

.issue-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 26px 28px 28px;
}

.issue-featured .issue-media {
  aspect-ratio: auto;
  height: 100%;
  min-height: 340px;
}

.issue-featured .issue-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  justify-content: center;
  padding: 44px 40px;
}

.issue-kicker {
  align-items: center;
  color: var(--tint-ink);
  display: inline-flex;
  flex-wrap: wrap;
  font-family: var(--font-display);
  font-size: 0.68rem;
  font-weight: 700;
  gap: 8px;
  letter-spacing: 0.2em;
  margin: 0;
  text-transform: uppercase;
}

.issue-kicker-dot {
  background: var(--tint);
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tint) 16%, transparent);
  display: inline-block;
  height: 7px;
  width: 7px;
}

.issue-kicker-divider {
  opacity: 0.5;
}

.issue-kicker-cat {
  color: rgb(44 62 80 / 60%);
  text-transform: uppercase;
}

.issue-title {
  color: var(--deep-slate);
  font-family: var(--font-display);
  font-size: clamp(1.3rem, 2vw, 1.55rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.18;
  margin: 0;
  transition: color 180ms;
}

.issue:hover .issue-title {
  color: var(--tint-ink);
}

.issue-title-featured {
  font-size: clamp(1.7rem, 3vw, 2.2rem);
  letter-spacing: -0.022em;
}

.issue-sub {
  color: rgb(44 62 80 / 72%);
  font-family: var(--font-serif);
  font-size: 1rem;
  font-style: italic;
  font-weight: 400;
  line-height: 1.45;
  margin: 0;
}

.issue-featured .issue-sub {
  font-size: clamp(1.05rem, 1.4vw, 1.2rem);
  max-width: 44ch;
}

.issue-byline {
  align-items: center;
  color: rgb(44 62 80 / 58%);
  display: inline-flex;
  flex-wrap: wrap;
  font-family: var(--font-display);
  font-size: 0.78rem;
  font-weight: 500;
  gap: 8px;
  letter-spacing: 0.02em;
  margin: 4px 0 0;
}

.issue-byline-author {
  color: var(--deep-slate);
  font-weight: 600;
}

.issue-byline-dot {
  opacity: 0.5;
}

.issue-byline-cat {
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.issue-cta {
  align-items: center;
  color: var(--tint-ink);
  display: inline-flex;
  font-family: var(--font-display);
  font-size: 0.82rem;
  font-weight: 700;
  gap: 6px;
  letter-spacing: 0.04em;
  margin-top: 8px;
  text-transform: uppercase;
  transition: gap 200ms ease;
}

.issue:hover .issue-cta {
  gap: 12px;
}

.issue-cta svg {
  transition: transform 200ms ease;
}

.issue:hover .issue-cta svg {
  transform: translateX(3px);
}

/* ══════════════ BACK ISSUES GRID ══════════════ */
.section-rule {
  align-items: center;
  color: var(--heritage-orange);
  display: flex;
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 700;
  gap: 14px;
  justify-content: center;
  letter-spacing: 0.26em;
  margin: 0 0 28px;
  text-transform: uppercase;
}

.section-rule::before,
.section-rule::after {
  background: linear-gradient(to right, transparent, rgb(241 93 34 / 28%), transparent);
  content: '';
  flex: 1;
  height: 1px;
  max-width: 180px;
}

.issues-grid {
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.subscribe-section {
  margin: 72px 0 0;
}

/* ══════════════ RESPONSIVE ══════════════ */
@media (width <= 900px) {
  .masthead {
    padding: 100px 24px 40px;
  }

  .masthead-mascot {
    height: 120px;
    right: -10px;
    width: 120px;
  }

  .beanstalk-content {
    padding: 0 24px 32px;
  }

  .issue-featured {
    grid-template-columns: 1fr;
    margin-bottom: 44px;
  }

  .issue-featured .issue-media {
    aspect-ratio: 16 / 10;
    min-height: 0;
  }

  .issue-featured .issue-body {
    padding: 28px 24px;
  }

  .issues-grid {
    gap: 20px;
    grid-template-columns: 1fr;
  }

  .subscribe-section {
    margin-top: 56px;
  }
}

@media (width <= 520px) {
  .masthead {
    padding: 92px 20px 32px;
  }

  .masthead-mascot {
    height: 92px;
    opacity: 0.75;
    right: 0;
    width: 92px;
  }

  .masthead-rule-top {
    font-size: 0.6rem;
    letter-spacing: 0.22em;
  }

  .masthead-rule-top::before,
  .masthead-rule-top::after {
    max-width: 40px;
  }

  .masthead-title-over {
    font-size: clamp(1.4rem, 5vw, 2rem);
  }

  .masthead-title-under {
    font-size: clamp(3.2rem, 15vw, 5.2rem);
  }

  .masthead-pitch {
    font-size: 1rem;
  }

  .issue-body {
    padding: 22px 20px 24px;
  }

  .issue-title-featured {
    font-size: 1.45rem;
  }

  .issue-plate-letter {
    font-size: clamp(7rem, 38vw, 11rem);
  }

  .issue-media-frame {
    padding: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .issue:hover {
    transform: none;
  }

  .issue:hover .issue-media-frame img {
    transform: none;
  }

  .issue:hover .issue-cta {
    gap: 6px;
  }

  .issue:hover .issue-cta svg {
    transform: none;
  }
}
</style>
