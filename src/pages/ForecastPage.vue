<script setup lang="ts">
import { BaseCard } from '@/components/ui';

import { useTranslation } from '@/composables/useTranslation';
import { useReducedMotion } from '@/composables/useReducedMotion';

const { t } = useTranslation();
const prefersReducedMotion = useReducedMotion();

const features = [
  'forecast.feature.projections',
  'forecast.feature.cashFlow',
  'forecast.feature.goals',
  'forecast.feature.scenarios',
] as const;
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="py-10 text-center">
        <!-- Beanie with telescope illustration -->
        <div class="relative mx-auto mb-8 h-48 w-48">
          <div class="dark:bg-secondary-500 absolute inset-0 rounded-full bg-orange-50" />

          <svg
            viewBox="0 0 200 200"
            class="relative h-full w-full"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="A beanie character looking through a telescope"
          >
            <!-- Ground shadow -->
            <ellipse cx="100" cy="170" rx="55" ry="8" fill="#AED6F1" opacity="0.3" />

            <!-- Parent bean (blue) -->
            <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
              <!-- Bean body -->
              <ellipse cx="80" cy="125" rx="28" ry="36" fill="#AED6F1" />
              <ellipse cx="80" cy="125" rx="28" ry="36" fill="url(#forecastSheen)" opacity="0.4" />

              <!-- Eyes (looking up through telescope) -->
              <ellipse cx="72" cy="113" rx="4" ry="5" fill="#2C3E50" />
              <circle cx="71" cy="112" r="1.5" fill="white" opacity="0.7" />
              <ellipse cx="88" cy="113" rx="4" ry="5" fill="#2C3E50" />
              <circle cx="87" cy="112" r="1.5" fill="white" opacity="0.7" />

              <!-- Excited smile -->
              <path
                d="M73 130 Q80 137 87 130"
                stroke="#2C3E50"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />

              <!-- Right arm holding telescope -->
              <path
                d="M105 118 Q115 105 128 95"
                stroke="#AED6F1"
                stroke-width="6"
                fill="none"
                stroke-linecap="round"
              />
              <circle cx="105" cy="118" r="4" fill="#AED6F1" />
            </g>

            <!-- Telescope -->
            <g>
              <!-- Telescope tube -->
              <rect
                x="120"
                y="78"
                width="40"
                height="14"
                rx="3"
                fill="#2C3E50"
                transform="rotate(-20, 140, 85)"
              />
              <!-- Telescope lens -->
              <circle cx="156" cy="72" r="10" fill="#2C3E50" />
              <circle cx="156" cy="72" r="7" fill="#34495E" />
              <circle cx="156" cy="72" r="4" fill="#AED6F1" opacity="0.5" />
              <!-- Lens flare -->
              <circle cx="154" cy="70" r="2" fill="white" opacity="0.6" />
              <!-- Eyepiece -->
              <circle cx="124" cy="91" r="6" fill="#34495E" />
              <circle cx="124" cy="91" r="3.5" fill="#2C3E50" />
            </g>

            <!-- Child bean (orange) - looking up excitedly -->
            <g
              :class="{ 'animate-beanie-float': !prefersReducedMotion }"
              style="animation-delay: 0.3s"
            >
              <!-- Bean body -->
              <ellipse cx="115" cy="140" rx="22" ry="28" fill="#E67E22" />
              <ellipse cx="115" cy="140" rx="22" ry="28" fill="url(#forecastSheen)" opacity="0.3" />

              <!-- Eyes (looking up at telescope) -->
              <ellipse cx="108" cy="131" rx="3.5" ry="5" fill="#2C3E50" />
              <circle cx="107.5" cy="129.5" r="1.2" fill="white" opacity="0.7" />
              <ellipse cx="122" cy="131" rx="3.5" ry="5" fill="#2C3E50" />
              <circle cx="121.5" cy="129.5" r="1.2" fill="white" opacity="0.7" />

              <!-- Excited open mouth -->
              <ellipse cx="115" cy="148" rx="5" ry="3.5" fill="#2C3E50" />

              <!-- Left arm reaching up toward telescope -->
              <path
                d="M93 137 Q87 125 92 118"
                stroke="#E67E22"
                stroke-width="5"
                fill="none"
                stroke-linecap="round"
              />
            </g>

            <!-- Joined hands area -->
            <circle cx="93" cy="132" r="4.5" fill="#F15D22" opacity="0.8" />
            <path
              d="M97 132 Q95 130 93 132"
              stroke="#AED6F1"
              stroke-width="5"
              fill="none"
              stroke-linecap="round"
            />

            <!-- Stars / sparkles around telescope -->
            <g opacity="0.6">
              <text
                x="165"
                y="55"
                font-family="Outfit, sans-serif"
                font-weight="700"
                font-size="14"
                fill="#F15D22"
                :class="{ 'animate-beanie-float': !prefersReducedMotion }"
                style="animation-delay: 0.2s"
              >
                &#x2726;
              </text>
              <text
                x="148"
                y="48"
                font-family="Outfit, sans-serif"
                font-weight="700"
                font-size="10"
                fill="#AED6F1"
                :class="{ 'animate-beanie-float': !prefersReducedMotion }"
                style="animation-delay: 0.7s"
              >
                &#x2726;
              </text>
              <text
                x="172"
                y="68"
                font-family="Outfit, sans-serif"
                font-weight="700"
                font-size="8"
                fill="#E67E22"
                :class="{ 'animate-beanie-float': !prefersReducedMotion }"
                style="animation-delay: 1.2s"
              >
                &#x2726;
              </text>
            </g>

            <defs>
              <linearGradient id="forecastSheen" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="white" stop-opacity="0.6" />
                <stop offset="100%" stop-color="white" stop-opacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <!-- Heading -->
        <h2 class="font-headline text-secondary-500 text-xl font-bold dark:text-[#ECF0F1]">
          {{ t('forecast.comingSoon') }}
        </h2>

        <!-- Description -->
        <p class="text-secondary-500/60 mx-auto mt-2 max-w-sm text-sm dark:text-[#BDC3C7]">
          {{ t('forecast.comingSoonDescription') }}
        </p>

        <!-- Feature list with impact bullet -->
        <ul class="mx-auto mt-6 max-w-sm space-y-3 text-left">
          <li v-for="feature in features" :key="feature" class="flex items-center gap-3">
            <img
              src="/brand/beanies_impact_bullet_transparent_192x192.png"
              alt=""
              class="h-6 w-6 flex-shrink-0"
            />
            <span class="text-secondary-500 text-sm dark:text-[#ECF0F1]">
              {{ t(feature) }}
            </span>
          </li>
        </ul>
      </div>
    </BaseCard>
  </div>
</template>
