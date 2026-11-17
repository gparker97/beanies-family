<script setup lang="ts">
/**
 * One connected calendar in Settings -> Google Calendar, as a row that opens.
 *
 * The closed row carries what a person scans for: the calendar's name, its account
 * line, a status pill and a chevron. A calendar that needs attention says so on the
 * closed row (`statusTone="attention"`: Heritage Orange, never red), so nothing has
 * to be opened to find a problem. Tapping the row shows the body (the default slot)
 * and the action row (the `actions` slot) underneath.
 *
 * Shared by the synced card (`SyncedCalendarCard`) and the view-only card
 * (`ViewedCalendarCard`). A view: `open` is a `v-model` the drawer owns, because
 * which rows start open depends on the whole drawer (the only calendar, or one just
 * added), not on one card.
 */
import { useId } from 'vue';
import SmoothHeight from '@/components/ui/SmoothHeight.vue';

withDefaults(
  defineProps<{
    name: string;
    /** The account line under the name; empty hides it. */
    account?: string;
    statusLabel: string;
    statusTone?: 'neutral' | 'attention';
    /** A view-only calendar's color, drawn as the hollow dot; omitted for a synced one. */
    dotColor?: string | null;
  }>(),
  { account: '', statusTone: 'neutral', dotColor: null }
);

const open = defineModel<boolean>('open', { default: false });

const bodyId = useId();
</script>

<template>
  <div class="dark:border-line rounded-2xl border border-[var(--tint-slate-10)]">
    <button
      type="button"
      class="focus-visible:ring-sky-silk-300 flex w-full items-center gap-2 rounded-2xl p-3 text-left transition-colors hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="bodyId"
      data-testid="calendar-card-toggle"
      @click="open = !open"
    >
      <span
        v-if="dotColor"
        class="view-only-dot h-3 w-3 shrink-0 rounded-full border-2"
        :style="{ '--vo-hue': dotColor }"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">
        <span
          class="font-outfit text-secondary-500 dark:text-ink block truncate text-base font-semibold"
          data-testid="calendar-card-name"
        >
          {{ name }}
        </span>
        <span
          v-if="account"
          class="text-secondary-400 dark:text-ink-soft block truncate text-xs"
          data-testid="calendar-card-account"
        >
          {{ account }}
        </span>
      </span>
      <!-- The tints are themed custom properties (style.css redefines them under
           `.dark`), so both pills have their dark background without a utility. -->
      <span
        class="font-outfit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
        :class="
          statusTone === 'attention'
            ? 'text-primary-700 dark:text-accent-lift bg-[var(--tint-orange-8)]'
            : 'text-secondary-400 dark:text-ink-soft bg-[var(--tint-slate-5)]'
        "
        :data-tone="statusTone"
        data-testid="calendar-card-status"
      >
        {{ statusLabel }}
      </span>
      <span
        class="text-secondary-400 dark:text-ink-soft grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--tint-slate-5)]"
        aria-hidden="true"
      >
        <svg
          class="h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none"
          :class="open ? 'rotate-180' : ''"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </span>
    </button>

    <!-- `v-show`, so `aria-controls` always names an element. SmoothHeight animates
         the open and close, and skips it under prefers-reduced-motion. -->
    <SmoothHeight :revision="open">
      <div
        v-show="open"
        :id="bodyId"
        class="dark:border-line mx-3 space-y-3 border-t border-[var(--tint-slate-10)] py-3"
        data-testid="calendar-card-body"
      >
        <slot />
        <div v-if="$slots.actions" class="flex flex-wrap gap-2" data-testid="calendar-card-actions">
          <slot name="actions" />
        </div>
      </div>
    </SmoothHeight>
  </div>
</template>
