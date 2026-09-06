<script setup lang="ts">
/**
 * The wall's ONLY warning channel.
 *
 * `PodAccessBanner`, `SaveFailureBanner` and `DurabilityBanner` all live inside
 * App.vue's `showAppLayout` branch, so a `noChrome: true` route renders NONE of
 * them. Without this stamp the wall would hide exactly the failures it claims
 * to beat the competition on (silent sync death is Skylight's worst bug class).
 *
 * Reuses SAVE_STATUS_PRESENTATION — the existing, exhaustively-tested
 * status→presentation map — and supplies only wall-scale typography.
 *
 * It must ALSO fold in the failure flags that never reach `saveStatus`:
 * `driveFileNotFound`, `podAccessError` and `cachePersistFailed` each have their
 * own App.vue banner, and every one of those banners lives inside the
 * `showAppLayout` branch a `noChrome` route skips. Without them a revoked Drive
 * permission or a deleted `.beanpod` showed a green dot and "Saved 4 minutes
 * ago" — precisely the silent sync death this feature is positioned against.
 */
import { computed, onScopeDispose, ref, watch } from 'vue';
import { SAVE_STATUS_PRESENTATION } from '@/components/ui/saveStatusPresentation';
import { useOnline } from '@/composables/useOnline';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatRelativeTime } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';

const syncStore = useSyncStore();
const { isOnline } = useOnline();
const { t } = useTranslation();

const presentation = computed(() => SAVE_STATUS_PRESENTATION[syncStore.saveStatus]);

/**
 * Failures that have a banner elsewhere but no representation in `saveStatus`.
 *
 * ⚠️ A LINEAGE BLOCK BELONGS HERE. The wall is a `noChrome` route a family may
 * leave up all day, and it renders NONE of App.vue's banners — so without this
 * the one state that needs a human is the one state the wall stays silent
 * about.
 */
const blocked = computed(
  () =>
    syncStore.driveFileNotFound ||
    !!syncStore.podAccessError ||
    syncStore.cachePersistFailed ||
    // ⚠️ `podUnopenable`, not `backgroundSyncErrorKind === 'lineage'`. The
    // narrower test covered the lineage block and MISSED every payload one — a
    // pod that cannot be decrypted or is too large for the device latched the
    // poller off while this stamp went on showing a green dot and "Saved 4
    // minutes ago". This ref is set by the same two functions for every blocker
    // class, so a new one is covered the day it is written.
    syncStore.podUnopenable
);

/**
 * A lineage block reached the file and DECLINED it. Saying "can't reach" there
 * points the family at their network for a problem no network will ever fix.
 */
const isLineage = computed(() => syncStore.backgroundSyncErrorKind === 'lineage');

/**
 * `formatRelativeTime` reads a non-reactive `Date.now()`, so with `lastSync` as
 * the only dependency the age FROZE the moment sync died — the wall would say
 * "saved 2 minutes ago" for three days. This tick re-evaluates it.
 */
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 30_000);
onScopeDispose(() => clearInterval(ticker));

const relative = computed(() => {
  void now.value;
  return formatRelativeTime(syncStore.lastSync);
});

/**
 * Precedence: offline explains a stale save, so it outranks it; a degraded or
 * critical save status must say so in its OWN words rather than being dressed
 * as "saved" in orange. Nothing has ever synced -> say that, not "Saved ".
 */
const label = computed(() => {
  // A broken pod outranks everything: it is the one state where what is on
  // screen may be arbitrarily old and no amount of waiting will fix it.
  if (blocked.value)
    return isLineage.value ? t('wall.status.needsAttention') : t('wall.status.blocked');
  if (!isOnline.value) return t('wall.status.offline');
  if (presentation.value.attention || !syncStore.lastSync) {
    return fillTemplate(t('wall.status.stale'), { when: relative.value || '—' });
  }
  return fillTemplate(t('wall.status.saved'), { when: relative.value });
});

const attention = computed(
  () => blocked.value || !isOnline.value || presentation.value.attention || !syncStore.lastSync
);
const visible = computed(() => presentation.value.visible || attention.value);

/**
 * The wall is unattended, so nobody reports what it is showing — the log has to.
 * Fires on the EDGE only (healthy -> degraded and back), never per tick, so an
 * always-on device cannot flood the firehose.
 */
watch(attention, (isDegraded, was) => {
  if (isDegraded === was) return;
  logEvent({
    level: isDegraded ? 'warn' : 'info',
    surface: 'beanie-wall',
    message: 'wall_stale_data',
    context: {
      action: 'stale_data',
      kind: blocked.value
        ? 'pod_blocked'
        : !isOnline.value
          ? 'offline'
          : isDegraded
            ? 'save_degraded'
            : 'recovered',
    },
  });
});
</script>

<template>
  <p
    v-if="visible"
    class="font-inter wall-stamp flex items-center justify-end gap-1.5"
    :class="attention ? 'text-primary-500 font-semibold' : 'text-[var(--muted-text,#4d5d6c)]'"
  >
    <span
      class="h-[7px] w-[7px] rounded-full"
      :class="attention ? 'bg-[var(--heritage-orange)]' : 'bg-[#27AE60]'"
      aria-hidden="true"
    />
    {{ label }}
  </p>
</template>
