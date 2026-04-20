<script setup lang="ts">
/**
 * Fixed-top severity-tinted banner with an icon + content slots. Shared
 * chrome for `SaveFailureBanner`, `PhotoAccessRecoveryBanner`, and any
 * future persistent error UI — each caller supplies its own title,
 * message, and action buttons via named slots; this component owns
 * layout, transitions, positioning, and dark-mode styling.
 *
 * Severity tokens:
 *   - `critical` — red (blocks user flow; data loss risk)
 *   - `warning`  — amber (degraded state; user can continue)
 */

interface Props {
  show: boolean;
  severity?: 'critical' | 'warning';
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
      class="fixed top-0 right-0 left-0 z-[250] px-4 py-3 text-white shadow-lg"
      :class="
        props.severity === 'critical'
          ? 'bg-red-600 dark:bg-red-800'
          : 'bg-amber-600 dark:bg-amber-700'
      "
      role="alert"
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
              :class="props.severity === 'critical' ? 'text-red-100' : 'text-amber-100'"
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
