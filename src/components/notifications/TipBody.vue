<script setup lang="ts">
/**
 * Tip detail body — the rich content shown when a tip notification is opened
 * in the drawer. Lifts the inner content of the deleted `BeanTipCard.vue`
 * (floating beanie character + category-tinted backdrop + tip message +
 * try-it / got-it / don't-show-tips actions) so the bell preserves the tip's
 * personality even though the closed row is intentionally subtle.
 *
 * Resolution: consumes `tip` from `useNotificationPresentation` — no second
 * `getTip()` call site. When the tip has been removed from `tips.ts` since
 * issuance, renders a quiet "no longer available" fallback (matches the
 * deriver's missing-tip skip discipline — never throws).
 *
 * UX contract:
 *   - "got it" → close drawer (markRead already happened on open via openTo).
 *   - "try it →" → router push + close drawer.
 *   - "don't show tips" → muteAllTips() + success toast + close drawer.
 */
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useNotificationPresentation } from '@/composables/useNotificationPresentation';
import { useBeanTips } from '@/composables/useBeanTips';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { showToast } from '@/composables/useToast';
import { getCategoryImage } from '@/content/tips';
import type { AppNotification } from '@/types/notifications';

const props = defineProps<{ notification: AppNotification }>();

const router = useRouter();
const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();
const { tip } = useNotificationPresentation(() => props.notification);
const beanTips = useBeanTips();

function handleTryIt() {
  if (!props.notification.route) return;
  store.close();
  router.push({ path: props.notification.route, query: props.notification.query });
}

function handleGotIt() {
  // markRead already happened on `openTo`; just dismiss the drawer.
  store.back();
}

function handleMute() {
  beanTips.muteAllTips();
  // Drawer dismissal mirrors the "got it" path — tips no longer show going
  // forward but the history remains in the bell.
  store.back();
  showToast('success', t('tips.mutedConfirm'), undefined, { durationMs: 4000 });
}
</script>

