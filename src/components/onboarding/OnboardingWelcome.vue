<script setup lang="ts">
import { ref } from 'vue';
import OnboardingProgressPips from './OnboardingProgressPips.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useTranslation } from '@/composables/useTranslation';
import type { CurrencyCode } from '@/types/models';

const emit = defineEmits<{
  next: [];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();

const selectedCurrency = ref<string>(settingsStore.baseCurrency);

async function handleStart() {
  await settingsStore.setBaseCurrency(selectedCurrency.value as CurrencyCode);
  emit('next');
}
</script>

<template>
  <div class="ob-welcome">
    <!-- Decorative floating emoji -->
    <div class="ob-float-emoji ob-float-bean">🥫</div>
    <div class="ob-float-emoji ob-float-piggy">🐷</div>
    <div class="ob-float-emoji ob-float-tree">🌳</div>

    <!-- Hero image -->
    <img
      src="/brand/beanies_family_hugging_transparent_512x512.png"
      alt="beanies family hugging"
      class="ob-hero-img ob-float-anim"
    />

    <!-- Title -->
    <h2 class="ob-title">
      {{ t('onboarding.welcomePrefix') }}
      <span class="text-heritage-orange">{{ t('onboarding.welcomeBrand') }}</span
      >.family
    </h2>

    <!-- Description -->
    <p class="ob-description">
      {{ t('onboarding.welcomeDescription') }}
    </p>

    <!-- Three pillar cards -->
    <div class="ob-pillars">
      <div class="ob-pillar-card">
        <div class="text-xl sm:text-2xl">🐷</div>
        <div class="ob-pillar-label">
          <span class="hidden sm:inline">{{ t('onboarding.pillarMoney') }}</span>
          <span class="sm:hidden">{{ t('onboarding.pillarMoneyShort') }}</span>
        </div>
      </div>
      <div class="ob-pillar-card">
        <div class="text-xl sm:text-2xl">📅</div>
        <div class="ob-pillar-label">
          <span class="hidden sm:inline">{{ t('onboarding.pillarPlan') }}</span>
          <span class="sm:hidden">{{ t('onboarding.pillarPlanShort') }}</span>
        </div>
      </div>
      <div class="ob-pillar-card">
        <div class="text-xl sm:text-2xl">🌳</div>
        <div class="ob-pillar-label">
          <span class="hidden sm:inline">{{ t('onboarding.pillarFamily') }}</span>
          <span class="sm:hidden">{{ t('onboarding.pillarFamilyShort') }}</span>
        </div>
      </div>
    </div>

    <!-- Currency question -->
    <div class="ob-currency-question">
      <div class="ob-currency-label">{{ t('onboarding.currencyQuestion') }}</div>
      <div class="relative inline-block">
        <select
          v-model="selectedCurrency"
          class="ob-currency-select"
          data-testid="onboarding-currency-select"
        >
          <option
            v-for="opt in currencyOptions"
            :key="opt.value"
            :value="opt.value"
            :disabled="opt.disabled"
          >
            {{ opt.label }}
          </option>
        </select>
        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
          <svg class="h-3.5 w-3.5 opacity-35" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    </div>

    <!-- Progress dots -->
    <div class="mb-8 sm:mb-10">
      <OnboardingProgressPips :current="1" :total="3" />
    </div>

    <!-- CTA -->
    <button class="ob-cta ob-pulse-glow" data-testid="onboarding-start" @click="handleStart">
      {{ t('onboarding.welcomeCta') }}
    </button>

    <!-- Subtitle -->
    <p class="ob-subtitle">
      {{ t('onboarding.welcomeSubtitle') }}
    </p>
  </div>
</template>

<style scoped>
.ob-welcome {
  align-items: center;
  background: linear-gradient(180deg, var(--cloud-white, #f8f9fa) 0%, #edf6fc 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  overflow: hidden;
  padding: 32px 24px;
  position: relative;
  text-align: center;
}

.dark .ob-welcome {
  background: linear-gradient(180deg, #1a252f 0%, #1e3040 100%);
}

.ob-welcome::before {
  background: radial-gradient(circle, rgb(174 214 241 / 25%), transparent 70%);
  border-radius: 50%;
  bottom: -100px;
  content: '';
  height: 400px;
  left: -100px;
  position: absolute;
  width: 400px;
}

.ob-welcome::after {
  background: radial-gradient(circle, rgb(241 93 34 / 10%), transparent 70%);
  border-radius: 50%;
  content: '';
  height: 300px;
  position: absolute;
  right: -60px;
  top: -60px;
  width: 300px;
}

.ob-float-emoji {
  opacity: 0.12;
  position: absolute;
  z-index: 0;
}

.ob-float-bean {
  font-size: 2rem;
  left: 60px;
  top: 40px;
}

.ob-float-piggy {
  font-size: 1.5rem;
  right: 80px;
  top: 120px;
}

.ob-float-tree {
  bottom: 80px;
  font-size: 1.8rem;
  left: 120px;
}

@media (prefers-reduced-motion: no-preference) {
  .ob-float-bean {
    animation: ob-float 5s ease-in-out infinite;
  }

  .ob-float-piggy {
    animation: ob-float 6s ease-in-out 1s infinite;
  }

  .ob-float-tree {
    animation: ob-float 4.5s ease-in-out 0.5s infinite;
  }

  .ob-float-anim {
    animation: ob-float 4s ease-in-out infinite;
  }
}

.ob-hero-img {
  height: 160px;
  margin-bottom: 24px;
  position: relative;
  width: 160px;
  z-index: 1;
}

@media (width >= 640px) {
  .ob-hero-img {
    height: 220px;
    margin-bottom: 32px;
    width: 220px;
  }

  .ob-float-bean {
    font-size: 2rem;
  }
}

.ob-title {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 1.4rem;
  font-weight: 800;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.dark .ob-title {
  color: #f1f5f9;
}

@media (width >= 640px) {
  .ob-title {
    font-size: 2rem;
    margin-bottom: 12px;
  }
}

.ob-description {
  color: var(--deep-slate, #2c3e50);
  font-size: 0.8rem;
  line-height: 1.6;
  margin-bottom: 28px;
  max-width: 400px;
  opacity: 0.5;
  position: relative;
  z-index: 1;
}

.dark .ob-description {
  color: #cbd5e1;
}

@media (width >= 640px) {
  .ob-description {
    font-size: 0.95rem;
    margin-bottom: 40px;
  }
}

.ob-pillars {
  display: flex;
  gap: 10px;
  margin-bottom: 28px;
  position: relative;
  z-index: 1;
}

@media (width >= 640px) {
  .ob-pillars {
    gap: 16px;
    margin-bottom: 36px;
  }
}

.ob-pillar-card {
  background: white;
  border-radius: 14px;
  box-shadow: 0 2px 10px rgb(44 62 80 / 5%);
  padding: 10px 14px;
  text-align: center;
}

.dark .ob-pillar-card {
  background: #243342;
  box-shadow: 0 2px 10px rgb(0 0 0 / 20%);
}

@media (width >= 640px) {
  .ob-pillar-card {
    border-radius: 16px;
    box-shadow: 0 4px 16px rgb(44 62 80 / 6%);
    padding: 12px 20px;
  }
}

.ob-pillar-label {
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  margin-top: 3px;
  opacity: 0.5;
}

@media (width >= 640px) {
  .ob-pillar-label {
    font-size: 0.65rem;
    margin-top: 4px;
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
  font-size: 0.85rem;
  font-weight: 600;
  padding: 14px 36px;
  position: relative;
  transition: transform 0.2s;
  z-index: 1;
}

.ob-cta:hover {
  transform: translateY(-2px);
}

@media (width >= 640px) {
  .ob-cta {
    font-size: 1rem;
    padding: 16px 48px;
  }
}

.ob-subtitle {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.62rem;
  font-style: italic;
  margin-top: 16px;
  opacity: 0.3;
  position: relative;
  z-index: 1;
}

.dark .ob-subtitle {
  color: #94a3b8;
}

@media (width >= 640px) {
  .ob-subtitle {
    font-size: 0.7rem;
    margin-top: 24px;
  }
}

.ob-currency-question {
  margin-bottom: 28px;
  position: relative;
  z-index: 1;
}

@media (width >= 640px) {
  .ob-currency-question {
    margin-bottom: 36px;
  }
}

.ob-currency-label {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  margin-bottom: 8px;
  opacity: 0.5;
}

.dark .ob-currency-label {
  color: #cbd5e1;
}

@media (width >= 640px) {
  .ob-currency-label {
    font-size: 0.8rem;
  }
}

.ob-currency-select {
  appearance: none;
  background: white;
  border: 2px solid rgb(44 62 80 / 8%);
  border-radius: 16px;
  box-shadow: 0 2px 10px rgb(44 62 80 / 5%);
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  min-width: 200px;
  padding: 10px 36px 10px 16px;
  transition: all 0.2s;
}

.ob-currency-select:focus {
  border-color: var(--heritage-orange, #f15d22);
  box-shadow: 0 0 0 3px rgb(241 93 34 / 10%);
  outline: none;
}

.dark .ob-currency-select {
  background: #243342;
  border-color: rgb(255 255 255 / 8%);
  box-shadow: 0 2px 10px rgb(0 0 0 / 20%);
  color: #f1f5f9;
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
