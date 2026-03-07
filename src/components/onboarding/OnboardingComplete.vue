<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  accountCount: number;
  recurringCount: number;
  savingsPercent: number;
  activityCount: number;
}>();

const emit = defineEmits<{
  finish: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="ob-complete">
    <!-- Decorative floating emoji -->
    <div class="ob-float-emoji ob-float-party">🎉</div>
    <div class="ob-float-emoji ob-float-star">🌟</div>
    <div class="ob-float-emoji ob-float-bean">🥫</div>

    <div class="relative z-[1]">
      <!-- Hero emoji -->
      <div class="ob-hero-emoji ob-float-anim">👨‍👩‍👧‍👦</div>

      <!-- Title -->
      <h2 class="ob-title">
        {{ t('onboarding.completePrefix') }}
        <span class="text-heritage-orange">{{ t('onboarding.completeHighlight') }}</span>
        {{ t('onboarding.completeSuffix') }}
      </h2>

      <!-- Description -->
      <p class="ob-description">
        {{ t('onboarding.completeDescription') }}
      </p>

      <!-- Summary cards -->
      <div class="ob-summary-cards">
        <div class="ob-summary-card">
          <div class="text-xl sm:text-2xl">🏦</div>
          <div class="ob-summary-value">{{ accountCount }}</div>
          <div class="ob-summary-label">{{ t('onboarding.summaryAccount') }}</div>
        </div>
        <div class="ob-summary-card">
          <div class="text-xl sm:text-2xl">🔄</div>
          <div class="ob-summary-value">{{ recurringCount }}</div>
          <div class="ob-summary-label">{{ t('onboarding.summaryRecurring') }}</div>
        </div>
        <div class="ob-summary-card">
          <div class="text-xl sm:text-2xl">🎯</div>
          <div class="ob-summary-value text-heritage-orange">{{ savingsPercent }}%</div>
          <div class="ob-summary-label">{{ t('onboarding.summarySavings') }}</div>
        </div>
        <div class="ob-summary-card">
          <div class="text-xl sm:text-2xl">🎹</div>
          <div class="ob-summary-value">{{ activityCount }}</div>
          <div class="ob-summary-label">{{ t('onboarding.summaryActivity') }}</div>
        </div>
      </div>

      <!-- CTA -->
      <button class="ob-cta ob-pulse-glow" data-testid="onboarding-finish" @click="emit('finish')">
        {{ t('onboarding.completeCta') }}
      </button>

      <!-- Subtitle -->
      <p class="ob-subtitle">
        {{ t('onboarding.completeSubtitle') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ob-complete {
  align-items: center;
  background: linear-gradient(180deg, #edf6fc 0%, var(--cloud-white, #f8f9fa) 50%, #fef8f4 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  overflow: hidden;
  padding: 32px 20px;
  position: relative;
  text-align: center;
}

.dark .ob-complete {
  background: linear-gradient(180deg, #1e3040 0%, #1a252f 50%, #261e18 100%);
}

.ob-complete::before {
  background: radial-gradient(circle, rgb(174 214 241 / 20%), transparent 70%);
  border-radius: 50%;
  content: '';
  height: 500px;
  left: 50%;
  position: absolute;
  top: -100px;
  transform: translateX(-50%);
  width: 500px;
}

.ob-complete::after {
  background: radial-gradient(circle, rgb(241 93 34 / 8%), transparent 70%);
  border-radius: 50%;
  bottom: -60px;
  content: '';
  height: 300px;
  position: absolute;
  right: -60px;
  width: 300px;
}

.ob-float-emoji {
  position: absolute;
  z-index: 0;
}

.ob-float-party {
  font-size: 1.2rem;
  left: 15%;
  opacity: 0.15;
  top: 30px;
}

.ob-float-star {
  font-size: 1rem;
  opacity: 0.1;
  right: 12%;
  top: 80px;
}

.ob-float-bean {
  bottom: 100px;
  font-size: 1.3rem;
  left: 10%;
  opacity: 0.15;
}

@media (prefers-reduced-motion: no-preference) {
  .ob-float-party {
    animation: ob-float 4s ease-in-out infinite;
  }

  .ob-float-star {
    animation: ob-float 5s ease-in-out 1s infinite;
  }

  .ob-float-bean {
    animation: ob-float 4.5s ease-in-out 0.5s infinite;
  }

  .ob-float-anim {
    animation: ob-float 4s ease-in-out infinite;
  }
}

@media (width >= 640px) {
  .ob-float-party {
    font-size: 1.5rem;
    opacity: 0.2;
  }

  .ob-float-star {
    font-size: 1.2rem;
    opacity: 0.15;
  }
}

.ob-hero-emoji {
  font-size: 72px;
  margin-bottom: 16px;
}

@media (width >= 640px) {
  .ob-hero-emoji {
    font-size: 100px;
    margin-bottom: 20px;
  }
}

.ob-title {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 1.5rem;
  font-weight: 800;
  margin-bottom: 6px;
}

.dark .ob-title {
  color: #f1f5f9;
}

@media (width >= 640px) {
  .ob-title {
    font-size: 2.2rem;
    margin-bottom: 8px;
  }
}

.ob-description {
  color: var(--deep-slate, #2c3e50);
  font-size: 0.78rem;
  line-height: 1.6;
  margin: 0 auto 20px;
  max-width: 400px;
  opacity: 0.5;
}

.dark .ob-description {
  color: #cbd5e1;
}

@media (width >= 640px) {
  .ob-description {
    font-size: 0.95rem;
    margin: 0 auto 28px;
  }
}

.ob-summary-cards {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 24px;
}

@media (width >= 640px) {
  .ob-summary-cards {
    display: flex;
    gap: 14px;
    justify-content: center;
    margin-bottom: 32px;
  }
}

.ob-summary-card {
  background: white;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgb(44 62 80 / 5%);
  padding: 12px;
  text-align: center;
}

.dark .ob-summary-card {
  background: #243342;
  box-shadow: 0 2px 12px rgb(0 0 0 / 20%);
}

@media (width >= 640px) {
  .ob-summary-card {
    border-radius: 16px;
    box-shadow: 0 4px 20px rgb(44 62 80 / 6%);
    padding: 14px 22px;
  }
}

.ob-summary-value {
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 800;
}

@media (width >= 640px) {
  .ob-summary-value {
    font-size: 1rem;
  }
}

.ob-summary-label {
  font-family: Outfit, sans-serif;
  font-size: 0.5rem;
  font-weight: 600;
  opacity: 0.4;
}

@media (width >= 640px) {
  .ob-summary-label {
    font-size: 0.58rem;
  }
}

.ob-cta {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border: none;
  border-radius: 60px;
  box-shadow: 0 8px 32px rgb(241 93 34 / 25%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 14px 40px;
  transition: transform 0.2s;
}

.ob-cta:hover {
  transform: translateY(-2px);
}

@media (width >= 640px) {
  .ob-cta {
    font-size: 1.05rem;
    padding: 16px 52px;
  }
}

.ob-subtitle {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.62rem;
  font-style: italic;
  margin-top: 16px;
  opacity: 0.3;
}

.dark .ob-subtitle {
  color: #94a3b8;
}

@media (width >= 640px) {
  .ob-subtitle {
    font-size: 0.72rem;
    margin-top: 20px;
  }
}

@keyframes ob-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-8px);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .ob-pulse-glow {
    animation: ob-pulse-glow 3s ease-in-out infinite;
  }
}

@keyframes ob-pulse-glow {
  0%,
  100% {
    box-shadow: 0 8px 32px rgb(241 93 34 / 25%);
  }

  50% {
    box-shadow:
      0 8px 32px rgb(241 93 34 / 25%),
      0 0 20px 8px rgb(241 93 34 / 10%);
  }
}
</style>
