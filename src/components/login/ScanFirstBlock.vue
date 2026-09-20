<script setup lang="ts">
/**
 * "Scan a magic link" — promoted to the top of the cold surfaces that have NOTHING STAGED.
 *
 * Mounted on `LoadPodView`'s `cards` and `reconnect` states, which are what the Sign In button
 * and a "sign out and clear data" return respectively land on. The welcome gate home screen is
 * deliberately untouched: greg's rule is that only once someone has explicitly chosen the login
 * path (not create-a-pod) does scanning become first-class.
 *
 * ⚠️ IT OWNS THE PASTE PANEL, AND `LoadPodView`'S HOISTED ONE TURNS OFF WHEN THIS RENDERS.
 *
 * That pairing is the whole reason this is safe. `LoadPodView` already renders a `PasteLinkPanel`
 * as the FIRST thing in the branch covering these states, above the storage cards, deliberately
 * — a person holding a link must not land on provider cards with no way to use it. So mounting
 * anything below it would have shipped paste-first and defeated the promotion entirely, and
 * mounting a second panel inside this block would have rendered two, one above the other, with
 * two "or" dividers. The two are a mutually exclusive `v-if` pair instead, so exactly one paste
 * panel exists on every state by construction rather than by careful ordering.
 *
 * ⚠️ NO `DeviceApprovalRequest` HERE, because pull mode cannot work with nothing staged. That
 * component mints an ECDH keypair and starts a 3-second poll of the whole family file, hunting
 * for an approval wrap in an envelope that has not been fetched and that nobody will write. It
 * would spin forever, burn a throwaway keypair, and inflate the `device_approval_requested`
 * denominator on every view. `LoadPodView`'s own `canUseDeviceApproval` gate requires a staged
 * file for exactly this reason, and `WelcomeGate` records the same exclusion.
 *
 * ⚠️ WHY THIS IS A SEPARATE COMPONENT AND NOT A `variant` PROP ON `ColdSignInPanel`. A variant
 * would have had to disable three of that panel's four features, and it would have turned "the
 * `decrypt` state is unchanged" into a test obligation against a 2,297-line host. Splitting
 * keeps `ColdSignInPanel` prop-free and leaves `decrypt` untouched by construction.
 *
 * FORM FACTOR, per the approved mockup: a phone leads with the three steps and keeps paste as a
 * disclosure beneath; a laptop leads with paste and shows no steps at all, because pointing a
 * computer at a phone screen is absurd and it has no camera to scan with. Both render, so the
 * `cold_unlock_started` denominator counts both — there is no surface here that offers nothing.
 */
import { computed, watch, onScopeDispose } from 'vue';
import ColdEntrySteps from '@/components/login/ColdEntrySteps.vue';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import { useTranslation } from '@/composables/useTranslation';
import { emitColdUnlockStarted } from '@/services/telemetry/loginFlowEvents';

const props = defineProps<{
  /**
   * Which cold surface this is, for the `cold_unlock_started` denominator. Derived by the host
   * from its `viewState` so there is ONE mount rather than one per state — three mount points
   * would need three values or the existing series becomes uninterpretable.
   */
  surface: string;
}>();

const { t } = useTranslation();
const isTouchPrimary = useIsTouchPrimary();

/**
 * ⚠️ NOT `onMounted`, AND NOT PER-MOUNT. Three separate ways the mount anchor lied:
 *
 * 1. TRANSIENT. `viewState` is `'cards'` on frame one for EVERY entry — `showDecryptModal` and
 *    `isLoadingFile` both start false, and the host's `autoLoadFile()` runs in ITS `onMounted`,
 *    which Vue runs AFTER this child's. So the cached-key-decrypt-failed path, the `/open`
 *    gesture and the kit-QR deep link all booked a cold-surface arrival on their way to a
 *    spinner the user never had to act on.
 * 2. LATCHED. `showScanFirst` is true for both `cards` and `reconnect` and the element is
 *    unkeyed, so `reconnectDismissed` flipping `reconnect`→`cards` patched the prop without
 *    remounting and never re-emitted — every dismissed-reconnect session was filed as
 *    `load-pod-reconnect`.
 * 3. DOUBLE-COUNTED. `cards` → `auto-loading` (a Drive listing) → `cards` unmounts and
 *    remounts, so one attempt emitted twice.
 *
 * Anchoring on the SURFACE VALUE instead, after a settle delay, fixes all three: a surface the
 * user passes straight through never books, a surface change re-books under the right kind, and
 * a remount at the same surface is idempotent because the guard is module-free per instance but
 * keyed on the value rather than the lifecycle.
 *
 * ⚠️ STILL ONLY HALF A FUNNEL. `emitColdUnlockAbandoned` has ZERO callers anywhere in `src/`,
 * so the abandonment RATE — the number this whole area exists to move — remains unmeasurable.
 * Recorded in `docs/STATUS.md`; wiring it needs a definition of "left without getting in".
 */
