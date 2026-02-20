<script setup lang="ts">
import { computed } from 'vue';
import { getAvatarDef } from '@/constants/avatars';
import type { AvatarVariant } from '@/constants/avatars';

interface Props {
  /** Avatar variant from the registry */
  variant: AvatarVariant;
  /** Member's profile color for the body fill */
  color?: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Accessible label */
  ariaLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  color: '#3b82f6',
  size: 'md',
  ariaLabel: undefined,
});

const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const DEEP_SLATE = '#2C3E50';
// Brand palette for family group members
const HERITAGE_ORANGE = '#F15D22';
const SKY_SILK = '#AED6F1';
const TERRACOTTA = '#E67E22';
const SOFT_TEAL = '#5DADE2';

const sizeClass = computed(() => SIZE_CLASSES[props.size] || SIZE_CLASSES.md);
const avatarDef = computed(() => getAvatarDef(props.variant));

const isSpecialVariant = computed(
  () => props.variant === 'family-group' || props.variant === 'family-filtered'
);
</script>

<template>
  <svg
    :class="sizeClass"
    viewBox="0 0 64 64"
    fill="none"
    :aria-label="ariaLabel"
    :aria-hidden="!ariaLabel"
    role="img"
    data-testid="beanie-avatar"
    :data-variant="variant"
    class="flex-shrink-0"
  >
    <!-- Family group: adult + partner + child with beanie, each in brand colors -->
    <template v-if="variant === 'family-group'">
      <!-- Left adult (taller) — Heritage Orange -->
      <ellipse cx="16" cy="36" rx="11" ry="18" :fill="HERITAGE_ORANGE" />
      <circle cx="13" cy="33" r="1.5" :fill="DEEP_SLATE" />
      <circle cx="19" cy="33" r="1.5" :fill="DEEP_SLATE" />
      <path
        d="M14 38 Q16 41 18 38"
        :stroke="DEEP_SLATE"
        stroke-width="1.2"
        fill="none"
        stroke-linecap="round"
      />

      <!-- Right adult (taller) — Sky Silk -->
      <ellipse cx="38" cy="36" rx="11" ry="18" :fill="SKY_SILK" />
      <circle cx="35" cy="33" r="1.5" :fill="DEEP_SLATE" />
      <circle cx="41" cy="33" r="1.5" :fill="DEEP_SLATE" />
      <path
        d="M36 38 Q38 41 40 38"
        :stroke="DEEP_SLATE"
        stroke-width="1.2"
        fill="none"
        stroke-linecap="round"
      />

      <!-- Center child (shorter, in front) — Terracotta -->
      <ellipse cx="27" cy="42" rx="9" ry="14" :fill="TERRACOTTA" />
      <circle cx="24" cy="40" r="1.5" :fill="DEEP_SLATE" />
      <circle cx="30" cy="40" r="1.5" :fill="DEEP_SLATE" />
      <path
        d="M25 44 Q27 47 29 44"
        :stroke="DEEP_SLATE"
        stroke-width="1.2"
        fill="none"
        stroke-linecap="round"
      />
      <!-- Child's beanie hat -->
      <path
        d="M20 33 Q22 23 27 22 Q32 23 34 33 Q31 30 27 29 Q23 30 20 33Z"
        :fill="DEEP_SLATE"
        opacity="0.8"
      />
      <!-- Beanie pom-pom -->
      <circle cx="27" cy="21" r="2.5" :fill="DEEP_SLATE" opacity="0.8" />

      <!-- Right child (shorter, in front) — Soft Teal -->
      <ellipse cx="49" cy="44" rx="8" ry="12" :fill="SOFT_TEAL" />
      <circle cx="46" cy="42" r="1.5" :fill="DEEP_SLATE" />
      <circle cx="52" cy="42" r="1.5" :fill="DEEP_SLATE" />
      <path
        d="M47 46 Q49 48 51 46"
        :stroke="DEEP_SLATE"
        stroke-width="1.2"
        fill="none"
        stroke-linecap="round"
      />
      <!-- Child's beanie hat -->
      <path
        d="M43 36 Q44 27 49 26 Q54 27 55 36 Q53 33 49 32 Q45 33 43 36Z"
        :fill="DEEP_SLATE"
        opacity="0.8"
      />
      <!-- Beanie pom-pom -->
      <circle cx="49" cy="25" r="2" :fill="DEEP_SLATE" opacity="0.8" />
    </template>

    <!-- Family filtered: single bean + funnel icon -->
    <template v-else-if="variant === 'family-filtered'">
      <path
        d="M32 14 C20 14 14 24 14 36 C14 48 20 54 32 54 C44 54 50 48 50 36 C50 24 44 14 32 14Z"
        :fill="color"
        opacity="0.7"
      />
      <circle cx="27" cy="34" r="2" :fill="DEEP_SLATE" />
      <circle cx="37" cy="34" r="2" :fill="DEEP_SLATE" />
      <path
        d="M29 40 Q32 44 35 40"
        :stroke="DEEP_SLATE"
        stroke-width="1.5"
        fill="none"
        stroke-linecap="round"
      />
      <!-- Small funnel overlay -->
      <path d="M44 8 L56 8 L52 18 L52 26 L48 26 L48 18 Z" :fill="DEEP_SLATE" opacity="0.6" />
    </template>

    <!-- Standard character avatars -->
    <template v-else-if="avatarDef && !isSpecialVariant">
      <!-- Colored ring -->
      <circle cx="32" cy="32" r="30" :stroke="color" stroke-width="2" fill="none" opacity="0.3" />

      <!-- Bean body -->
      <path :d="avatarDef.body" :fill="color" />

      <!-- Eyes -->
      <path v-for="(eye, i) in avatarDef.eyes" :key="'eye-' + i" :d="eye" :fill="DEEP_SLATE" />

      <!-- Smile -->
      <path
        :d="avatarDef.smile"
        :stroke="DEEP_SLATE"
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
      />

      <!-- Accessories (hats, bows, etc.) -->
      <path
        v-for="(acc, i) in avatarDef.accessories"
        :key="'acc-' + i"
        :d="acc"
        :fill="DEEP_SLATE"
        opacity="0.85"
      />
    </template>

    <!-- Fallback: simple colored circle with ? -->
    <template v-else>
      <circle cx="32" cy="32" r="28" :fill="color" />
      <text
        x="32"
        y="38"
        text-anchor="middle"
        :fill="DEEP_SLATE"
        font-size="20"
        font-weight="600"
        font-family="Outfit, sans-serif"
      >
        ?
      </text>
    </template>
  </svg>
</template>
