<script setup lang="ts">
/**
 * The big one: a full-list completion.
 *
 * Deliberately NOT a modal. It covers the viewport, ignores pointer events and
 * removes itself on a timer, so it works identically on a phone in your hand
 * and on a tablet bolted to a kitchen wall that nobody will ever tap to
 * dismiss. The single tick has a small burst; finishing a whole list earns
 * this.
 *
 * CIG: the confetti is the Pod in its mandated order (Deep Slate, Terracotta,
 * Heritage Orange, Sky Silk), bean-shaped rather than rectangular, with soft
 * shadows and no Alert Red — warm, not loud.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  SHOWER_DURATION_MS,
  SHOWER_UNDO_DURATION_MS,
  useCelebration,
} from '@/composables/useCelebration';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { activeShower, mode, dismissShower } = useCelebration();
const { prefersReducedMotion } = useReducedMotion();

/**
 * Pod order is mandated by the CIG and must never be reordered or recoloured.
 *
 * Literal hex, not `var(--deep-slate)` etc: only `--heritage-orange` is defined
 * anywhere in the repo, so three of the four resolved to an invalid `background`
 * and 27 of the 36 beans fell transparently.
 */
const POD = ['#2C3E50', '#E67E22', '#F15D22', '#AED6F1'];
const BEAN_COUNT = 36;

function scatter() {
  return Array.from({ length: BEAN_COUNT }, (_, i) => ({
    id: i,
    left: Math.round((i / BEAN_COUNT) * 100 + (Math.random() * 6 - 3)),
    colour: POD[i % POD.length],
    delay: Math.round(Math.random() * 900),
    duration: 2600 + Math.round(Math.random() * 1400),
    drift: Math.round(Math.random() * 80 - 40),
    spin: Math.round(Math.random() * 540 - 270),
    scale: 0.7 + Math.random() * 0.6,
  }));
}

/**
 * Re-scattered per CELEBRATION, not per mount. This component is mounted once
 * at boot by `CelebrationOverlay` and never unmounts, so a mount-time scatter
 * froze the randomisation for the whole session — the same 36 beans down the
 * same tracks every time, most obvious on a wall where one family finishes the
 * same recurring list every day. Still stable during a fall: it is resampled
 * only when a new celebration starts, never on an unrelated reactive update.
 */
const beans = ref(scatter());

let timer: ReturnType<typeof setTimeout> | undefined;

const showUndo = computed(() => mode.value.allowUndo && !!activeShower.value?.onUndo);

/**
 * Arm the timer when a celebration STARTS, not when this component mounts.
 *
 * `<CelebrationOverlay>` renders this once at app boot and never unmounts it
 * (the `v-if` lives inside the Teleport, so it gates the DOM, not the
 * instance). An `onMounted` timer therefore fired once, at boot, against
 * `activeShower === null` — leaving every real celebration with no timer and
 * no way to dismiss it, because the overlay is `pointer-events: none`.
 */
watch(
  () => activeShower.value?.id,
  (id) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (id === undefined) return;
    beans.value = scatter();
    // Sampled per-celebration so a surface's override (the wall's 6s) applies.
    // An undoable celebration gets the longer default — see SHOWER_UNDO_DURATION_MS.
    const fallback = showUndo.value ? SHOWER_UNDO_DURATION_MS : SHOWER_DURATION_MS;
    timer = setTimeout(() => dismissShower(id), mode.value.autoDismissMs ?? fallback);
  },
  { immediate: true }
);

// A timer must never outlive the celebration it belongs to.
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

function undo() {
  const celebration = activeShower.value;
  if (!celebration) return;
  celebration.onUndo?.();
  dismissShower(celebration.id);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeShower"
      class="pointer-events-none fixed inset-0 z-[190] overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <!-- confetti: suppressed entirely under reduced motion -->
      <template v-if="!prefersReducedMotion">
        <span
          v-for="bean in beans"
          :key="bean.id"
          class="shower-bean"
          :style="{
            left: `${bean.left}%`,
            background: bean.colour,
            animationDelay: `${bean.delay}ms`,
            animationDuration: `${bean.duration}ms`,
            '--drift': `${bean.drift}px`,
            '--spin': `${bean.spin}deg`,
            '--scale': bean.scale,
          }"
        />
      </template>

      <!--
        A soft scrim under the message. Without it the mascot and the cheer sat
        directly on top of whatever was behind them — on the wall that is seven
        columns of dense text, and the celebration was unreadable at exactly the
        moment it was meant to be enjoyed. Radial, so the screen still shows
        through at the edges and the wall does not feel blanked.
      -->
      <div class="shower-scrim absolute inset-0" />

      <div class="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center px-6">
        <div
          class="flex max-w-md flex-col items-center rounded-[32px] bg-white/85 px-8 py-6 shadow-[0_18px_60px_rgba(44,62,80,0.22)] backdrop-blur-md dark:bg-slate-900/85"
        >
          <img
            :src="activeShower.asset"
            alt=""
            class="w-full max-w-xs object-contain drop-shadow-lg"
            :class="prefersReducedMotion ? '' : 'shower-mascot'"
          />
          <p
            class="font-caveat mt-2 text-center text-[var(--heritage-orange)]"
            :class="prefersReducedMotion ? 'text-3xl' : 'shower-message text-4xl'"
          >
            {{ activeShower.message }}
          </p>
        </div>
        <button
          v-if="showUndo"
          type="button"
          class="font-outfit pointer-events-auto mt-4 rounded-2xl bg-white/90 px-5 py-2 text-sm font-medium text-gray-500 shadow-sm transition-colors hover:text-[var(--heritage-orange)] dark:bg-slate-800/90 dark:text-gray-400"
          @click="undo"
        >
          {{ t('celebration.madeMistakeUndo') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.shower-scrim {
  background: radial-gradient(
    60% 45% at 50% 50%,
    rgb(44 62 80 / 34%),
    rgb(44 62 80 / 10%) 60%,
    transparent 78%
  );
}

.shower-bean {
  animation-fill-mode: both;
  animation-name: shower-fall;
  animation-timing-function: cubic-bezier(0.35, 0.1, 0.5, 1);

  /* an organic bean, not a rectangle */
  border-radius: 50% 50% 48% 48% / 62% 62% 38% 38%;
  box-shadow: 0 1px 3px rgb(44 62 80 / 18%);
  display: block;
  height: 1rem;
  position: absolute;
  top: -8%;
  width: 0.75rem;
}

@keyframes shower-fall {
  0% {
    opacity: 0;
    transform: translate3d(0, 0, 0) rotate(0deg) scale(var(--scale, 1));
  }

  8% {
    opacity: 1;
  }

  85% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(var(--drift, 0), 108vh, 0) rotate(var(--spin, 180deg))
      scale(var(--scale, 1));
  }
}

.shower-mascot {
  animation: shower-settle 620ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}

@keyframes shower-settle {
  0% {
    opacity: 0;
    transform: scale(0.72) translateY(14px);
  }

  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.shower-message {
  animation: shower-message-in 700ms 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}

@keyframes shower-message-in {
  0% {
    opacity: 0;
    transform: translateY(10px) rotate(-2deg);
  }

  100% {
    opacity: 1;
    transform: translateY(0) rotate(-1deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shower-bean,
  .shower-mascot,
  .shower-message {
    animation: none;
  }
}
</style>
