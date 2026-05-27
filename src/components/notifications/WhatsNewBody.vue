<script setup lang="ts">
/**
 * The celebratory "what's new" detail. Every other notification detail is a
 * utilitarian card; this one is a CELEBRATION — a gradient hero with the
 * celebrating beanies + sparkles, the white body emerging beneath, the Pod, and
 * greg's handwritten sign-off. Renders inside `NotificationDetail` for whats-new
 * (which hands it the whole detail area).
 *
 * Handles BOTH shapes: a brief per-deploy note shows its `summary` message; a
 * curated release shows `features` cards (+ "also fixed"). Same hero + footer.
 *
 * Layout note: it breaks out of `BaseSidePanel`'s `p-6` body via `-mx-6 -my-6`
 * (the house pattern, cf. BeanieFormModal) so the hero is full-bleed; the
 * `min-h-[calc(100%+3rem)]` reclaims that 3rem so the column fills the panel and
 * the footer pins to the bottom.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { MARKETING_URL } from '@/utils/marketing';
import { openExternal } from '@/utils/openExternal';
import type { ReleaseNote } from '@/content/release-notes';

const props = defineProps<{ release: ReleaseNote }>();

const router = useRouter();
const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();

/**
 * The note's headline + detail blocks (the general rule for per-deploy notes AND
 * curated releases). One block reads as a focused announcement; several hang off
 * a "beanstalk" stalk. A note with no blocks (a legacy / minor summary-only note)
 * falls back to its centred `summary` message.
 */
const blocks = computed(() => props.release.features ?? []);
const isMulti = computed(() => blocks.value.length > 1);
const isSingle = computed(() => blocks.value.length === 1);

function handleTryIt(route: string) {
  store.close();
  router.push(route);
}

function handleSeeAll() {
  openExternal(`${MARKETING_URL}/help/whats-new`);
}
</script>

