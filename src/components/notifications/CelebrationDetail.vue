<script setup lang="ts">
/**
 * Shared "celebration" detail shell — the warm, full-height frame used by both
 * the what's-new note and adhoc announcements: a gradient hero with the beanies
 * medallion + sparkles, the white body emerging beneath with a rounded top (the
 * "unwrapping" feel), the Pod divider, greg's handwritten Caveat sign-off, and a
 * bordered footer. Extracted from `WhatsNewBody` so neither body duplicates the
 * scaffold (DRY).
 *
 * Slots: `kick` (the hero kicker line, inside `.wn-kick`), default (the content
 * region between the hero and the Pod), `footer` (inside the bordered `.wn-foot`,
 * BELOW the shared "Done" close button this shell always renders).
 *
 * The footer's primary action is a "Done" button that closes the panel — the
 * common intent for a celebratory note. It lives here (not in each body) so
 * every celebration detail gets a clear, thumb-reachable dismiss without relying
 * on the side-panel's corner ✕; per-body footer actions (e.g. "see all updates")
 * render beneath it as quiet secondary links.
 *
 * Layout note: it breaks out of `BaseSidePanel`'s `p-6` body via `-mx-6 -my-6`
 * (the house pattern, cf. BeanieFormModal) so the hero is full-bleed; the
 * `min-h-[calc(100%+3rem)]` reclaims that 3rem so the column fills the panel and
 * the footer pins to the bottom.
 */
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';

const CELEBRATING_MEDALLION = '/brand/beanies_celebrating_circle_transparent_400x400.png';

const store = useNotificationsStore();
const { t } = useTranslation();

withDefaults(
  defineProps<{
    /** Hero date pill (e.g. '28 may 2026'). */
    dateLabel: string;
    /** Hero medallion image; defaults to the celebrating beanies. */
    medallionSrc?: string;
    /** Caveat sign-off; defaults to greg's line. */
    signature?: string;
  }>(),
  { medallionSrc: CELEBRATING_MEDALLION, signature: '— greg, head beanie developer 🫘' }
);
</script>

<template>
  <div class="wn-detail -mx-6 -my-6 flex min-h-[calc(100%+3rem)] flex-col">
    <!-- ===== HERO ===== -->
    <div class="wn-hero">
      <span class="hspark a" aria-hidden="true">✦</span>
      <span class="hspark b" aria-hidden="true">✨</span>
      <span class="hspark c" aria-hidden="true">✦</span>
      <div class="wn-medallion">
        <img :src="medallionSrc" alt="" />
      </div>
      <div class="wn-kick"><slot name="kick" /></div>
      <div v-if="dateLabel" class="wn-datepill">{{ dateLabel }}</div>
    </div>

    <!-- ===== CONTENT ===== -->
    <div class="wn-content">
      <div class="wn-region"><slot /></div>

      <!-- The Pod (slate · terracotta · orange · sky — never reordered) -->
      <div class="wn-pod" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="wn-sign">{{ signature }}</div>
    </div>

    <!-- ===== FOOTER ===== -->
    <div class="wn-foot">
      <button type="button" class="wn-done" @click="store.close()">
        <span class="wn-done-spark" aria-hidden="true">✨</span>{{ t('action.done') }}
      </button>
      <slot name="footer" />
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

/* The region is a flex column so slotted content can top-align (a list) or
   centre itself (a single short message uses `margin: auto`). */
.wn-region {
  display: flex;
  flex: 1;
  flex-direction: column;
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

/* Primary close — the celebration CTA style (matches the announcement CTA) */
.wn-done {
  align-items: center;
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border: none;
  border-radius: 1rem;
  box-shadow: 0 4px 14px rgb(241 93 34 / 28%);
  color: #fff;
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  gap: 0.4375rem;
  justify-content: center;
  padding: 0.8125rem 1.125rem;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  width: 100%;
}

.wn-done:hover {
  box-shadow: 0 6px 18px rgb(241 93 34 / 36%);
  transform: translateY(-1px);
}

.wn-done-spark {
  font-size: 0.9375rem;
}

/* Any secondary footer action (slotted below Done) sits a little apart */
.wn-foot :slotted(*) {
  margin-top: 0.75rem;
}
</style>
