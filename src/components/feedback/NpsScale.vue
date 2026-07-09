<script setup lang="ts">
/**
 * #45 — NPS 0–10 "warmth track". A single continuous CIG gradient (Heritage
 * Orange mixed into white: pale peach at 0 → full Heritage Orange at 10). The
 * selected step lifts with a Sky Silk focus ring. Numerals stay legible: Deep
 * Slate on the light left steps, white on the deep-orange 8–10. Keyboard-operable
 * (arrow / home / end). rem-based; standard Tailwind text classes only.
 */
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ modelValue: number | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const { t } = useTranslation();

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function select(score: number): void {
  emit('update:modelValue', score);
}

function scoreAria(score: number): string {
  return fillTemplate(t('feedback.nps.scoreAria'), { score });
}

function onKeydown(e: KeyboardEvent): void {
  const current = props.modelValue ?? -1;
  let next: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(10, current + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
    next = Math.max(0, current < 0 ? 0 : current - 1);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = 10;
  if (next !== null) {
    e.preventDefault();
    select(next);
  }
}
</script>

<template>
  <div>
    <div
      class="nps-track flex"
      role="radiogroup"
      :aria-label="t('feedback.nps.question')"
      @keydown="onKeydown"
    >
      <button
        v-for="score in SCORES"
        :key="score"
        type="button"
        role="radio"
        :aria-checked="modelValue === score"
        :aria-label="scoreAria(score)"
        :tabindex="modelValue === score || (modelValue === null && score === 0) ? 0 : -1"
        class="nps-seg font-outfit text-sm font-semibold"
        :class="[
          modelValue === score ? 'is-selected font-bold' : '',
          score >= 8 ? 'text-white' : 'text-[var(--color-slate,#2C3E50)]',
        ]"
        @click="select(score)"
      >
        {{ score }}
      </button>
    </div>
    <div
      class="mt-2 flex justify-between text-xs text-[color:rgba(44,62,80,0.5)] dark:text-gray-400"
    >
      <span>{{ t('feedback.nps.low') }}</span>
      <span>{{ t('feedback.nps.high') }}</span>
    </div>
  </div>
</template>

<style scoped>
/* CIG warmth ramp — Heritage Orange (#F15D22) mixed into white; smooth, continuous. */
.nps-track {
  background: linear-gradient(
    90deg,
    rgb(253 236 229) 0%,
    rgb(248 179 151) 45%,
    rgb(244 131 84) 78%,
    rgb(241 93 34) 100%
  );
  border-radius: 0.75rem;
}

.nps-seg {
  background: transparent;
  border: none;
  cursor: pointer;
  flex: 1 1 0;
  padding: 0.8rem 0;
  position: relative;
  transition:
    transform 120ms ease,
    box-shadow 120ms ease;
}

.nps-seg:first-child {
  border-radius: 0.75rem 0 0 0.75rem;
}

.nps-seg:last-child {
  border-radius: 0 0.75rem 0.75rem 0;
}

.nps-seg:hover {
  transform: translateY(-2px);
  z-index: 2;
}

.nps-seg:focus-visible {
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 4px #aed6f1;
  outline: none;
  z-index: 3;
}

/* Sky Silk focus ring (CIG) + soft lift */
.nps-seg.is-selected {
  border-radius: 0.625rem;
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 4px #aed6f1,
    0 8px 18px rgb(44 62 80 / 22%);
  transform: translateY(-3px);
  z-index: 3;
}

@media (prefers-reduced-motion: reduce) {
  .nps-seg {
    transition: none;
  }
}
</style>
