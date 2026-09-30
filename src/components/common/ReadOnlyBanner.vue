<script setup lang="ts">
/**
 * The read-only band (#95 Phase 3): the trial ended, the plan lapsed, or this device has not been
 * able to confirm the plan for too long. A BAND ABOVE THE PAGE, NOT A WALL: every card, number
 * and list underneath stays readable, and writes are refused one at a time by the gate in
 * `docClient.mutate` with a small toast.
 *
 * A thin wrapper over the shared `ErrorBanner` chrome, exactly like `LineageBanner`, used AS IS:
 * `notice` paints Heritage Orange with white ink in both modes (never Alert Red: nothing is lost
 * and nothing is being deleted), so this component adds no paint of its own.
 *
 * NATIVE (iOS / Android) CARRIES EXPORT ONLY. No link, URL, price or purchase verb (Apple
 * 3.1.3(f), Google Play payments policy); the body is greg's final wording, both paragraphs,
 * verbatim, from `useReadOnlyCopy` (shared with `PlanCard`, so the two never disagree).
 *
 * WEB adds "See plans", only when the Plan route exists (it arrives in Phase 5; until then no
 * button that goes nowhere) and never while STALE: that family may well be paying and only
 * offline, so offering checkout would invite a second subscription. The same rule as `PlanCard`.
 *
 * Not dismissible: the state it describes is the state every write is refused in, so hiding it
 * would leave the refusals unexplained.
 */
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import BannerActionButton from '@/components/common/BannerActionButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useReadOnlyCopy } from '@/composables/useReadOnlyCopy';
import { usePodExport } from '@/composables/usePodExport';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { useAuthStore } from '@/stores/authStore';

const { t } = useTranslation();
const entitlementStore = useEntitlementStore();
const authStore = useAuthStore();
// The copy and the "See plans" rule are shared with PlanCard, so the two never disagree.
const { paragraphs, showSeePlans, seePlans } = useReadOnlyCopy();
const { isExporting, exportEncryptedPod } = usePodExport();

function exportData(): void {
  // `exportEncryptedPod` toasts its own failures and returns false for a cancelled share, which
  // is the person's choice and needs nothing more here.
  void exportEncryptedPod();
}
</script>

<template>
  <!-- Never on the lock screen (the same guard as PodAccessBanner / SaveFailureBanner): the band
       and its Export are for a signed-in person. -->
  <ErrorBanner
    :show="entitlementStore.isReadOnly && !authStore.needsAuth"
    severity="notice"
    data-testid="read-only-banner"
  >
    <template #title>{{ t('readOnly.band.title') }}</template>
    <template #message>
      <!-- `ErrorBanner` wraps this slot in a <p>, so the paragraphs are block spans. -->
      <span
        v-for="(line, i) in paragraphs"
        :key="line"
        class="block"
        :class="{ 'mt-1': i > 0 }"
        data-testid="read-only-banner-line"
      >
        {{ line }}
      </span>
    </template>
    <template #actions>
      <BannerActionButton v-if="showSeePlans" data-testid="read-only-see-plans" @click="seePlans">
        {{ t('plan.action.seePlans') }}
      </BannerActionButton>
      <BannerActionButton
        :subtle="showSeePlans"
        :busy="isExporting"
        data-testid="read-only-export"
        @click="exportData"
      >
        {{ t('readOnly.band.export') }}
      </BannerActionButton>
    </template>
  </ErrorBanner>
</template>
