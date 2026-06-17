<script setup lang="ts">
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useTranslation } from '@/composables/useTranslation';
import BeanieCore from '@/components/ui/BeanieCore.vue';

// Shared mascot body palettes (gradient light / base / dark).
const ORANGE = { bodyLight: '#FF7E47', bodyBase: '#F15D22', bodyDark: '#DB4D17' } as const;
const TERRA = { bodyLight: '#F3A35C', bodyBase: '#E67E22', bodyDark: '#C9671A' } as const;
const SLATE = { bodyLight: '#46607A', bodyBase: '#2C3E50', bodyDark: '#1E2B38' } as const;

const { t } = useTranslation();

type EmptyStateVariant =
  | 'accounts'
  | 'transactions'
  | 'recurring'
  | 'assets'
  | 'goals'
  | 'reports'
  | 'dashboard'
  | 'budget'
  | 'lists';

defineProps<{
  variant: EmptyStateVariant;
}>();

const prefersReducedMotion = useReducedMotion();
</script>

<template>
  <div class="relative mx-auto h-40 w-40">
    <div class="dark:bg-secondary-500 absolute inset-0 rounded-full bg-orange-50" />

    <!-- Accounts: beanie reaching toward an empty piggy bank -->
    <svg
      v-if="variant === 'accounts'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.piggyBank')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <!-- dashed empty piggy bank -->
      <g opacity="0.65">
        <ellipse
          cx="118"
          cy="100"
          rx="22"
          ry="18"
          fill="none"
          stroke="#F15D22"
          stroke-width="2"
          stroke-dasharray="4 3"
        />
        <ellipse
          cx="108"
          cy="94"
          rx="3"
          ry="2.4"
          fill="none"
          stroke="#F15D22"
          stroke-width="1.4"
          stroke-dasharray="3 2"
        />
        <rect
          x="112"
          y="81"
          width="12"
          height="3"
          rx="1.5"
          fill="none"
          stroke="#F15D22"
          stroke-width="1.4"
          stroke-dasharray="3 2"
        />
        <line
          x1="110"
          y1="117"
          x2="108"
          y2="123"
          stroke="#F15D22"
          stroke-width="1.4"
          stroke-dasharray="3 2"
          stroke-linecap="round"
        />
        <line
          x1="126"
          y1="117"
          x2="128"
          y2="123"
          stroke="#F15D22"
          stroke-width="1.4"
          stroke-dasharray="3 2"
          stroke-linecap="round"
        />
        <text
          x="116"
          y="104"
          font-family="Outfit, sans-serif"
          font-weight="700"
          font-size="12"
          fill="#F15D22"
          text-anchor="middle"
        >
          ?
        </text>
      </g>
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <!-- left arm relaxed -->
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          :stroke="ORANGE.bodyBase"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle
          cx="31"
          cy="110"
          r="5"
          :fill="ORANGE.bodyBase"
          stroke="#5a3a26"
          stroke-width="2.2"
        />
        <!-- right arm reaching to the piggy bank -->
        <path
          d="M82 98 Q92 100 99 95"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M82 98 Q92 100 99 95"
          fill="none"
          :stroke="ORANGE.bodyBase"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="99" cy="95" r="5" :fill="ORANGE.bodyBase" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="ORANGE" />
      </g>
    </svg>

    <!-- Transactions: Beanie shrugging with empty pockets -->
    <svg
      v-else-if="variant === 'transactions'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.emptyPockets')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 96 Q32 88 30 76"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 96 Q32 88 30 76"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M82 96 Q94 88 96 76"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M82 96 Q94 88 96 76"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="30" cy="76" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="96" cy="76" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="ORANGE" uid="t" />
      </g>
      <path
        d="M40 116 Q35 127 42 129"
        stroke="#E67E22"
        stroke-width="1.6"
        fill="none"
        stroke-dasharray="3 2"
        opacity="0.5"
      />
      <path
        d="M84 116 Q89 127 82 129"
        stroke="#E67E22"
        stroke-width="1.6"
        fill="none"
        stroke-dasharray="3 2"
        opacity="0.5"
      />
    </svg>

    <!-- Recurring: Beanie scratching head near blank calendar -->
    <svg
      v-else-if="variant === 'recurring'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.blankCalendar')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <g opacity="0.6">
        <rect
          x="96"
          y="82"
          width="42"
          height="40"
          rx="5"
          fill="#fff"
          stroke="#2C3E50"
          stroke-width="2"
        />
        <line x1="96" y1="94" x2="138" y2="94" stroke="#2C3E50" stroke-width="2" />
        <rect x="103" y="86" width="3" height="6" rx="1" fill="#F15D22" />
        <rect x="128" y="86" width="3" height="6" rx="1" fill="#F15D22" />
        <line
          x1="110"
          y1="94"
          x2="110"
          y2="122"
          stroke="#2C3E50"
          stroke-width="0.6"
          opacity="0.4"
        />
        <line
          x1="124"
          y1="94"
          x2="124"
          y2="122"
          stroke="#2C3E50"
          stroke-width="0.6"
          opacity="0.4"
        />
        <line
          x1="96"
          y1="104"
          x2="138"
          y2="104"
          stroke="#2C3E50"
          stroke-width="0.6"
          opacity="0.4"
        />
        <line
          x1="96"
          y1="113"
          x2="138"
          y2="113"
          stroke="#2C3E50"
          stroke-width="0.6"
          opacity="0.4"
        />
      </g>
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 98 Q34 102 31 108"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 102 31 108"
          fill="none"
          stroke="#E67E22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q84 80 72 70"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q84 80 72 70"
          fill="none"
          stroke="#E67E22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="31" cy="108" r="5" fill="#E67E22" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="72" cy="70" r="5" fill="#E67E22" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="TERRA" uid="r" />
      </g>
    </svg>

    <!-- Assets: Beanie dreaming about treasure chest -->
    <svg
      v-else-if="variant === 'assets'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.treasureChest')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <circle cx="96" cy="66" r="2.4" fill="#2C3E50" opacity="0.18" />
      <circle cx="102" cy="56" r="3.4" fill="#2C3E50" opacity="0.18" />
      <g opacity="0.65">
        <rect
          x="100"
          y="36"
          width="30"
          height="20"
          rx="3"
          fill="#fff"
          stroke="#F15D22"
          stroke-width="1.6"
        />
        <line x1="100" y1="43" x2="130" y2="43" stroke="#F15D22" stroke-width="1.6" />
        <path d="M112 36 Q115 30 118 36" stroke="#F15D22" stroke-width="1.6" fill="none" />
        <path
          d="M113 49 l1.2 2.6 l2.6 1.2 l-2.6 1.2 l-1.2 2.6 l-1.2 -2.6 l-2.6 -1.2 l2.6 -1.2 Z"
          fill="#F1B24A"
        />
      </g>
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M82 98 Q92 102 95 110"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M82 98 Q92 102 95 110"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="31" cy="110" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="95" cy="110" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="ORANGE" eyes="happy" uid="as" />
      </g>
    </svg>

    <!-- Goals: Beanie looking up at distant flag on hill -->
    <svg
      v-else-if="variant === 'goals'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.flagOnHill')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <path d="M70 148 Q112 70 152 148" fill="#AED6F1" opacity="0.16" />
      <line x1="124" y1="96" x2="124" y2="70" stroke="#2C3E50" stroke-width="1.8" />
      <path d="M124 70 L142 76 L124 82 Z" fill="#F15D22" opacity="0.9" />
      <path
        d="M136 62 l1.1 2.6 l2.6 1.1 l-2.6 1.1 l-1.1 2.6 l-1.1 -2.6 l-2.6 -1.1 l2.6 -1.1 Z"
        fill="#F1B24A"
      />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 98 Q34 96 30 104"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 96 30 104"
          fill="none"
          stroke="#E67E22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M82 98 Q92 96 96 104"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M82 98 Q92 96 96 104"
          fill="none"
          stroke="#E67E22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="30" cy="104" r="5" fill="#E67E22" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="96" cy="104" r="5" fill="#E67E22" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="TERRA" uid="g" />
      </g>
    </svg>

    <!-- Reports: Beanie with magnifying glass over empty chart -->
    <svg
      v-else-if="variant === 'reports'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.emptyChart')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q92 86 100 80"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q92 86 100 80"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="31" cy="110" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <BeanieCore v-bind="ORANGE" uid="rp" />
      </g>
      <circle cx="110" cy="74" r="14" fill="#AED6F1" opacity="0.16" />
      <circle cx="110" cy="74" r="14" fill="none" stroke="#2C3E50" stroke-width="2.6" />
      <line
        x1="100"
        y1="84"
        x2="93"
        y2="91"
        stroke="#2C3E50"
        stroke-width="3.2"
        stroke-linecap="round"
      />
      <circle cx="100" cy="81" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
      <g opacity="0.4">
        <rect
          x="103"
          y="76"
          width="3.4"
          height="7"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <rect
          x="109"
          y="72"
          width="3.4"
          height="11"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <rect
          x="115"
          y="74"
          width="3.4"
          height="9"
          rx="1"
          fill="none"
          stroke="#F15D22"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
      </g>
    </svg>

    <!-- Dashboard: Beanie waving "Let's get started!" -->
    <svg
      v-else-if="variant === 'dashboard'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.wavingHello')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <g transform="translate(-16,0) scale(0.95)">
          <path
            d="M82 98 Q98 84 94 70"
            fill="none"
            stroke="#5a3a26"
            stroke-width="8.5"
            stroke-linecap="round"
          />
          <path
            d="M82 98 Q98 84 94 70"
            fill="none"
            stroke="#2C3E50"
            stroke-width="5.2"
            stroke-linecap="round"
          />
          <circle cx="94" cy="70" r="5" fill="#2C3E50" stroke="#5a3a26" stroke-width="2.2" />
          <BeanieCore v-bind="SLATE" uid="dp" />
        </g>
        <g transform="translate(60,26) scale(0.6)"><BeanieCore v-bind="ORANGE" uid="dc" /></g>
      </g>
      <circle cx="92" cy="112" r="4.5" fill="#F15D22" stroke="#5a3a26" stroke-width="1.6" />
    </svg>

    <!-- Budget: Beanie with a chart/clipboard -->
    <svg
      v-else-if="variant === 'budget'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.planningBudget')"
    >
      <ellipse cx="80" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <g>
        <rect
          x="104"
          y="98"
          width="9"
          height="30"
          rx="2.5"
          fill="#F15D22"
          opacity="0.7"
          stroke="#5a3a26"
          stroke-width="1.2"
        />
        <rect
          x="116"
          y="106"
          width="9"
          height="22"
          rx="2.5"
          fill="#E67E22"
          opacity="0.7"
          stroke="#5a3a26"
          stroke-width="1.2"
        />
        <rect
          x="128"
          y="112"
          width="9"
          height="16"
          rx="2.5"
          fill="#AED6F1"
          opacity="0.85"
          stroke="#5a3a26"
          stroke-width="1.2"
        />
        <line
          x1="100"
          y1="129"
          x2="140"
          y2="129"
          stroke="#2C3E50"
          stroke-width="1.5"
          opacity="0.35"
        />
      </g>
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M44 98 Q34 102 31 110"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q92 88 98 80"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M80 96 Q92 88 98 80"
          fill="none"
          stroke="#F15D22"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="31" cy="110" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="98" cy="80" r="5" fill="#F15D22" stroke="#5a3a26" stroke-width="2.2" />
        <path d="M98 80 l4 -6" stroke="#E67E22" stroke-width="3" stroke-linecap="round" />
        <path d="M101 75 l3 -4" stroke="#F1B24A" stroke-width="3" stroke-linecap="round" />
        <BeanieCore v-bind="ORANGE" uid="b" />
      </g>
    </svg>

    <!-- Lists: a cheerful beanie hugging a fresh checklist (#33) -->
    <svg
      v-else-if="variant === 'lists'"
      viewBox="0 0 160 160"
      class="relative h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      :aria-label="t('emptyState.aria.freshChecklist')"
    >
      <ellipse cx="78" cy="148" rx="50" ry="7" fill="#AED6F1" opacity="0.3" />
      <!-- clipboard (behind the beanie so the hugging hand sits on top) -->
      <g stroke="#5a3a26" stroke-width="2.4" stroke-linejoin="round">
        <rect x="90" y="72" width="46" height="60" rx="8" fill="#fdfdfd" />
        <rect x="101" y="65" width="24" height="11" rx="5.5" fill="#E67E22" />
        <rect x="107" y="60" width="11" height="8" rx="2.5" fill="#5a3a26" stroke="none" />
      </g>
      <circle cx="100" cy="89" r="4.2" fill="#27AE60" stroke="#1c7d44" stroke-width="1" />
      <path
        d="M97.8 89 l1.7 1.9 l3.2-3.6"
        stroke="#fff"
        stroke-width="1.6"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="109"
        y1="89"
        x2="129"
        y2="89"
        stroke="#cdd4da"
        stroke-width="3"
        stroke-linecap="round"
      />
      <circle cx="100" cy="103" r="4.2" fill="#27AE60" stroke="#1c7d44" stroke-width="1" />
      <path
        d="M97.8 103 l1.7 1.9 l3.2-3.6"
        stroke="#fff"
        stroke-width="1.6"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="109"
        y1="103"
        x2="126"
        y2="103"
        stroke="#cdd4da"
        stroke-width="3"
        stroke-linecap="round"
      />
      <circle
        cx="100"
        cy="117"
        r="4.2"
        fill="none"
        stroke="#F15D22"
        stroke-width="1.8"
        stroke-dasharray="2.6 2.2"
      />
      <line
        x1="109"
        y1="117"
        x2="122"
        y2="117"
        stroke="#F15D22"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="3.4 2.6"
        opacity="0.75"
      />
      <g :class="{ 'animate-beanie-float': !prefersReducedMotion }">
        <!-- left arm (raised, cheering) -->
        <path
          d="M46 92 Q32 84 30 68"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M46 92 Q32 84 30 68"
          fill="none"
          stroke="url(#beanBody)"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="30" cy="66" r="5" fill="url(#beanBody)" />
        <!-- feet -->
        <ellipse
          cx="54"
          cy="129"
          rx="6"
          ry="4"
          fill="url(#beanBody)"
          stroke="#5a3a26"
          stroke-width="2.4"
        />
        <ellipse
          cx="68"
          cy="130"
          rx="6"
          ry="4"
          fill="url(#beanBody)"
          stroke="#5a3a26"
          stroke-width="2.4"
        />
        <!-- bean body -->
        <path
          d="M40 98 C35 70 49 50 62 49 C78 48 87 61 86 82 C85 108 75 124 58 124 C46 124 44 113 40 98 Z"
          fill="url(#beanBody)"
          stroke="#5a3a26"
          stroke-width="2.6"
          stroke-linejoin="round"
        />
        <path
          d="M48 70 C44 86 46 104 56 110 C50 96 50 80 58 66 C53 64 50 66 48 70 Z"
          fill="#fff"
          opacity="0.18"
        />
        <path
          d="M86 82 C85 108 75 124 58 124 C72 120 80 104 80 86 C82 84 84 82 86 82 Z"
          fill="#c9461a"
          opacity="0.4"
        />
        <!-- right arm hugging the clipboard -->
        <path
          d="M80 98 Q92 98 95 106"
          fill="none"
          stroke="#5a3a26"
          stroke-width="8.5"
          stroke-linecap="round"
        />
        <path
          d="M80 98 Q92 98 95 106"
          fill="none"
          stroke="url(#beanBody)"
          stroke-width="5.2"
          stroke-linecap="round"
        />
        <circle cx="95" cy="107" r="5" fill="url(#beanBody)" stroke="#5a3a26" stroke-width="2.2" />
        <!-- knitted beanie hat -->
        <clipPath id="listsDome">
          <path d="M43 61 C43 36 53 26 65 26 C77 26 87 36 87 61 Z" />
        </clipPath>
        <circle cx="65" cy="24" r="6.4" fill="#dcefff" stroke="#5a3a26" stroke-width="2.2" />
        <circle cx="62.5" cy="22" r="2.1" fill="#fff" opacity="0.9" />
        <path
          d="M43 61 C43 36 53 26 65 26 C77 26 87 36 87 61 Z"
          fill="url(#beanHat)"
          stroke="#5a3a26"
          stroke-width="2.4"
          stroke-linejoin="round"
        />
        <g clip-path="url(#listsDome)" stroke="#94c2e6" stroke-width="1.7" opacity="0.75">
          <line x1="51" y1="29" x2="51" y2="61" />
          <line x1="58" y1="27" x2="58" y2="61" />
          <line x1="65" y1="26" x2="65" y2="61" />
          <line x1="72" y1="27" x2="72" y2="61" />
          <line x1="79" y1="29" x2="79" y2="61" />
        </g>
        <rect
          x="41"
          y="58"
          width="48"
          height="11"
          rx="5.5"
          fill="#c2e0f5"
          stroke="#5a3a26"
          stroke-width="2.4"
        />
        <line x1="48" y1="59" x2="48" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
        <line x1="58" y1="59" x2="58" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
        <line x1="72" y1="59" x2="72" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
        <line x1="82" y1="59" x2="82" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
        <!-- face -->
        <path
          d="M51 73 Q56 70 60 72"
          stroke="#5a3a26"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
        />
        <path
          d="M70 72 Q74 70 78 73"
          stroke="#5a3a26"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
        />
        <ellipse cx="57" cy="82" rx="5.6" ry="6.6" fill="#2a2622" />
        <circle cx="55" cy="79.6" r="2" fill="#fff" />
        <circle cx="59" cy="83.5" r="1" fill="#fff" opacity="0.85" />
        <ellipse cx="73" cy="81" rx="5.6" ry="6.6" fill="#2a2622" />
        <circle cx="71" cy="78.6" r="2" fill="#fff" />
        <circle cx="75" cy="82.5" r="1" fill="#fff" opacity="0.85" />
        <ellipse cx="49" cy="91" rx="4.4" ry="2.8" fill="#F5938A" opacity="0.7" />
        <ellipse cx="80" cy="90" rx="4.4" ry="2.8" fill="#F5938A" opacity="0.7" />
        <path
          d="M59 92 Q65.5 101 72 91 Q65.5 96 59 92 Z"
          fill="#3a2622"
          stroke="#5a3a26"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <path d="M62 94.5 Q65.5 98.5 69 94.3 Q65.5 96.5 62 94.5 Z" fill="#F2766B" />
      </g>
      <!-- sparkles -->
      <path
        d="M128 52 l1.6 3.6 l3.6 1.6 l-3.6 1.6 l-1.6 3.6 l-1.6 -3.6 l-3.6 -1.6 l3.6 -1.6 Z"
        fill="#F1B24A"
      />
      <circle cx="120" cy="44" r="1.8" fill="#F1B24A" opacity="0.8" />
      <defs>
        <radialGradient id="beanBody" cx="0.36" cy="0.3" r="0.85">
          <stop offset="0%" stop-color="#FF7E47" />
          <stop offset="55%" stop-color="#F15D22" />
          <stop offset="100%" stop-color="#DB4D17" />
        </radialGradient>
        <linearGradient id="beanHat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#cfeaff" />
          <stop offset="100%" stop-color="#aed6f1" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>
