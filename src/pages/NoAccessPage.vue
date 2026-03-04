<script setup lang="ts">
import { useRouter } from 'vue-router';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { useReducedMotion } from '@/composables/useReducedMotion';

const router = useRouter();
const { t } = useTranslation();
const prefersReducedMotion = useReducedMotion();

function goHome() {
  router.push('/nook');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-[#FDFBF9] p-6 dark:bg-[#1a252f]">
    <div class="max-w-md text-center">
      <!-- Locked beanie illustration -->
      <div class="relative mx-auto mb-8 h-56 w-56">
        <!-- Background circle -->
        <div class="dark:bg-secondary-500 absolute inset-0 rounded-full bg-orange-50" />

        <!-- SVG beanie illustration with padlock -->
        <svg
          viewBox="0 0 200 200"
          class="relative h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="A beanie character next to a padlock"
        >
          <!-- Ground shadow -->
          <ellipse cx="100" cy="168" rx="50" ry="8" fill="#AED6F1" opacity="0.3" />

          <!-- Parent bean - peeking from behind the lock -->
          <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
            <!-- Bean body -->
            <ellipse cx="75" cy="125" rx="26" ry="34" fill="#AED6F1" />
            <ellipse cx="75" cy="125" rx="26" ry="34" fill="url(#noAccessSheen)" opacity="0.4" />

            <!-- Left eye (looking at lock) -->
            <ellipse cx="68" cy="115" rx="3.5" ry="4.5" fill="#2C3E50" />
            <circle cx="69" cy="114" r="1.2" fill="white" opacity="0.7" />

            <!-- Right eye (looking at lock) -->
            <ellipse cx="82" cy="115" rx="3.5" ry="4.5" fill="#2C3E50" />
            <circle cx="83" cy="114" r="1.2" fill="white" opacity="0.7" />

            <!-- Curious/unsure mouth -->
            <circle cx="75" cy="130" r="3" fill="#2C3E50" opacity="0.6" />

            <!-- Left arm (reaching toward lock) -->
            <path
              d="M97 125 Q105 120 110 115"
              stroke="#AED6F1"
              stroke-width="5"
              fill="none"
              stroke-linecap="round"
            />
          </g>

          <!-- Padlock -->
          <g
            :class="{ 'animate-beanie-float': !prefersReducedMotion }"
            style="animation-delay: 0.3s"
          >
            <!-- Lock shackle -->
            <path
              d="M120 100 L120 90 A12 12 0 0 1 144 90 L144 100"
              stroke="#E67E22"
              stroke-width="5"
              fill="none"
              stroke-linecap="round"
            />
            <!-- Lock body -->
            <rect x="112" y="100" width="40" height="30" rx="6" fill="#E67E22" />
            <rect
              x="112"
              y="100"
              width="40"
              height="30"
              rx="6"
              fill="url(#noAccessSheen)"
              opacity="0.3"
            />
            <!-- Keyhole -->
            <circle cx="132" cy="113" r="4" fill="#2C3E50" />
            <rect x="130" y="113" width="4" height="8" rx="1" fill="#2C3E50" />
          </g>

          <!-- Floating lock symbols -->
          <g opacity="0.4">
            <text
              x="40"
              y="80"
              font-family="Outfit, sans-serif"
              font-weight="700"
              font-size="18"
              fill="#E67E22"
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
            >
              &#x1F512;
            </text>
            <text
              x="155"
              y="72"
              font-family="Outfit, sans-serif"
              font-weight="700"
              font-size="14"
              fill="#AED6F1"
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
              style="animation-delay: 0.5s"
            >
              &#x1F512;
            </text>
          </g>

          <!-- Gradient definitions -->
          <defs>
            <linearGradient id="noAccessSheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="white" stop-opacity="0.6" />
              <stop offset="100%" stop-color="white" stop-opacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <!-- Heading -->
      <h1 class="font-headline text-secondary-500 text-2xl font-bold dark:text-[#ECF0F1]">
        {{ t('noAccess.heading') }}
      </h1>

      <!-- Description -->
      <p class="text-secondary-500/60 mt-3 text-base dark:text-[#BDC3C7]">
        {{ t('noAccess.description') }}
      </p>

      <!-- CTA button -->
      <div class="mt-8">
        <BaseButton size="lg" @click="goHome">
          {{ t('noAccess.backToNook') }}
        </BaseButton>
      </div>

      <!-- Subtle tagline -->
      <p class="text-secondary-500/30 mt-6 text-sm italic dark:text-[#BDC3C7]/30">
        {{ t('app.tagline') }}
      </p>
    </div>
  </div>
</template>
