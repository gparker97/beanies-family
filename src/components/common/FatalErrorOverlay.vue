<script setup lang="ts">
/**
 * The "spilled beans" recovery screen: the last thing a person sees when
 * beanies cannot start.
 *
 * ⚠️ EXTRACTED FROM `App.vue` SO IT CAN BE MOUNTED. It lived inline in a root
 * component that pulls in the router, a dozen stores and the whole init
 * sequence, so the app's single most important failure surface was the one
 * screen no test could render. The markup below is a verbatim move; the only
 * changes are the bindings, which are now props and two emits.
 *
 * Purely presentational: it decides nothing. Whether clearing data helps, and
 * whether there is a way out, are answered upstream by `fatalErrorStore` and by
 * `payloadFailureSurface`, and arrive here already settled.
 */
import { ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { FatalActionLink } from '@/stores/fatalErrorStore';

const props = defineProps<{
  /** The user-facing message. Null means the overlay is not shown at all. */
  message: string | null;
  /** Copyable technical detail, inside the disclosure. */
  detail: string | null;
  /**
   * Would "Clear data and start fresh" help? False for a payload failure,
   * where clearing is the one action that destroys the local copy.
   */
  clearDataHelps: boolean;
  /** An optional way out, or null. Rendered only alongside a screened href. */
  action: FatalActionLink | null;
  /** `action.url` after `safeExternalHref`. Null means render no link. */
  actionHref: string | null;
  /** Device diagnostics, already formatted. */
  diagnostics: string;
}>();

const emit = defineEmits<{ reload: []; clearData: [] }>();

const { t } = useTranslation();

/**
 * The destructive panel is local state, and it is closed whenever a NEW fatal
 * arrives. In `App.vue` that reset was one line inside the store watcher; here
 * it belongs to the thing that owns the flag.
 */
const showClearConfirm = ref(false);
watch(
  () => props.message,
  () => {
    showClearConfirm.value = false;
  }
);
</script>

<template>
  <!-- Initialization error recovery screen -->
  <div
    v-if="message"
    class="fixed inset-0 z-[300] flex items-center justify-center bg-[#2C3E50] p-4"
  >
    <div class="dark:bg-surface-raised w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <div class="mb-4 text-center">
        <div
          class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30"
        >
          <svg
            class="h-6 w-6 text-[#F15D22]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5Z"
            />
          </svg>
        </div>
        <h2 class="font-outfit text-xl font-semibold text-[#2C3E50] dark:text-white">
          {{ t('app.initError.title') }}
        </h2>
        <p v-if="clearDataHelps" class="dark:text-ink-soft mt-2 text-sm text-gray-600">
          {{ t('app.initError.description') }}
        </p>
      </div>

      <!-- Error message -->
      <div class="mb-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="dark:text-danger-lift text-sm font-medium text-red-800">{{ message }}</p>
      </div>

      <!-- Action buttons. When the fatal carries a way out (today: "the family
           file needs a newer beanies"), that link is the primary control and
           Reload steps back to secondary, so there is exactly one orange
           button. Reload keeps its place because it is what a person does
           after returning from the store. -->
      <div class="mb-4 flex gap-3">
        <a
          v-if="action && actionHref"
          :href="actionHref"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex flex-1 items-center justify-center rounded-xl bg-[#F15D22] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d9521e]"
        >
          {{ t(action.labelKey) }}
        </a>
        <button
          :class="
            action && actionHref
              ? 'dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-[#2C3E50] transition-colors hover:bg-gray-50'
              : 'flex-1 rounded-xl bg-[#F15D22] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d9521e]'
          "
          @click="emit('reload')"
        >
          {{ t('app.initError.reload') }}
        </button>
        <button
          v-if="clearDataHelps"
          class="dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-[#2C3E50] transition-colors hover:bg-gray-50"
          @click="showClearConfirm = true"
        >
          {{ t('app.initError.clearData') }}
        </button>
      </div>

      <!-- ⚠️ THE URL AS SELECTABLE TEXT, UNCONDITIONALLY, and OUTSIDE the
           `<details>` disclosure below. This is what makes "never a dead end"
           true: an external open can resolve while nothing visibly happens,
           so there is no reliable trigger for showing a fallback only on
           failure. The link is the convenience; this is the guarantee. -->
      <p
        v-if="action && actionHref"
        class="dark:text-ink-soft mt-1 mb-4 text-xs break-all text-gray-500"
      >
        {{ actionHref }}
      </p>

      <!-- Clear data confirmation -->
      <div
        v-if="showClearConfirm && clearDataHelps"
        class="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/20"
      >
        <p class="dark:text-accent-lift mb-2 text-sm text-orange-800">
          {{ t('app.initError.clearConfirm') }}
        </p>
        <div class="flex gap-2">
          <button
            class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            @click="emit('clearData')"
          >
            {{ t('app.initError.clearData') }}
          </button>
          <button
            class="dark:border-line-strong dark:text-ink-soft dark:hover:bg-surface-hover rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            @click="showClearConfirm = false"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>

      <!-- Expandable technical details -->
      <details class="group">
        <summary
          class="dark:text-ink-soft dark:hover:text-ink cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          {{ t('app.initError.details') }}
        </summary>
        <pre
          v-if="detail"
          class="dark:bg-surface-ground dark:text-ink-soft mt-2 max-h-32 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700"
          >{{ detail }}</pre>
        <div class="mt-2">
          <p class="dark:text-ink-soft mb-1 text-xs font-medium text-gray-500">
            {{ t('app.initError.diagnostics') }}
          </p>
          <pre
            class="dark:bg-surface-ground dark:text-ink-soft max-h-24 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700"
            >{{ diagnostics }}</pre>
        </div>
      </details>
    </div>
  </div>
</template>
