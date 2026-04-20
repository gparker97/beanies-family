<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  size?: SpinnerSize;
  /** Render the "counting beans" text under the graphic. */
  label?: boolean;
  /** Ambient halo, orbit ring, and gradient-sweep label. Defaults to on
   * whenever `label` is on (full-page loading states) and off otherwise
   * (inline affordances like photo thumbnails and avatar pickers). */
  halo?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  label: false,
  halo: undefined,
});

const { t } = useTranslation();

const sizeClasses = computed(() => {
  const sizes: Record<SpinnerSize, string> = {
    xs: 'h-4 w-4',
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24',
  };
  return sizes[props.size];
});

const labelClasses = computed(() => {
  const sizes: Record<SpinnerSize, string> = {
    xs: 'text-xs',
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-sm',
    xl: 'text-base',
  };
  return sizes[props.size];
});

// Strip trailing dots / ellipsis from the translated "counting beans…"
// string so we can render our own animated dots after it.
const labelText = computed(() => t('action.loading').replace(/[.…\s]+$/, ''));

// Atmosphere defaults on for labelled (full-page) spinners, off for
// inline affordances. Callers can still force it either way via the prop.
const showHalo = computed(() => props.halo ?? props.label);
</script>

<template>
  <div class="beanie-spinner" :class="{ 'bs-atmospheric': showHalo }">
    <div class="bs-core" :class="sizeClasses">
      <span v-if="showHalo" class="bs-halo" aria-hidden="true" />
      <div class="bs-breath">
        <img
          src="/brand/beanies_spinner_transparent_192x192.png"
          :alt="t('action.loading')"
          class="bs-beans"
          :class="{ 'bs-beans-glow': showHalo }"
        />
      </div>
    </div>

    <div
      v-if="label"
      class="bs-label"
      :class="labelClasses"
      role="status"
      :aria-label="t('action.loading')"
    >
      <span class="bs-label-text">{{ labelText }}</span>
      <span class="bs-dots" aria-hidden="true">
        <span class="bs-dot" />
        <span class="bs-dot" />
        <span class="bs-dot" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.beanie-spinner {
  align-items: center;
  display: inline-flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ── Spinner graphic ─────────────────────────────────────────────────── */

.bs-core {
  align-items: center;
  display: inline-flex;
  justify-content: center;
  position: relative;
}

.bs-breath {
  align-items: center;
  animation: beanie-spinner-breath 2.6s ease-in-out infinite;
  display: inline-flex;
  height: 100%;
  justify-content: center;
  position: relative;
  width: 100%;
  will-change: transform;
}

.bs-beans {
  animation: beanie-spinner-spin 1.8s linear infinite;
  height: 100%;
  width: 100%;
  will-change: transform;
}

.bs-beans-glow {
  animation:
    beanie-spinner-spin 1.8s linear infinite,
    beanie-spinner-glow 3.2s ease-in-out infinite;
}

/* Soft radial atmosphere behind the beans. Wide inset (-40%) gives the
   gradient plenty of room to fade all the way to transparent at the
   edges — no hard disc boundary, just warmth dissipating into the page. */
.bs-halo {
  animation: beanie-spinner-halo 3.2s ease-in-out infinite;
  background: radial-gradient(
    circle at 50% 50%,
    rgb(241 93 34 / 28%) 0%,
    rgb(241 93 34 / 10%) 35%,
    transparent 85%
  );
  border-radius: 9999px;
  filter: blur(10px);
  inset: -40%;
  pointer-events: none;
  position: absolute;
  will-change: transform, opacity;
}

/* ── Label ────────────────────────────────────────────────────────────── */

.bs-label {
  align-items: center;
  display: inline-flex;
  font-family: Outfit, system-ui, sans-serif;
  font-weight: 600;
  gap: 0.3em;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* Multi-stop gradient sweeps across the letters. 300% background-size +
   a 200% position shift means the full palette passes through the word
   once per cycle — synced near the spin tempo but not exact, so they
   never look mechanically linked. */
.bs-label-text {
  animation: beanie-spinner-sweep 3.2s linear infinite;
  background: linear-gradient(
    90deg,
    #f15d22 0%,
    #e67e22 18%,
    #ffd93d 38%,
    #00b4d8 58%,
    #e67e22 80%,
    #f15d22 100%
  );
  background-clip: text;
  background-size: 300% 100%;
  color: transparent;
}

.bs-dots {
  align-items: center;
  display: inline-flex;
  gap: 0.18em;
  padding-bottom: 0.05em;
}

.bs-dot {
  animation: beanie-spinner-dot 1.2s ease-in-out infinite;
  border-radius: 9999px;
  display: inline-block;
  height: 0.3em;
  width: 0.3em;
  will-change: transform, opacity;
}

.bs-dot:nth-child(1) {
  animation-delay: 0ms;
  background: #f15d22;
}

.bs-dot:nth-child(2) {
  animation-delay: 150ms;
  background: #e67e22;
}

.bs-dot:nth-child(3) {
  animation-delay: 300ms;
  background: #00b4d8;
}

/* Non-atmospheric fallback: use the prior muted grey so inline spinners
   (which opt out of the halo) keep their restrained treatment. */
.beanie-spinner:not(.bs-atmospheric) .bs-label-text {
  animation: none;
  background: none;
  color: rgb(44 62 80 / 50%);
}

:global(.dark) .beanie-spinner:not(.bs-atmospheric) .bs-label-text {
  color: rgb(189 195 199 / 50%);
}

/* ── Keyframes ────────────────────────────────────────────────────────── */

@keyframes beanie-spinner-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes beanie-spinner-breath {
  0%,
  100% {
    transform: scale(0.98);
  }

  50% {
    transform: scale(1.04);
  }
}

@keyframes beanie-spinner-halo {
  0%,
  100% {
    opacity: 0.85;
    transform: scale(0.95);
  }

  33% {
    opacity: 1;
    transform: scale(1.08);
  }

  66% {
    opacity: 0.9;
    transform: scale(1.02);
  }
}

/* Cycles the drop-shadow color through the brand palette. Two layers
   (a tight rim glow + a softer offset shadow) land the beans in space. */
@keyframes beanie-spinner-glow {
  0%,
  100% {
    filter: drop-shadow(0 0 6px rgb(241 93 34 / 55%)) drop-shadow(0 3px 6px rgb(44 62 80 / 18%));
  }

  33% {
    filter: drop-shadow(0 0 8px rgb(0 180 216 / 50%)) drop-shadow(0 3px 6px rgb(44 62 80 / 18%));
  }

  66% {
    filter: drop-shadow(0 0 7px rgb(230 126 34 / 55%)) drop-shadow(0 3px 6px rgb(44 62 80 / 18%));
  }
}

@keyframes beanie-spinner-sweep {
  from {
    background-position: 0% 50%;
  }

  to {
    background-position: 200% 50%;
  }
}

@keyframes beanie-spinner-dot {
  0%,
  80%,
  100% {
    opacity: 0.55;
    transform: translateY(0) scale(0.75);
  }

  40% {
    opacity: 1;
    transform: translateY(-38%) scale(1);
  }
}

/* ── Reduced motion — keep a gentle pulse, kill the kinetic layers ──── */

@media (prefers-reduced-motion: reduce) {
  .bs-breath,
  .bs-halo {
    animation: none;
  }

  .bs-beans,
  .bs-beans-glow {
    animation: beanie-spinner-pulse 1.8s ease-in-out infinite;
    filter: none;
  }

  .bs-label-text {
    animation: none;
    background: none;
    color: var(--color-primary, #f15d22);
  }

  .bs-dot {
    animation: none;
    opacity: 0.85;
  }
}

@keyframes beanie-spinner-pulse {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(0.98);
  }

  50% {
    opacity: 1;
    transform: scale(1.02);
  }
}
</style>
