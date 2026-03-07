<script setup lang="ts">
import OnboardingProgressPips from './OnboardingProgressPips.vue';

defineProps<{
  icon: string;
  iconBg: string;
  stepLabel: string;
  titlePrefix: string;
  titleHighlight: string;
  currentStep: number;
  totalSteps: number;
}>();
</script>

<template>
  <div class="ob-header">
    <div class="flex items-center gap-2.5">
      <div
        class="flex h-10 w-10 items-center justify-center text-xl"
        :style="{ background: iconBg, borderRadius: '14px' }"
      >
        {{ icon }}
      </div>
      <div>
        <div class="font-heading text-xs font-semibold tracking-widest uppercase opacity-40">
          {{ stepLabel }}
        </div>
        <div class="font-heading text-deep-slate mt-0.5 text-lg font-extrabold dark:text-gray-100">
          {{ titlePrefix }}
          <span class="text-heritage-orange">{{ titleHighlight }}</span>
        </div>
      </div>
    </div>
    <OnboardingProgressPips :current="currentStep" :total="totalSteps" />
  </div>
</template>

<style scoped>
.ob-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 24px;
  position: relative;
  z-index: 1;
}
</style>
