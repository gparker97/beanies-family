<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useBeanTips } from '@/composables/useBeanTips';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { getCategoryImage } from '@/content/tips';

const router = useRouter();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { currentTip, isDismissing, dismissTip, muteAllTips } = useBeanTips();

const tip = computed(() => currentTip.value);
const categoryClass = computed(() => (tip.value ? `cat-${tip.value.category}` : ''));
const characterSrc = computed(() => (tip.value ? getCategoryImage(tip.value.category) : ''));
const message = computed(() => {
  if (!tip.value) return '';
  return settingsStore.beanieMode ? tip.value.message.beanie : tip.value.message.en;
});

function handleGotIt() {
  if (tip.value) dismissTip(tip.value.id);
}

function handleTryIt() {
  if (!tip.value?.tryItRoute) return;
  const route = tip.value.tryItRoute;
  dismissTip(tip.value.id);
  // Navigate after dismiss animation
  setTimeout(() => router.push(route), 360);
}

function handleMute() {
  muteAllTips();
}
</script>

<template>
  <div
    v-if="tip"
    class="beanie-tip"
    :class="[categoryClass, { dismissing: isDismissing }]"
    role="complementary"
    :aria-label="t('tips.label')"
  >
    <!-- Accent stripe (::before) and dot pattern (::after) via CSS -->
    <div class="beanie-tip-inner">
      <!-- Character image -->
      <div class="beanie-tip-character">
        <img :src="characterSrc" alt="" class="beanie-tip-img" />
      </div>

      <!-- Content -->
      <div class="beanie-tip-content">
        <!-- Header: label + close -->
        <div class="beanie-tip-header">
          <div class="beanie-tip-label">
            <span class="beanie-tip-bulb">💡</span>
            <span class="font-outfit text-primary-500 text-xs font-bold tracking-[0.04em]">
              {{ t('tips.label') }}
            </span>
          </div>
          <button class="beanie-tip-close" :aria-label="t('tips.gotIt')" @click="handleGotIt">
            ✕
          </button>
        </div>

        <!-- Message -->
        <p class="text-secondary-500/75 text-sm leading-relaxed dark:text-gray-300/80">
          {{ message }}
        </p>

        <!-- Actions -->
        <div class="mt-3 flex items-center justify-end gap-2.5">
          <button
            class="text-[11px] text-gray-400/35 transition-opacity hover:opacity-65 dark:text-gray-500/40"
            @click="handleMute"
          >
            {{ t('tips.dontShowTips') }}
          </button>
          <button v-if="tip.tryItRoute" class="beanie-tip-tryit" @click="handleTryIt">
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

/* Accent stripe */
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

/* Dot pattern */
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
:global(.dark) .beanie-tip {
  background: linear-gradient(135deg, #2a3845 0%, #263240 40%, #2d2f3d 100%);
  box-shadow: 0 6px 28px rgb(0 0 0 / 20%);
}

:global(.dark) .beanie-tip::after {
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

.dismissing {
  animation: tip-dismiss 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards;
}

@keyframes tip-dismiss {
  from {
    max-height: 300px;
    opacity: 1;
    transform: translateY(0);
  }

  to {
    margin-bottom: -20px;
    max-height: 0;
    opacity: 0;
    padding: 0;
    transform: translateY(-8px);
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
  font-size: 15px;
}

.beanie-tip-close {
  align-items: center;
  background: rgb(44 62 80 / 4%);
  border: none;
  border-radius: 8px;
  color: #6b7b8d;
  cursor: pointer;
  display: flex;
  font-size: 13px;
  height: 26px;
  justify-content: center;
  opacity: 0.4;
  transition: all 0.15s;
  width: 26px;
}

.beanie-tip-close:hover {
  background: rgb(44 62 80 / 8%);
  opacity: 0.8;
}

/* ───── Action buttons ───── */
.beanie-tip-tryit {
  align-items: center;
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border: none;
  border-radius: 10px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 12px;
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
  font-size: 13px;
  font-weight: 600;
  padding: 8px 22px;
  transition: all 0.2s;
}

.beanie-tip-gotit:hover {
  box-shadow: 0 5px 18px rgb(241 93 34 / 30%);
  transform: translateY(-1px);
}

/* ───── Dark mode (interactive elements) ───── */
:global(.dark) .beanie-tip-close {
  background: rgb(255 255 255 / 5%);
  color: rgb(255 255 255 / 35%);
}

:global(.dark) .beanie-tip-close:hover {
  background: rgb(255 255 255 / 8%);
}

:global(.dark) .beanie-tip-tryit {
  background: rgb(241 93 34 / 10%);
  color: #f15d22;
}

:global(.dark) .beanie-tip-tryit:hover {
  background: rgb(241 93 34 / 18%);
}

:global(.dark) .beanie-tip-gotit {
  box-shadow: 0 3px 12px rgb(241 93 34 / 15%);
}

/* ───── Reduced motion ───── */
@media (prefers-reduced-motion: reduce) {
  .beanie-tip,
  .dismissing {
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
