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
 * The registry is `satisfies`-narrowed so a typo in a STATIC name is a compile error.
 * But `name` stays `string` on purpose — CategoryIcon resolves data-driven names and
 * AccountTypeIcon builds one from a template literal — so the compile-time guarantee
 * only covers the statically-bound call sites.
 *
 * Hence the noise: a three-dot circle looks deliberate, which makes it the worst
 * possible fallback to render silently. Say so once per unknown name.
 */
const warnedIcons = new Set<string>();

const iconDef = computed<BeanieIconDef>(() => {
  const def = getIconDef(props.name);
  if (def) return def;
  if (!warnedIcons.has(props.name)) {
    warnedIcons.add(props.name);
    console.error(
      `[beanieIcon] unknown icon "${props.name}" — add it to BEANIE_ICONS in ` +
        `src/constants/icons.ts, or fix the name. Rendering the placeholder.`
    );
  }
  // Fallback: three-dot circle (matches CategoryIcon default)
  return { paths: ['M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'] };
});
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
