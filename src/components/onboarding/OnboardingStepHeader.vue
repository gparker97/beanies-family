<script setup lang="ts">
import OnboardingProgressPips from './OnboardingProgressPips.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

defineProps<{
  /** Hero emoji shown above the title (e.g. "🐷"). */
  icon: string;
  /** i18n key for the leading part of the title — usually ends with a trailing space. */
  titlePrefixKey: UIStringKey;
  /** i18n key for the heritage-orange highlighted part of the title. */
  titleHighlightKey: UIStringKey;
  /** 1-indexed current step in the wizard (1-6). */
  currentStep: number;
  /** Total step count (6 for onboarding-v2). */
  totalSteps: number;
}>();

const { t } = useTranslation();
</script>

<template>
  <!--
    Layout: pips at top center → emoji centered → title (prefix + highlight)
    centered. Mockup-approved structure; clear "you are here" feedback at the
    very top of every data-entry step.
  -->
  <div class="ob-step-header">
    <div class="ob-step-pips-wrap">
      <OnboardingProgressPips :current="currentStep" :total="totalSteps" />
    </div>
    <div class="ob-step-emoji">{{ icon }}</div>
    <h2 class="ob-step-title">
      {{ t(titlePrefixKey) }}<span class="text-heritage-orange">{{ t(titleHighlightKey) }}</span>
    </h2>
  </div>
</template>

<style scoped>
.ob-step-header {
  margin-bottom: 20px;
  position: relative;
  text-align: center;
  z-index: 1;
}

.ob-step-pips-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 14px;
}

.ob-step-emoji {
  font-size: 2.375rem;
  line-height: 1;
  margin-bottom: 4px;
}

.ob-step-title {
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 1.375rem;
  font-weight: 800;
  letter-spacing: -0.012em;
  margin: 0;
}

.dark .ob-step-title {
  color: #f1f5f9;
}
</style>
