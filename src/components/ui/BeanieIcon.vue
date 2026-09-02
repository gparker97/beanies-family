<script setup lang="ts">
import { computed } from 'vue';
import { getIconDef } from '@/constants/icons';
import type { BeanieIconDef } from '@/constants/icons';

interface Props {
  /** Icon name from the BEANIE_ICONS registry */
  name: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Stroke width (default: 1.75 for softer brand feel) */
  strokeWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  strokeWidth: 1.75,
});

const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
};

const sizeClass = computed(() => SIZE_CLASSES[props.size] || SIZE_CLASSES.md);

/**
 * The three-dot placeholder is deliberate and NOT an error.
 *
 * A previous version console.error'd on any unknown name. That was wrong twice over:
 * `src/constants/categories.ts` legitimately references sixteen names this registry has
 * never held (`handshake`, `school`, `music`, `stethoscope`, `dumbbell`, …), which
 * `CategoryIcon` binds straight through — so it fired constantly on Transactions, once
 * per icon INSTANCE, from inside a computed getter, and went only to the console where
 * nobody would see it. Noise that loud trains people to ignore the console, which costs
 * more than the missing signal it was meant to buy.
 *
 * The compile-time narrowing on `BEANIE_ICONS` is the real guard for statically-named
 * icons. Data-driven names fall back quietly, as they always did.
 */
const iconDef = computed<BeanieIconDef>(
  () =>
    getIconDef(props.name) || {
      paths: ['M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
    }
);
</script>

<template>
  <svg
    :class="sizeClass"
    fill="none"
    stroke="currentColor"
    :viewBox="iconDef.viewBox || '0 0 24 24'"
    stroke-linecap="round"
    stroke-linejoin="round"
    :stroke-width="strokeWidth"
    aria-hidden="true"
  >
    <path
      v-for="(d, i) in iconDef.paths"
      :key="i"
      :d="d"
      :fill="iconDef.filled?.[i] ? 'currentColor' : 'none'"
      :stroke="iconDef.filled?.[i] ? 'none' : 'currentColor'"
    />
  </svg>
</template>