<template>
  <!-- Resolved tip — the rich content -->
  <div v-if="tip" class="beanie-tip" :class="`cat-${tip.category}`" role="complementary">
    <!-- Accent stripe (::before) + dot pattern (::after) via CSS -->
    <div class="beanie-tip-inner">
      <!-- Floating beanie character -->
      <div class="beanie-tip-character">
        <img :src="getCategoryImage(tip.category)" alt="" class="beanie-tip-img" />
      </div>

      <!-- Content -->
      <div class="beanie-tip-content">
        <!-- Header: kicker -->
        <div class="beanie-tip-header">
          <div class="beanie-tip-label">
            <span class="beanie-tip-bulb">💡</span>
            <span
              class="font-outfit text-primary-500 dark:text-accent-lift text-xs font-bold tracking-[0.04em]"
            >
              {{ t('tips.label') }}
            </span>
          </div>
        </div>

        <!-- Message -->
        <p class="text-secondary-500/75 dark:text-ink-soft text-sm leading-relaxed">
          {{ txt(tip.message) }}
        </p>

        <!-- Actions -->
        <div class="mt-3 flex flex-wrap items-center justify-end gap-2.5">
          <button class="beanie-tip-mute" @click="handleMute">
            {{ t('tips.dontShowTips') }}
          </button>
          <button v-if="notification.route" class="beanie-tip-tryit" @click="handleTryIt">
            {{ t('tips.tryIt') }}
            <span class="beanie-tip-tryit-arrow">→</span>
          </button>
          <button class="beanie-tip-gotit" @click="handleGotIt">
            {{ t('tips.gotIt') }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Missing-tip fallback — tip was removed from tips.ts since issuance. -->
  <!-- The deriver already console.warned the skip; no second log here. -->
  <div v-else class="tip-missing space-y-4">
    <p class="text-secondary-500/70 dark:text-ink-soft text-sm">
      {{ t('tips.unavailable') }}
    </p>
    <button class="beanie-tip-gotit" @click="handleGotIt">
      {{ t('tips.gotIt') }}
    </button>
  </div>
</template>

<style scoped>
/* ───── Card ───── */
.beanie-tip {
  animation: tip-fade-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  background: linear-gradient(135deg, #fef8f4 0%, #fdf2eb 40%, #f8f0f8 100%);
  border-radius: 24px;
  box-shadow:
    0 6px 28px rgb(241 93 34 / 8%),
    0 2px 8px rgb(44 62 80 / 4%);
  overflow: hidden;
  position: relative;
}

.beanie-tip::before {
  background: linear-gradient(
    90deg,
    var(--sky-silk, #aed6f1),
    var(--heritage-orange, #f15d22) 50%,
    var(--terracotta, #e67e22)
  );
  content: '';
  height: 3px;
  left: 0;
  opacity: 0.6;
  position: absolute;
  right: 0;
  top: 0;
}

.beanie-tip::after {
  background: radial-gradient(circle, rgb(174 214 241 / 12%) 1px, transparent 1px);
  background-size: 16px 16px;
  content: '';
  height: 100%;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  width: 180px;
}

/* ───── Category variants ───── */
.cat-finance {
  background: linear-gradient(135deg, #fef8f4 0%, #fdf2eb 100%);
}

.cat-finance::before {
  background: linear-gradient(90deg, #f15d22, #e67e22, #f15d22);
}

.cat-family {
  background: linear-gradient(135deg, #f6fbfe 0%, #edf5fc 100%);
}

.cat-family::before {
  background: linear-gradient(90deg, #aed6f1, #85c1e9, #aed6f1);
}

.cat-security {
  background: linear-gradient(135deg, #f4f6f8 0%, #edf0f3 100%);
}

.cat-security::before {
  background: linear-gradient(90deg, #2c3e50, #34495e, #2c3e50);
}

.cat-planner {
  background: linear-gradient(135deg, #faf6fc 0%, #f3ecf8 100%);
}

.cat-planner::before {
  background: linear-gradient(90deg, #9b59b6, #8e44ad, #9b59b6);
}

/* ───── Dark mode (card-level) ───── */
html.dark .beanie-tip {
  background: linear-gradient(135deg, #2a3845 0%, #263240 40%, #2d2f3d 100%);
  box-shadow: 0 6px 28px rgb(0 0 0 / 20%);
}

html.dark .beanie-tip::after {
  background: radial-gradient(circle, rgb(174 214 241 / 5%) 1px, transparent 1px);
  background-size: 16px 16px;
}

/* ───── Animations ───── */
@keyframes tip-fade-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes beanie-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4px);
  }
}

@keyframes bulb-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
}

/* ───── Inner layout ───── */
.beanie-tip-inner {
  align-items: flex-start;
  display: flex;
  padding: 20px 22px 18px;
  position: relative;
  z-index: 1;
}

.beanie-tip-character {
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  margin-right: 16px;
  margin-top: 2px;
  width: 72px;
}

.beanie-tip-img {
  animation: beanie-float 3s ease-in-out infinite;
  filter: drop-shadow(0 4px 8px rgb(44 62 80 / 10%));
  height: 64px;
  object-fit: contain;
  width: 64px;
}

.beanie-tip-content {
  flex: 1;
  min-width: 0;
}

.beanie-tip-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.beanie-tip-label {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.beanie-tip-bulb {
  animation: bulb-pulse 2s ease-in-out infinite;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative emoji animation */
  font-size: 15px;
}

/* ───── Action buttons ───── */
.beanie-tip-mute {
  background: transparent;
  border: none;
  color: rgb(156 163 175 / 60%);
  cursor: pointer;
  font-family: Inter, sans-serif;
  font-size: 0.6875rem;
  transition: opacity 0.15s;
}

.beanie-tip-mute:hover {
  opacity: 0.85;
}

html.dark .beanie-tip-mute {
  color: #9aa9b4;
}

.beanie-tip-tryit {
  align-items: center;
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border: none;
  border-radius: 10px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 4px;
  padding: 6px 14px;
  transition: all 0.15s;
  white-space: nowrap;
}

.beanie-tip-tryit:hover {
  background: var(--tint-orange-15, rgb(241 93 34 / 15%));
}

.beanie-tip-tryit-arrow {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative arrow glyph paired with adjacent button text */
  font-size: 12px;
  transition: transform 0.15s;
}

.beanie-tip-tryit:hover .beanie-tip-tryit-arrow {
  transform: translateX(2px);
}

.beanie-tip-gotit {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border: none;
  border-radius: 14px;
  box-shadow: 0 3px 12px rgb(241 93 34 / 20%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 8px 22px;
  transition: all 0.2s;
}

.beanie-tip-gotit:hover {
  box-shadow: 0 5px 18px rgb(241 93 34 / 30%);
  transform: translateY(-1px);
}

html.dark .beanie-tip-tryit {
  background: rgb(241 93 34 / 10%);
  color: #f15d22;
}

html.dark .beanie-tip-tryit:hover {
  background: rgb(241 93 34 / 18%);
}

/* ───── Missing-tip fallback ───── */
.tip-missing {
  padding: 1rem 0.25rem;
  text-align: center;
}

.tip-missing .beanie-tip-gotit {
  margin: 0 auto;
}

html.dark .beanie-tip-gotit {
  box-shadow: 0 3px 12px rgb(241 93 34 / 15%);
}

/* ───── Reduced motion ───── */
@media (prefers-reduced-motion: reduce) {
  .beanie-tip {
    animation: none;
  }

  .beanie-tip-img {
    animation: none;
  }

  .beanie-tip-bulb {
    animation: none;
  }
}
</style>
