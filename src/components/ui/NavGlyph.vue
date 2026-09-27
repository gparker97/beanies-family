<script setup lang="ts">
/**
 * A navigation anchor: an image when `iconSrc` is given (e.g. The Bean Pod's
 * hugging beanies), otherwise the emoji. The emoji is always required because
 * it doubles as the fallback if the image fails to load: never a broken-image
 * box, and never silent (the failure goes to the diagnostic firehose).
 *
 * Decorative: the surrounding button carries the accessible name.
 */
import { ref, watch } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

const props = defineProps<{ emoji: string; iconSrc?: string }>();

const failed = ref(false);
watch(
  () => props.iconSrc,
  () => {
    failed.value = false;
  }
);

function onError() {
  failed.value = true;
  logEvent({
    level: 'warn',
    surface: 'nav-glyph',
    message: 'nav icon failed to load; emoji fallback shown',
  });
}
</script>

<template>
  <img
    v-if="iconSrc && !failed"
    :src="iconSrc"
    alt=""
    aria-hidden="true"
    draggable="false"
    class="inline-block h-6 w-6 object-contain"
    @error="onError"
  />
  <span v-else aria-hidden="true">{{ emoji }}</span>
</template>
