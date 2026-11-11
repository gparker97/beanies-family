<script lang="ts">
/** How long a sign-in spinner may run before it owes the person a sentence. */
export const LOGIN_SLOW_AFTER_MS = 10_000;
</script>

<script setup lang="ts">
/**
 * A caption that appears under a sign-in spinner once it has been up too long.
 *
 * Mounted INSIDE each spinner block, so its lifetime is the spinner's: no view or
 * phase bookkeeping, and a spinner that clears in time never shows it. A spinner is a
 * promise that something is happening; past `LOGIN_SLOW_AFTER_MS` the person is owed a
 * sentence, and one thing they can do. Logged once per appearance so slow opens are
 * countable by `where`.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry';

const props = defineProps<{ where: 'init' | 'flow' | 'loading' }>();
const { t } = useTranslation();
const slow = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  timer = setTimeout(() => {
    slow.value = true;
    logEvent({
      level: 'warn',
      surface: 'login-flow',
      message: 'slow_spinner',
      context: { action: 'slow_spinner', detail: `where=${props.where}` },
    });
  }, LOGIN_SLOW_AFTER_MS);
});

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
  <p
    v-if="slow"
    class="dark:text-ink-soft mx-auto mt-3 max-w-xs text-sm text-gray-500"
    role="status"
    data-testid="login-slow-notice"
  >
    {{ t('auth.loadingSlow') }}
  </p>
</template>
