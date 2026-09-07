<script setup lang="ts">
/**
 * "beanies could not open this device's own copy of your family data."
 *
 * ⚠️ WHY THIS IS ITS OWN COMPONENT AND NOT A THIRD ARM IN `LineageBanner`.
 * That component's gate is `=== 'lineage'`, its title and message are two-way
 * ternaries on `isConflict`, and its whole doc-comment is about combining
 * histories. A third condition makes all three of those three-way and makes the
 * comment false — a decision nested inside a decision, in a component that
 * already carries two. The house pattern is one thin `ErrorBanner` wrapper per
 * condition (`DurabilityBanner`, `SaveFailureBanner`, `PodAccessBanner`,
 * `LineageBanner`), each small enough to read in one screen and test on its own.
 *
 * ⚠️ AND WHY IT EXISTS AT ALL. When the local cache could not be READ, the app
 * used to treat this device as EMPTY and install the family file wholesale —
 * silently discarding work that had never been saved anywhere, with no banner,
 * no rebase and nothing in the firehose. The refusal that replaced that must be
 * visible, or it is just a quieter version of the same bug. Three review passes
 * of the plan each produced a refusal whose banner could not render; this is the
 * render site, and there is a mounted test that proves it.
 *
 * The reassurance leads because it is both true and the thing the user needs
 * first: nothing has been replaced, their unsaved work is still here.
 *
 * Heritage Orange (`notice`), never Alert Red — nothing is lost and nothing is
 * being deleted. The discard itself goes through `confirm({ variant: 'danger' })`
 * inside the store action, exactly as `LineageBanner` does.
 */
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import BannerActionButton from '@/components/common/BannerActionButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useBlockerBanner } from '@/composables/useBlockerBanner';

const { t } = useTranslation();

// Same behaviour as `LineageBanner`, different confirm copy — which is precisely
// what `useBlockerBanner` is parameterised on. The two components stay separate;
// see this file's header and the composable's.
const { blocked, dismissed, busy, useTheFamilyFile } = useBlockerBanner({
  kind: 'local-unreadable',
  confirmTitleKey: 'podLocalUnreadable.useFileConfirmTitle',
  confirmMessageKey: 'podLocalUnreadable.useFileConfirmMessage',
});
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ t('podLocalUnreadable.title') }}</template>
    <template #message>{{ t('podLocalUnreadable.inline') }}</template>
    <template #actions>
      <BannerActionButton :busy="busy" @click="useTheFamilyFile">
        {{ busy ? t('podLineage.useFileBusy') : t('podLineage.useFileCta') }}
      </BannerActionButton>
      <BannerActionButton subtle @click="dismissed = true">
        {{ t('action.dismiss') }}
      </BannerActionButton>
    </template>
  </ErrorBanner>
</template>
