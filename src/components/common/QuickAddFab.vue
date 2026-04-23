<script setup lang="ts">
/**
 * Global quick-add FAB.
 *
 * Mounted once in App.vue. Visibility is driven entirely by
 * `route.meta.hideQuickAdd` — no store, no reactive subscription beyond
 * the current route. Click state goes through the `useQuickAdd`
 * singleton so `QuickAddSheet` (mounted alongside) opens in sync.
 *
 * The SVG is drawn from the `#beanie-plus-fab` inline sprite mounted
 * once in App.vue. A single source keeps the asset identity clear; CSS
 * custom properties cascade into the sprite so dark mode swaps the
 * circle fill without shipping a second file.
 */
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';

const route = useRoute();
const { t } = useTranslation();
const { isOpen, toggle } = useQuickAdd();

const showFab = computed(() => !route.meta.hideQuickAdd);

// Dev guard: alert loudly during development if App.vue forgot to mount
// the sprite. Production ships with the sprite in the root template, so
// this branch is a safety net for refactors — not a runtime behavior.
onMounted(() => {
  if (import.meta.env.DEV && !document.getElementById('beanie-plus-fab')) {
    console.error(
      '[QuickAddFab] #beanie-plus-fab sprite not found in DOM — mount it in App.vue so <use href> resolves.'
    );
  }
});
</script>

<template>
  <button
    v-if="showFab"
    type="button"
    class="fab"
    :class="{ 'fab-open': isOpen }"
    :aria-label="t('quickAdd.fab.label')"
    :aria-expanded="isOpen"
    @click="toggle"
  >
    <svg class="fab-icon" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <use href="#beanie-plus-fab" />
    </svg>
  </button>
</template>

<style scoped>
.fab {
  animation: fab-peek 2.6s ease-in-out infinite;
  background: transparent;
  border: 0;
  border-radius: 9999px;

  /* Clears MobileBottomNav (~56px tall + safe-area). */
  bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
  box-shadow:
    0 12px 28px -8px rgb(241 93 34 / 45%),
    0 4px 8px rgb(44 62 80 / 18%);
  cursor: pointer;
  height: 64px;
  padding: 0;
  position: fixed;
  right: 16px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.25s ease-out;
  width: 64px;
  z-index: 40;
}

@media (width >= 768px) {
  .fab {
    bottom: 24px;
    right: 24px;
  }
}

.fab:hover {
  box-shadow:
    0 12px 28px -8px rgb(241 93 34 / 55%),
    0 0 0 4px rgb(241 93 34 / 15%),
    0 4px 8px rgb(44 62 80 / 18%);
}

.fab:active {
  animation: none;
  transform: scale(0.94);
}

.fab:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 3px;
}

.fab-open {
  animation: none;
  transform: rotate(45deg) scale(0.96);
}

.fab-icon {
  display: block;
  height: 100%;
  width: 100%;
}

/*
 * The inlined sprite's background circle uses
 *   fill="var(--fab-bg, url(#bfab-bg))"
 * so setting --fab-bg here swaps the gradient without shipping a
 * second asset. Light mode falls through to the SVG's own default.
 */
:global(.dark) .fab-icon {
  --fab-bg: url('#bfab-bg-dark');
}

@keyframes fab-peek {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fab {
    animation: none;
    transition: none;
  }

  .fab-open {
    transform: none;
  }
}
</style>
