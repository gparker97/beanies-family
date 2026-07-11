<script setup lang="ts">
/**
 * Shared, presentational reconnect toast — the one surface both Google Drive and
 * Google Calendar use when a grant dies and needs re-consent. Purely visual: it
 * owns no store/composable state. Each feature binds its own title/labels and a
 * reconnect handler (see `GoogleReconnectToast.vue`, `CalendarReconnectToast.vue`).
 *
 * CIG: Heritage Orange is the alert colour (never red; amber is not a brand
 * colour). White/slate squircle card, Heritage-Orange left rule + tinted icon
 * chip, Heritage-Orange action button. Matches
 * `docs/mockups/calendar-reconnect-surfaces-2026-07-11.html`.
 *
 * The default lead icon is a warning triangle; pass the `#icon` slot to override
 * (e.g. a 📅 glyph for calendar).
 */
withDefaults(
  defineProps<{
    /** Bold headline, e.g. "Calendar sync paused". */
    title: string;
    /** Optional second line — a recovery hint or the last reconnect error. */
    subtitle?: string;
    /** When true the subtitle is styled as an error rather than a hint. */
    subtitleIsError?: boolean;
    /** Reconnect in progress — disables the button and shows the busy label. */
    busy?: boolean;
    /** Action button label (idle). */
    reconnectLabel: string;
    /** Action button label while busy (defaults to an ellipsis). */
    busyLabel?: string;
    /** Show a dismiss (✕) affordance. */
    dismissible?: boolean;
    /** Accessible label for the dismiss button. */
    dismissLabel?: string;
  }>(),
  {
    subtitle: undefined,
    subtitleIsError: false,
    busy: false,
    busyLabel: '…',
    dismissible: false,
    dismissLabel: undefined,
  }
);

defineEmits<{
  reconnect: [];
  dismiss: [];
}>();
</script>

<template>
  <div
    class="border-primary-500 ring-primary-500/15 dark:ring-primary-500/25 flex items-center gap-3 rounded-2xl border-l-4 bg-white px-4 py-3 shadow-[var(--soft-shadow)] ring-1 dark:bg-slate-800"
    role="status"
  >
    <span
      class="bg-primary-500/12 text-primary-600 dark:text-primary-300 grid h-9 w-9 flex-shrink-0 place-items-center rounded-[12px]"
      aria-hidden="true"
    >
      <slot name="icon">
        <!-- Default: warning triangle -->
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.072 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </slot>
    </span>

    <div class="flex min-w-0 flex-1 flex-col">
      <p class="font-outfit text-sm font-semibold text-slate-700 dark:text-slate-100">
        {{ title }}
      </p>
      <p
        v-if="subtitle"
        class="text-xs"
        :class="
          subtitleIsError
            ? 'text-primary-600 dark:text-primary-300'
            : 'text-slate-500 dark:text-slate-400'
        "
      >
        {{ subtitle }}
      </p>
    </div>

    <button
      type="button"
      :disabled="busy"
      class="font-outfit bg-primary-500 hover:bg-primary-600 flex-shrink-0 rounded-[13px] px-3.5 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-60"
      @click="$emit('reconnect')"
    >
      {{ busy ? busyLabel : reconnectLabel }}
    </button>

    <button
      v-if="dismissible"
      type="button"
      class="flex-shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
      :aria-label="dismissLabel"
      @click="$emit('dismiss')"
    >
      <span aria-hidden="true">&#x2715;</span>
    </button>
  </div>
</template>