const SETTLE_MS = 600;
let emittedFor: string | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.surface,
  (surface) => {
    if (settleTimer) clearTimeout(settleTimer);
    if (emittedFor === surface) return;
    settleTimer = setTimeout(() => {
      // Re-read through the prop: if the host moved on during the settle window, this surface
      // was never really shown.
      if (props.surface !== surface) return;
      emittedFor = surface;
      emitColdUnlockStarted({ surface });
    }, SETTLE_MS);
  },
  { immediate: true }
);

onScopeDispose(() => {
  if (settleTimer) clearTimeout(settleTimer);
});

/** Step 3 is the only one that differs: scan here, or send it to yourself over there. */
const steps = computed(() => [
  t('coldEntry.pushStep1'),
  t('coldEntry.pushStep2'),
  isTouchPrimary.value ? t('coldEntry.pushStep3') : t('coldEntry.pushStep3Desktop'),
]);
</script>

<template>
  <section
    class="scan-first dark:border-primary-500/40 border-primary-500/30 mb-6 rounded-3xl border-[1.5px] p-4"
    data-testid="scan-first-block"
  >
    <span
      class="font-outfit bg-primary-500 mb-2.5 inline-block rounded-full px-2.5 py-1 text-[0.625rem] font-bold tracking-wider text-white uppercase"
    >
      {{ t('coldEntry.fastestFlag') }}
    </span>
    <h3 class="font-outfit dark:text-ink mb-1 text-base font-bold text-gray-900">
      {{ t('coldEntry.scanFirstTitle') }}
    </h3>
    <p class="dark:text-ink-soft mb-3.5 text-sm text-gray-600">
      {{ t('coldEntry.scanFirstWhy') }}
    </p>

    <!-- Phone: the steps lead, paste sits under them as the fallback for someone who was SENT
         a link rather than shown one. -->
    <template v-if="isTouchPrimary">
      <ColdEntrySteps :steps="steps" />
      <div class="mt-4">
        <PasteLinkPanel />
      </div>
    </template>

    <!-- Laptop: paste leads. No camera, so no camera instructions; the steps would only tell
         someone to point a device they do not have. -->
    <template v-else>
      <PasteLinkPanel />
    </template>
  </section>
</template>

<style scoped>
/*
 * A Heritage Orange tint, never Alert Red: this is a routine "here is the quick way" signal,
 * and red is reserved for destructive confirmations and hard validation errors.
 *
 * ⚠️ The dark partner is a PLAIN `html.dark` rule, not `:global(.dark)`. Vue drops everything
 * after a `:global()` and emits the declarations onto `<html>` itself, painting the whole page.
 * A scoped rule also carries a `[data-v]` specificity boost that beats any `dark:bg-*` utility
 * on the same element, so a painted background here MUST ship its own dark partner or the slab
 * stays a pale orange in dark mode while the text above it switches to light ink.
 */
.scan-first {
  background: linear-gradient(135deg, rgb(241 93 34 / 9%) 0%, rgb(230 126 34 / 5%) 100%), #fff;
}

html.dark .scan-first {
  background:
    linear-gradient(135deg, rgb(241 93 34 / 14%) 0%, rgb(230 126 34 / 8%) 100%),
    var(--color-surface-raised);
}
</style>
