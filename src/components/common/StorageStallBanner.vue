<script setup lang="ts">
/**
 * "This browser's storage is not answering" banner. A thin wrapper over the shared
 * `ErrorBanner` chrome (the `DurabilityBanner` pattern), bound to the one flag the
 * storage layer raises (`utils/storageStall.ts`). No state of its own.
 *
 * Rendered in BOTH App.vue branches (the app shell and the sign-in pages), because the
 * hang this explains happens mostly before a family is open: the person is on a spinner
 * and nothing else on screen says what to do. Heritage-Orange `notice` tone; it clears
 * by itself the moment storage answers.
 *
 * The message is the boot overlay's `app.initError.registryBlocked` sentence, reused so
 * the two surfaces cannot drift.
 */
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { storageStalled } from '@/utils/storageStall';
import { hardReload } from '@/utils/hardReload';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();

function reload(): void {
  hardReload().catch((e: unknown) => {
    reportError({
      surface: 'storage-stall',
      severity: 'warning',
      message: 'reload from the storage-stall banner failed',
      error: e,
    });
    // The page was not replaced; a plain reload is the remaining way out.
    window.location.reload();
  });
}
</script>

<template>
  <ErrorBanner :show="storageStalled" severity="notice">
    <template #title>{{ t('storageStall.title') }}</template>
    <template #message>{{ t('app.initError.registryBlocked') }}</template>
    <template #actions>
      <!-- Neutral-on-orange, the DurabilityBanner button. -->
      <button
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
        data-testid="storage-stall-reload"
        @click="reload"
      >
        {{ t('app.initError.reload') }}
      </button>
    </template>
  </ErrorBanner>
</template>
