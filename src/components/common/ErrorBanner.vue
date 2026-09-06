<script setup lang="ts">
/**
 * Inline-flow severity-tinted banner with an icon + content slots. Shared
 * chrome for `SaveFailureBanner` and any future persistent error UI —
 * each caller supplies its own title, message, and action buttons via
 * named slots; this component owns layout, transitions, and dark-mode
 * styling.
 *
 * Renders inline at the top of the document flow (not `position: fixed`)
 * so it pushes the page chrome (AppHeader, etc.) down rather than
 * overlapping it. This keeps refresh affordances and primary navigation
 * accessible — important on standalone PWAs where there is no browser
 * chrome to fall back to.
 *
 * Severity tokens:
 *   - `critical` — red (blocks user flow; data loss risk) — role="alert"
 *   - `warning`  — amber (degraded state; user can continue) — role="alert"
 *   - `notice`   — Heritage Orange (routine, self-recovering status, e.g. the local
 *                  durability warning) — role="status" (not an urgent alert)
 */

interface Props {
  show: boolean;
  severity?: 'critical' | 'warning' | 'notice';
}

const props = withDefaults(defineProps<Props>(), { severity: 'critical' });
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-full opacity-0"
  >
    <div
      v-if="props.show"
      class="w-full px-4 py-3 text-white shadow-lg"
      :class="{
        'bg-red-600 dark:bg-red-800': props.severity === 'critical',
        'bg-amber-600 dark:bg-amber-700': props.severity === 'warning',
        'bg-primary-500 dark:bg-primary-600': props.severity === 'notice',
      }"
      :role="props.severity === 'notice' ? 'status' : 'alert'"
      :aria-live="props.severity === 'critical' ? 'assertive' : 'polite'"
    >
      <div class="mx-auto flex max-w-3xl flex-col items-start gap-2 sm:flex-row sm:items-center">
        <div class="flex min-w-0 flex-1 items-start gap-2">
          <svg
            class="mt-0.5 h-5 w-5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.072 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div class="min-w-0">
            <p class="text-sm font-semibold"><slot name="title" /></p>
            <p
              class="text-xs"
              :class="{
                'text-red-100': props.severity === 'critical',
                'text-amber-100': props.severity === 'warning',
                // ⚠️ A SOLID TINT, never `text-white/90`. An opacity modifier on
                // text a person reads is categorically out (it composited to
                // 2.96:1 on Heritage Orange), and both siblings above already
                // use a solid class. NOTE for whoever measures this next: even
                // pure white on `primary-500` is only 3.32:1 — the GROUND is too
                // light for AA body text, and no ink fixes that. Darkening the
                // notice ground to `primary-700` would give 5.81:1; that is a
                // brand change across all four banners, not a local one.
                'text-primary-50': props.severity === 'notice',
              }"
            >
              <slot name="message" />
            </p>
          </div>
        </div>
        <div class="flex flex-shrink-0 gap-2"><slot name="actions" /></div>
      </div>
    </div>
  </Transition>
</template>
