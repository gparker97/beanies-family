<script setup lang="ts">
import { useRouter } from 'vue-router';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { useReducedMotion } from '@/composables/useReducedMotion';

const router = useRouter();
const { t } = useTranslation();
const prefersReducedMotion = useReducedMotion();

function goHome() {
  router.push('/dashboard');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-[#FDFBF9] p-6 dark:bg-[#1a252f]">
    <div class="max-w-md text-center">
      <!-- Lost beanie illustration -->
      <div class="relative mx-auto mb-8 h-56 w-56">
        <!-- Background circle -->
        <div class="absolute inset-0 rounded-full bg-orange-50 dark:bg-[#2C3E50]" />

        <!-- SVG beanie illustration -->
        <svg
          viewBox="0 0 200 200"
          class="relative h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="A confused beanie character looking lost"
        >
          <!-- Ground shadow -->
          <ellipse cx="100" cy="168" rx="50" ry="8" fill="#AED6F1" opacity="0.3" />

          <!-- Parent bean (blue) - looking around confused -->
          <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
            <!-- Bean body -->
            <ellipse cx="85" cy="120" rx="28" ry="36" fill="#AED6F1" />
            <ellipse cx="85" cy="120" rx="28" ry="36" fill="url(#beanSheen)" opacity="0.4" />

            <!-- Left eye (looking left - confused) -->
            <ellipse cx="76" cy="110" rx="4" ry="5" fill="#2C3E50" />
            <circle cx="75" cy="109" r="1.5" fill="white" opacity="0.7" />

            <!-- Right eye (looking right - confused) -->
            <ellipse cx="94" cy="110" rx="4" ry="5" fill="#2C3E50" />
            <circle cx="93" cy="109" r="1.5" fill="white" opacity="0.7" />

            <!-- Confused mouth -->
            <path
              d="M78 126 Q85 122 92 126"
              stroke="#2C3E50"
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
            />

            <!-- Left arm (scratching head) -->
            <path
              d="M57 115 Q48 98 62 90"
              stroke="#AED6F1"
              stroke-width="6"
              fill="none"
              stroke-linecap="round"
            />
            <!-- Hand -->
            <circle cx="62" cy="90" r="4" fill="#AED6F1" />
          </g>

          <!-- Child bean (orange) - holding parent's hand -->
          <g
            :class="{ 'animate-beanie-float': !prefersReducedMotion }"
            style="animation-delay: 0.3s"
          >
            <!-- Bean body -->
            <ellipse cx="125" cy="132" rx="22" ry="28" fill="#E67E22" />
            <ellipse cx="125" cy="132" rx="22" ry="28" fill="url(#beanSheen)" opacity="0.3" />

            <!-- Left eye -->
            <ellipse cx="118" cy="124" rx="3.5" ry="4.5" fill="#2C3E50" />
            <circle cx="117" cy="123" r="1.2" fill="white" opacity="0.7" />

            <!-- Right eye -->
            <ellipse cx="132" cy="124" rx="3.5" ry="4.5" fill="#2C3E50" />
            <circle cx="131" cy="123" r="1.2" fill="white" opacity="0.7" />

            <!-- Little smile -->
            <path
              d="M120 136 Q125 140 130 136"
              stroke="#2C3E50"
              stroke-width="1.8"
              fill="none"
              stroke-linecap="round"
            />

            <!-- Left arm reaching to parent -->
            <path
              d="M103 130 Q96 128 92 125"
              stroke="#E67E22"
              stroke-width="5"
              fill="none"
              stroke-linecap="round"
            />
          </g>

          <!-- Joined hands -->
          <circle cx="92" cy="125" r="4.5" fill="#F15D22" opacity="0.8" />

          <!-- Right arm of parent reaching down -->
          <path
            d="M107 125 Q100 124 93 125"
            stroke="#AED6F1"
            stroke-width="6"
            fill="none"
            stroke-linecap="round"
          />

          <!-- Question marks floating around -->
          <g class="question-marks" opacity="0.5">
            <text
              x="45"
              y="78"
              font-family="Outfit, sans-serif"
              font-weight="700"
              font-size="20"
              fill="#F15D22"
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
            >
              ?
            </text>
            <text
              x="145"
              y="70"
              font-family="Outfit, sans-serif"
              font-weight="700"
              font-size="16"
              fill="#AED6F1"
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
              style="animation-delay: 0.5s"
            >
              ?
            </text>
            <text
              x="155"
              y="95"
              font-family="Outfit, sans-serif"
              font-weight="700"
              font-size="12"
              fill="#E67E22"
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
              style="animation-delay: 1s"
            >
              ?
            </text>
          </g>

          <!-- Gradient definitions -->
          <defs>
            <linearGradient id="beanSheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="white" stop-opacity="0.6" />
              <stop offset="100%" stop-color="white" stop-opacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <!-- 404 code - subtle background -->
      <p class="font-headline text-8xl font-bold text-orange-100 select-none dark:text-[#243342]">
        404
      </p>

      <!-- Heading -->
      <h1 class="font-headline mt-[-1rem] text-2xl font-bold text-[#2C3E50] dark:text-[#ECF0F1]">
        {{ t('notFound.heading') }}
      </h1>

      <!-- Description -->
      <p class="mt-3 text-base text-[#2C3E50]/60 dark:text-[#BDC3C7]">
        {{ t('notFound.description') }}
      </p>

      <!-- CTA button -->
      <div class="mt-8">
        <BaseButton size="lg" @click="goHome">
          {{ t('notFound.goHome') }}
        </BaseButton>
      </div>

      <!-- Subtle tagline -->
      <p class="mt-6 text-sm text-[#2C3E50]/30 italic dark:text-[#BDC3C7]/30">every bean counts</p>
    </div>
  </div>
</template>
