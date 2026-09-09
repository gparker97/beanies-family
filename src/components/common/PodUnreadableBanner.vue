<script setup lang="ts">
/**
 * "beanies could not open your family file." The persistent surface for the
 * seven blocker conditions that map to the `decrypt` kind.
 *
 * ⚠️ WHY THIS EXISTS. These conditions LATCH sync off for the whole session, and
 * the only thing that reached the user was a four-second toast from
 * `BackgroundSyncBar` — whose own comment admitted it was the only surface any
 * of it had. A session-ending state announced in a toast the user cannot finish
 * reading is, in practice, not announced.
 *
 * ⚠️ ONE COMPONENT FOR ALL SEVEN, NOT A MEMORY-ONLY BANNER. `podTooLarge.inline`
 * (the Galaxy Tab's out-of-memory case) is not special: it maps to `decrypt`
 * alongside `podCorrupted`, `podCredentialStale`, `podUnreadable`,
 * `podNewerVersion`, `podOlderVersion` and `podMerge.failedInline`. A
 * memory-only banner would leave the other six speaking only through that toast,
 * and would be the third near-copy of this file. The message comes from
 * `podBlockMessageKey` — the same key the toast already passed as its detail —
 * so all seven get honest, specific copy with no new strings and no ternary.
 *
 * ⚠️ THE RETRY IS HONEST FOR FIVE OF THE SEVEN, AND THAT IS THE ACCEPTED
 * BEHAVIOUR. No number of retries lets this build read a pod version it cannot
 * parse, so `podNewerVersion` / `podOlderVersion` half-open, fail identically and
 * re-latch with the same message. That is correct and it is pinned by a test.
 * Do NOT add a per-kind action table to "fix" it: that is the switch-with-one-
 * arm-per-condition this component exists to avoid, and the message binding
 * already tells the user the true story.
 *
 * Heritage Orange (`notice`), never Alert Red: sync has stopped, but nothing is
 * lost and nothing is being deleted. Red is for destructive confirms.
 */
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import BannerActionButton from '@/components/common/BannerActionButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useBlockerLatch } from '@/composables/useBlockerLatch';
import { useSyncStore } from '@/stores/syncStore';
import { showToast } from '@/composables/useToast';
import { presentRefreshOutcome } from '@/components/common/refreshOutcome';
import { logEvent } from '@/services/telemetry';

const { t } = useTranslation();
const syncStore = useSyncStore();

// Only the state half. This banner's exit is a RETRY, not the family-file adopt
// that `useBlockerBanner` owns — which is exactly the case that made the state
// half worth extracting. See `useBlockerLatch`'s header.
const { blocked, dismissed, busy } = useBlockerLatch('decrypt');

/**
 * Half-open the latch and try the read again.
 *
 * `backgroundSyncFromFile(…, { manual: true })` is the retry that already exists
 * — it calls `syncService.retryAfterRemoteBlock()` internally. There is no
 * `syncStore.retryAfterRemoteBlock`; do not add one.
 */
async function tryAgain(): Promise<void> {
  // ⚠️ CLAIM `busy` BEFORE THE AWAIT. Same rule the composable documents: a flag
  // set after the await leaves the whole in-flight window unguarded, so two taps
  // run two retries.
  if (busy.value) return;
  busy.value = true;
  try {
    const outcome = await syncStore.backgroundSyncFromFile(undefined, { manual: true });
    const { toast } = presentRefreshOutcome(outcome);
    // ⚠️ ONE OUTCOME, NOT A BLANKET `else`. `presentRefreshOutcome` returns
    // nothing for THREE outcomes and they need three different answers:
    //
    //   'decrypt-failed'    — its premise ("BackgroundSyncBar already toasts")
    //                         is exactly what this banner's arrival made false,
    //                         since the bar now suppresses that toast. It is also
    //                         the outcome a retry here will MOST often produce.
    //                         So this is the one we speak for.
    //   'network-failed'    — the kind becomes 'network', which is NOT bannered,
    //                         so the bar is NOT suppressed and toasts already. A
    //                         fallback here would double it, both blaming the
    //                         device for a dropped connection.
    //   'skipped-in-flight' — no work was done and a sync is running that may
    //                         well succeed. Claiming a failure would be a lie.
    //
    // The message is the RETRY's own, not a repeat of the banner title sitting
    // directly above it.
    if (toast) showToast(toast.type, t(toast.key));
    else if (outcome === 'decrypt-failed') showToast('warning', t('sync.retryFailedStillBlocked'));
  } catch (e) {
    // Classified, never a bare `catch {}` — CLAUDE.md § Observability rule 2.
    logEvent({
      level: 'warn',
      surface: 'pod-load-failure',
      message: 'retry from the pod-unreadable banner threw',
      context: { action: 'banner-retry-failed' },
      error: e instanceof Error ? e : undefined,
    });
    showToast('warning', t('sync.backgroundError'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ t('sync.podUnopenable') }}</template>
    <!-- The store's own key for THIS condition. `v-if` rather than a fallback
         string: a blocker always sets the key alongside the latch, so an absent
         one is a store bug that should be visible as a missing line, not papered
         over with a generic sentence that would be wrong for six of the seven. -->
    <template v-if="syncStore.podBlockMessageKey" #message>
      {{ t(syncStore.podBlockMessageKey) }}
    </template>
    <template #actions>
      <BannerActionButton :busy="busy" @click="tryAgain">
        {{ t('action.tryAgain') }}
      </BannerActionButton>
      <BannerActionButton subtle @click="dismissed = true">
        {{ t('action.dismiss') }}
      </BannerActionButton>
    </template>
  </ErrorBanner>
</template>
