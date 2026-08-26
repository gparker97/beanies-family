<script setup lang="ts">
/**
 * Landing route for a Web Share Target POST (#64).
 *
 * The service worker (`public/share-target-sw.js`) intercepts the POST, stashes the files in
 * a Cache entry and 303s here with `?id=`. This page reads that stash, DELETES it, and hands
 * the files to the shared ingest orchestrator — the same one the native adapters use.
 *
 * The user never dwells here: on success the orchestrator routes to the page that owns the
 * matching review modal. This screen only exists for the moments before that, and to say
 * something honest when the stash could not be read.
 */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { deliverPwaShare } from '@/services/share/pwaShareAdapter';
import { reportError } from '@/utils/errorReporter';
import { readAndClearShareStash } from '@/utils/shareStash';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

/** Only set when the share could not be handed over — otherwise we navigate away. */
const failed = ref(false);

onMounted(async () => {
  const id = typeof route.query.id === 'string' ? route.query.id : null;
  // The SW redirects with ?error= when it could not stash the POST at all.
  if (!id) {
    failed.value = true;
    return;
  }

  try {
    const files = await readAndClearShareStash(id);
    if (files.length === 0 || !deliverPwaShare(files)) {
      failed.value = true;
      return;
    }
    // The orchestrator routes to the review surface; leave no /share entry behind it.
    await router.replace('/nook');
  } catch (err) {
    reportError({
      surface: 'share-target-ingest',
      message: 'could not read the web-share stash',
      severity: 'error',
      error: err,
      context: { action: 'threw', os: 'pwa' },
    });
    failed.value = true;
  }
});
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
    <template v-if="failed">
      <p class="font-outfit text-lg font-semibold text-[var(--color-text)]">
        {{ t('shareTarget.failed.title') }}
      </p>
      <p class="font-inter max-w-sm text-sm text-[var(--color-text-muted)]">
        {{ t('shareTarget.failed.message') }}
      </p>
      <RouterLink
        to="/nook"
        class="font-outfit rounded-2xl bg-[#F15D22] px-5 py-2.5 text-sm font-semibold text-white"
      >
        {{ t('shareTarget.failed.action') }}
      </RouterLink>
    </template>
    <template v-else>
      <BeanieSpinner size="lg" :halo="true" />
      <p class="font-outfit text-sm font-semibold text-[var(--color-text)]">
        {{ t('ai.processing') }}
      </p>
    </template>
  </div>
</template>
