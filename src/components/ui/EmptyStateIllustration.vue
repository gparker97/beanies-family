<script setup lang="ts">
import { useReducedMotion } from '@/composables/useReducedMotion';

type EmptyStateVariant =
  | 'accounts'
  | 'transactions'
  | 'recurring'
  | 'assets'
  | 'goals'
  | 'reports'
  | 'dashboard'
  | 'budget';

defineProps<{
  variant: EmptyStateVariant;
}>();

const prefersReducedMotion = useReducedMotion();
</script>

<template>
  <div class="relative mx-auto h-40 w-40">
    <div class="dark:bg-secondary-500 absolute inset-0 rounded-full bg-orange-50" />

    <!-- Accounts: Beanie looking at empty piggy bank -->
    <svg
      v-if="variant === 'accounts'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie looking at an empty piggy bank"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="55" cy="100" rx="22" ry="28" fill="#AED6F1" />
        <ellipse cx="55" cy="100" rx="22" ry="28" fill="url(#emptySheen)" opacity="0.4" />
        <ellipse cx="48" cy="92" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="47" cy="91" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="62" cy="92" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="61" cy="91" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M50 105 Q55 108 60 105"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      <!-- Piggy bank outline -->
      <g opacity="0.5">
        <ellipse
          cx="110"
          cy="105"
          rx="24"
          ry="20"
          fill="none"
          stroke="#F15D22"
          stroke-width="2"
          stroke-dasharray="4 3"
        />
        <ellipse
          cx="100"
          cy="98"
          rx="3"
          ry="2.5"
          fill="none"
          stroke="#F15D22"
          stroke-width="1.5"
          stroke-dasharray="3 2"
        />
        <rect
          x="104"
          y="84"
          width="12"
          height="3"
          rx="1.5"
          fill="none"
          stroke="#F15D22"
          stroke-width="1.5"
          stroke-dasharray="3 2"
        />
        <line
          x1="102"
          y1="125"
          x2="100"
          y2="130"
          stroke="#F15D22"
          stroke-width="1.5"
          stroke-dasharray="3 2"
          stroke-linecap="round"
        />
        <line
          x1="118"
          y1="125"
          x2="120"
          y2="130"
          stroke="#F15D22"
          stroke-width="1.5"
          stroke-dasharray="3 2"
          stroke-linecap="round"
        />
      </g>
      <text
        x="107"
        y="110"
        font-family="Outfit, sans-serif"
        font-weight="600"
        font-size="12"
        fill="#F15D22"
        opacity="0.6"
        text-anchor="middle"
      >
        ?
      </text>
      <defs>
        <linearGradient id="emptySheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Transactions: Beanie shrugging with empty pockets -->
    <svg
      v-else-if="variant === 'transactions'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie shrugging with empty pockets"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="80" cy="100" rx="24" ry="30" fill="#AED6F1" />
        <ellipse cx="80" cy="100" rx="24" ry="30" fill="url(#emptySheen2)" opacity="0.4" />
        <ellipse cx="73" cy="91" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="72" cy="90" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="87" cy="91" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="86" cy="90" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M75 106 Q80 103 85 106"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Shrugging arms -->
        <path
          d="M56 98 Q45 85 48 78"
          stroke="#AED6F1"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <path
          d="M104 98 Q115 85 112 78"
          stroke="#AED6F1"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <circle cx="48" cy="78" r="3" fill="#AED6F1" />
        <circle cx="112" cy="78" r="3" fill="#AED6F1" />
      </g>
      <!-- Empty pocket outlines -->
      <path
        d="M42 118 Q38 128 44 130"
        stroke="#E67E22"
        stroke-width="1.5"
        fill="none"
        stroke-dasharray="3 2"
        opacity="0.4"
      />
      <path
        d="M118 118 Q122 128 116 130"
        stroke="#E67E22"
        stroke-width="1.5"
        fill="none"
        stroke-dasharray="3 2"
        opacity="0.4"
      />
      <defs>
        <linearGradient id="emptySheen2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Recurring: Beanie scratching head near blank calendar -->
    <svg
      v-else-if="variant === 'recurring'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie scratching its head near a blank calendar"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="55" cy="105" rx="22" ry="28" fill="#E67E22" />
        <ellipse cx="55" cy="105" rx="22" ry="28" fill="url(#emptySheen3)" opacity="0.3" />
        <ellipse cx="48" cy="97" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="47" cy="96" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="62" cy="97" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="61" cy="96" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M50 112 Q55 109 60 112"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Scratching head arm -->
        <path
          d="M37 100 Q30 85 40 78"
          stroke="#E67E22"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <circle cx="40" cy="78" r="3" fill="#E67E22" />
      </g>
      <!-- Blank calendar -->
      <g opacity="0.5">
        <rect
          x="90"
          y="80"
          width="40"
          height="38"
          rx="4"
          fill="none"
          stroke="#2C3E50"
          stroke-width="1.5"
        />
        <line x1="90" y1="92" x2="130" y2="92" stroke="#2C3E50" stroke-width="1.5" />
        <rect x="96" y="84" width="3" height="6" rx="1" fill="#F15D22" />
        <rect x="121" y="84" width="3" height="6" rx="1" fill="#F15D22" />
        <!-- Empty calendar cells -->
        <line
          x1="103"
          y1="92"
          x2="103"
          y2="118"
          stroke="#2C3E50"
          stroke-width="0.5"
          opacity="0.3"
        />
        <line
          x1="117"
          y1="92"
          x2="117"
          y2="118"
          stroke="#2C3E50"
          stroke-width="0.5"
          opacity="0.3"
        />
        <line
          x1="90"
          y1="101"
          x2="130"
          y2="101"
          stroke="#2C3E50"
          stroke-width="0.5"
          opacity="0.3"
        />
        <line
          x1="90"
          y1="110"
          x2="130"
          y2="110"
          stroke="#2C3E50"
          stroke-width="0.5"
          opacity="0.3"
        />
      </g>
      <defs>
        <linearGradient id="emptySheen3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Assets: Beanie dreaming about treasure chest -->
    <svg
      v-else-if="variant === 'assets'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie dreaming about a treasure chest"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="65" cy="108" rx="22" ry="28" fill="#AED6F1" />
        <ellipse cx="65" cy="108" rx="22" ry="28" fill="url(#emptySheen4)" opacity="0.4" />
        <!-- Closed/dreaming eyes -->
        <path
          d="M55 97 Q58 94 61 97"
          stroke="#2C3E50"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
        />
        <path
          d="M69 97 Q72 94 75 97"
          stroke="#2C3E50"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
        />
        <path
          d="M60 114 Q65 118 70 114"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      <!-- Dream bubble -->
      <circle cx="95" cy="72" r="2.5" fill="#2C3E50" opacity="0.2" />
      <circle cx="100" cy="62" r="3.5" fill="#2C3E50" opacity="0.2" />
      <!-- Treasure chest in dream -->
      <g opacity="0.5">
        <rect
          x="100"
          y="42"
          width="30"
          height="20"
          rx="3"
          fill="none"
          stroke="#F15D22"
          stroke-width="1.5"
        />
        <path d="M100 48 L130 48" stroke="#F15D22" stroke-width="1.5" />
        <path d="M112 42 Q115 36 118 42" stroke="#F15D22" stroke-width="1.5" fill="none" />
        <text
          x="115"
          y="57"
          font-family="Outfit, sans-serif"
          font-weight="700"
          font-size="10"
          fill="#F15D22"
          text-anchor="middle"
        >
          &#x2726;
        </text>
      </g>
      <defs>
        <linearGradient id="emptySheen4" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Goals: Beanie looking up at distant flag on hill -->
    <svg
      v-else-if="variant === 'goals'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie looking up at a flag on a hill"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <!-- Hill -->
      <path d="M70 140 Q110 70 150 140" fill="#AED6F1" opacity="0.15" />
      <!-- Flag on top -->
      <line x1="118" y1="90" x2="118" y2="72" stroke="#2C3E50" stroke-width="1.5" />
      <path d="M118 72 L135 78 L118 84" fill="#F15D22" opacity="0.7" />
      <!-- Beanie at bottom of hill -->
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="50" cy="112" rx="20" ry="25" fill="#E67E22" />
        <ellipse cx="50" cy="112" rx="20" ry="25" fill="url(#emptySheen5)" opacity="0.3" />
        <!-- Eyes looking up -->
        <ellipse cx="44" cy="103" rx="3" ry="4.5" fill="#2C3E50" />
        <circle cx="43.5" cy="101.5" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="56" cy="103" rx="3" ry="4.5" fill="#2C3E50" />
        <circle cx="55.5" cy="101.5" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M45 120 Q50 123 55 120"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      <!-- Sparkle near flag -->
      <text
        x="130"
        y="70"
        font-family="Outfit, sans-serif"
        font-weight="700"
        font-size="8"
        fill="#F15D22"
        opacity="0.5"
        :class="{ 'animate-beanie-float': !prefersReducedMotion }"
        style="animation-delay: 0.5s"
      >
        &#x2726;
      </text>
      <defs>
        <linearGradient id="emptySheen5" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Reports: Beanie with magnifying glass over empty chart -->
    <svg
      v-else-if="variant === 'reports'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie with a magnifying glass looking at an empty chart"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="55" cy="105" rx="22" ry="28" fill="#AED6F1" />
        <ellipse cx="55" cy="105" rx="22" ry="28" fill="url(#emptySheen6)" opacity="0.4" />
        <ellipse cx="48" cy="97" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="47" cy="96" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="62" cy="97" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="61" cy="96" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M50 112 Q55 115 60 112"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Arm holding magnifying glass -->
        <path
          d="M75 100 Q85 90 95 85"
          stroke="#AED6F1"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      <!-- Magnifying glass -->
      <circle cx="105" cy="75" r="14" fill="none" stroke="#2C3E50" stroke-width="2.5" />
      <circle cx="105" cy="75" r="10" fill="#AED6F1" opacity="0.1" />
      <line
        x1="95"
        y1="85"
        x2="88"
        y2="92"
        stroke="#2C3E50"
        stroke-width="3"
        stroke-linecap="round"
      />
      <!-- Empty chart bars behind magnifying glass -->
      <g opacity="0.3">
        <rect
          x="98"
          y="78"
          width="4"
          height="8"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <rect
          x="104"
          y="74"
          width="4"
          height="12"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <rect
          x="110"
          y="76"
          width="4"
          height="10"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
      </g>
      <defs>
        <linearGradient id="emptySheen6" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Dashboard: Beanie waving "Let's get started!" -->
    <svg
      v-else-if="variant === 'dashboard'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie waving hello"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <!-- Parent bean waving -->
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="65" cy="105" rx="24" ry="30" fill="#AED6F1" />
        <ellipse cx="65" cy="105" rx="24" ry="30" fill="url(#emptySheen7)" opacity="0.4" />
        <ellipse cx="58" cy="96" rx="3.5" ry="4.5" fill="#2C3E50" />
        <circle cx="57" cy="95" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="72" cy="96" rx="3.5" ry="4.5" fill="#2C3E50" />
        <circle cx="71" cy="95" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M59 113 Q65 118 71 113"
          stroke="#2C3E50"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Waving arm -->
        <path
          d="M87 98 Q100 82 95 70"
          stroke="#AED6F1"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <circle cx="95" cy="70" r="3.5" fill="#AED6F1" />
      </g>
      <!-- Child bean next to parent -->
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }" style="animation-delay: 0.3s">
        <ellipse cx="105" cy="115" rx="18" ry="22" fill="#E67E22" />
        <ellipse cx="105" cy="115" rx="18" ry="22" fill="url(#emptySheen7)" opacity="0.3" />
        <ellipse cx="100" cy="108" rx="2.5" ry="3.5" fill="#2C3E50" />
        <circle cx="99.5" cy="107" r="1" fill="white" opacity="0.7" />
        <ellipse cx="110" cy="108" rx="2.5" ry="3.5" fill="#2C3E50" />
        <circle cx="109.5" cy="107" r="1" fill="white" opacity="0.7" />
        <path
          d="M101 121 Q105 124 109 121"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      <!-- Joined hands -->
      <circle cx="88" cy="112" r="3.5" fill="#F15D22" opacity="0.8" />
      <defs>
        <linearGradient id="emptySheen7" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Budget: Beanie with a chart/clipboard -->
    <svg
      v-else-if="variant === 'budget'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A beanie planning a budget"
    >
      <ellipse cx="80" cy="140" rx="45" ry="6" fill="#AED6F1" opacity="0.3" />
      <!-- Beanie with pencil -->
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <ellipse cx="60" cy="102" rx="23" ry="29" fill="#AED6F1" />
        <ellipse cx="60" cy="102" rx="23" ry="29" fill="url(#emptySheen8)" opacity="0.4" />
        <ellipse cx="53" cy="93" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="52" cy="92" r="1.2" fill="white" opacity="0.7" />
        <ellipse cx="67" cy="93" rx="3" ry="4" fill="#2C3E50" />
        <circle cx="66" cy="92" r="1.2" fill="white" opacity="0.7" />
        <path
          d="M55 108 Q60 112 65 108"
          stroke="#2C3E50"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Pencil arm -->
        <path
          d="M81 97 Q90 85 95 75"
          stroke="#AED6F1"
          stroke-width="4.5"
          fill="none"
          stroke-linecap="round"
        />
        <path d="M95 75 L97 70" stroke="#E67E22" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <!-- Budget chart / bars -->
      <g opacity="0.5">
        <rect x="100" y="100" width="8" height="28" rx="2" fill="#F15D22" opacity="0.6" />
        <rect x="112" y="108" width="8" height="20" rx="2" fill="#E67E22" opacity="0.5" />
        <rect x="124" y="114" width="8" height="14" rx="2" fill="#AED6F1" opacity="0.6" />
        <!-- Baseline -->
        <line
          x1="96"
          y1="129"
          x2="136"
          y2="129"
          stroke="#2C3E50"
          stroke-width="1.5"
          opacity="0.3"
        />
      </g>
      <defs>
        <linearGradient id="emptySheen8" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.6" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>