<template>
  <div class="wn-detail -mx-6 -my-6 flex min-h-[calc(100%+3rem)] flex-col">
    <!-- ===== HERO ===== -->
    <div class="wn-hero">
      <span class="hspark a" aria-hidden="true">✦</span>
      <span class="hspark b" aria-hidden="true">✨</span>
      <span class="hspark c" aria-hidden="true">✦</span>
      <div class="wn-medallion">
        <img src="/brand/beanies_celebrating_circle_transparent_400x400.png" alt="" />
      </div>
      <div class="wn-kick">
        ✨ {{ t('notifications.kindWhatsNew')
        }}<span v-if="isMulti">
          · {{ t('whatsNew.updateCount').replace('{n}', String(blocks.length)) }}</span
        >
      </div>
      <div class="wn-datepill">{{ release.month }}</div>
    </div>

    <!-- ===== CONTENT ===== -->
    <div class="wn-content">
      <div class="wn-region" :class="{ 'wn-region-center': blocks.length === 0 }">
        <!-- legacy / minor summary-only note: just the centred message -->
        <p v-if="blocks.length === 0 && release.summary" class="wn-message">
          {{ txt(release.summary) }}
        </p>

        <!-- the general rule: headline + detail blocks (single = centred; many = beanstalk) -->
        <template v-else>
          <div class="wn-list" :class="{ single: isSingle }">
            <div v-for="(feature, i) in blocks" :key="i" class="wn-item">
              <span v-if="isSingle && feature.icon" class="wn-item-emoji" aria-hidden="true">
                {{ feature.icon }}
              </span>
              <h4 class="wn-item-title">{{ txt(feature.title) }}</h4>
              <p class="wn-item-desc">{{ txt(feature.description) }}</p>
              <button
                v-if="feature.tryItRoute"
                class="wn-tryit"
                @click="handleTryIt(feature.tryItRoute!)"
              >
                {{ t('whatsNew.tryIt') }}<span class="wn-tryit-arrow">→</span>
              </button>
            </div>
          </div>

          <template v-if="release.fixes?.length">
            <div class="wn-fixes-label">{{ t('whatsNew.alsoFixed') }}</div>
            <ul class="wn-fixes">
              <li v-for="(fix, i) in release.fixes" :key="i">{{ txt(fix.text) }}</li>
            </ul>
          </template>
        </template>
      </div>

      <!-- The Pod (slate · terracotta · orange · sky — never reordered) -->
      <div class="wn-pod" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="wn-sign">{{ release.signature ?? '— greg, head beanie developer 🫘' }}</div>
    </div>

    <!-- ===== FOOTER ===== -->
    <div class="wn-foot">
      <button class="wn-seeall" @click="handleSeeAll">{{ t('whatsNew.seeAll') }} →</button>
      <div class="wn-tagline">{{ t('app.tagline') }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ===== HERO ===== */
.wn-hero {
  background:
    radial-gradient(130% 100% at 15% 0%, rgb(255 255 255 / 28%), transparent 55%),
    linear-gradient(135deg, #f15d22 0%, #e67e22 100%);
  flex-shrink: 0;
  overflow: hidden;
  padding: 1.75rem 1.5rem 2.75rem;
  position: relative;
  text-align: center;
}

.wn-medallion {
  background: radial-gradient(circle, rgb(255 255 255 / 95%), rgb(255 255 255 / 72%));
  border-radius: 50%;
  box-shadow: 0 10px 30px -8px rgb(44 62 80 / 35%);
  display: grid;
  height: 7rem;
  margin: 0.25rem auto 0.875rem;
  place-items: center;
  width: 7rem;
}

.wn-medallion img {
  height: 5.5rem;
  object-fit: contain;
  width: 5.5rem;
}

.wn-kick {
  color: rgb(255 255 255 / 95%);
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.wn-datepill {
  background: rgb(255 255 255 / 22%);
  border: 1px solid rgb(255 255 255 / 35%);
  border-radius: 999px;
  color: #fff;
  display: inline-block;
  font-family: Outfit, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  margin-top: 0.75rem;
  padding: 0.25rem 0.75rem;
}

/* sparkles — decorative, motion-safe */
.hspark {
  color: #fff;
  pointer-events: none;
  position: absolute;
}

.hspark.a {
  font-size: 0.8125rem;
  left: 1.9rem;
  top: 1.4rem;
}

.hspark.b {
  font-size: 1.125rem;
  right: 2.1rem;
  top: 3.4rem;
}

.hspark.c {
  font-size: 0.625rem;
  left: 2.9rem;
  top: 7.5rem;
}

@media (prefers-reduced-motion: no-preference) {
  .hspark {
    animation: wn-twinkle 2.6s ease-in-out infinite;
  }

  .hspark.b {
    animation-delay: 0.6s;
  }

  .hspark.c {
    animation-delay: 1.2s;
  }

  .wn-medallion {
    animation: wn-floaty 4s ease-in-out infinite;
  }
}

@keyframes wn-twinkle {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

@keyframes wn-floaty {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-0.375rem);
  }
}

/* ===== CONTENT — white body emerges over the hero ===== */
.wn-content {
  background: #fff;
  border-radius: 1.625rem 1.625rem 0 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  margin-top: -1.5rem;
  padding: 1.625rem 1.5rem 1.25rem;
  position: relative;
  z-index: 2;
}

:global(.dark) .wn-content {
  background: #1e293b;
}

.wn-region {
  flex: 1;
}

.wn-region-center {
  display: grid;
  place-items: center;
}

.wn-message {
  color: #2c3e50;
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.62;
  margin: 0 0.25rem;
  text-align: center;
}

:global(.dark) .wn-message {
  color: #e2e8f0;
}

/* headline + detail blocks — the "beanstalk list" (Treatment B).
   Rules are ordered base → single-variant → multi-variant so specificity
   never descends (stylelint no-descending-specificity). */
.wn-list {
  position: relative;
}

.wn-item {
  position: relative;
}

.wn-item-emoji {
  display: block;
  font-size: 1.625rem;
  margin-bottom: 0.375rem;
  text-align: center;
}

.wn-item-title {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 0.25rem;
}

.wn-item-desc {
  color: rgb(44 62 80 / 62%);
  font-family: Inter, sans-serif;
  font-size: 0.8125rem;
  line-height: 1.58;
  margin: 0;
}

:global(.dark) .wn-item-title {
  color: #e2e8f0;
}

:global(.dark) .wn-item-desc {
  color: rgb(226 232 240 / 70%);
}

/* single block: a focused, centred headline + reason (no stalk) */
.wn-list.single .wn-item {
  text-align: center;
}

.wn-list.single .wn-item-title {
  font-size: 1.0625rem;
  margin-bottom: 0.5rem;
}

.wn-list.single .wn-item-desc {
  font-size: 0.875rem;
  margin: 0 0.25rem;
}

/* the stalk + bean nodes only appear when there are several blocks */
.wn-list:not(.single) {
  padding-left: 1.875rem;
}

.wn-list:not(.single)::before {
  background: linear-gradient(
    180deg,
    rgb(241 93 34 / 55%),
    rgb(230 126 34 / 35%) 70%,
    rgb(230 126 34 / 0%)
  );
  border-radius: 2px;
  bottom: 0.4375rem;
  content: '';
  left: 0.5625rem;
  position: absolute;
  top: 0.4375rem;
  width: 2px;
}

.wn-list:not(.single) .wn-item {
  padding-bottom: 1.125rem;
}

.wn-list:not(.single) .wn-item:last-child {
  padding-bottom: 0;
}

/* the bean node on the stalk */
.wn-list:not(.single) .wn-item::before {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border-radius: 50% 50% 48% 48%;
  box-shadow:
    0 0 0 4px #fff,
    0 3px 8px -3px rgb(241 93 34 / 70%);
  content: '';
  height: 0.875rem;
  left: -1.6875rem;
  position: absolute;
  top: 0.25rem;
  width: 0.75rem;
}

:global(.dark) .wn-list:not(.single) .wn-item::before {
  box-shadow:
    0 0 0 4px #1e293b,
    0 3px 8px -3px rgb(241 93 34 / 70%);
}

.wn-tryit {
  align-items: center;
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border: none;
  border-radius: 0.625rem;
  color: #f15d22;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.3125rem;
  margin-top: 0.625rem;
  padding: 0.375rem 0.6875rem;
  white-space: nowrap;
}

.wn-tryit:hover {
  background: var(--tint-orange-15, rgb(241 93 34 / 15%));
}

.wn-tryit-arrow {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative arrow glyph paired with adjacent button text */
  font-size: 0.875rem;
}

.wn-fixes-label {
  color: rgb(44 62 80 / 40%);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  margin: 0.75rem 0 0.5rem;
}

.wn-fixes {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding-left: 1rem;
}

.wn-fixes li {
  color: rgb(44 62 80 / 50%);
  font-size: 0.75rem;
}

:global(.dark) .wn-fixes li {
  color: rgb(226 232 240 / 55%);
}

/* The Pod divider */
.wn-pod {
  display: flex;
  flex-shrink: 0;
  gap: 0.4375rem;
  justify-content: center;
  margin: 1.375rem 0 1.125rem;
}

.wn-pod i {
  border-radius: 50% 50% 48% 48%;
  height: 0.6875rem;
  width: 0.5625rem;
}

.wn-pod i:nth-child(1) {
  background: #2c3e50;
}

.wn-pod i:nth-child(2) {
  background: #e67e22;
}

.wn-pod i:nth-child(3) {
  background: #f15d22;
}

.wn-pod i:nth-child(4) {
  background: #aed6f1;
}

.wn-sign {
  color: #5d6d7e;
  flex-shrink: 0;
  font-family: Caveat, Outfit, cursive;
  font-size: 1.3125rem;
  font-weight: 700;
  text-align: right;
}

:global(.dark) .wn-sign {
  color: #94a3b8;
}

/* ===== FOOTER ===== */
.wn-foot {
  background: #fff;
  border-top: 1px solid #ecf0f2;
  flex-shrink: 0;
  padding: 0.875rem 1.5rem 1.5rem;
  text-align: center;
}

:global(.dark) .wn-foot {
  background: #1e293b;
  border-top-color: rgb(255 255 255 / 8%);
}

.wn-seeall {
  background: #fff;
  border: 1.5px solid rgb(241 93 34 / 25%);
  border-radius: 0.875rem;
  color: #f15d22;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 700;
  padding: 0.6875rem 1.125rem;
  transition: background 0.15s;
  width: 100%;
}

.wn-seeall:hover {
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
}

:global(.dark) .wn-seeall {
  background: transparent;
}

.wn-tagline {
  color: rgb(44 62 80 / 30%);
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-style: italic;
  letter-spacing: 0.06em;
  margin-top: 0.6875rem;
}

:global(.dark) .wn-tagline {
  color: rgb(226 232 240 / 30%);
}
</style>
