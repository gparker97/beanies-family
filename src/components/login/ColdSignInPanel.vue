<script setup lang="ts">
/**
 * "Get in from a device you're already signed in on" — the top-line way back in, on every
 * cold surface.
 *
 * One component rather than markup repeated per surface, because there are three of them
 * (the welcome gate, the load-pod screen, and the prove screen's cold state) and they must
 * not drift into three slightly different explanations of the same thing.
 *
 * The measurement this exists to move: 6 of 22 families redeemed a recovery kit, every one
 * on a cold device, and 5 of those 6 then replaced a PIN that was working. They did not
 * need recovery. They needed a way in, and nothing on these screens offered one.
 *
 * ⚠️ THERE IS NO IN-APP SCAN HERE ANY MORE, AND THAT WAS A DELIBERATE REMOVAL.
 *
 * It took ONE photo through the OS picker and decoded the file, which is a strictly worse
 * signal than a live scanner: one compressed frame, at whatever moment the shutter fired.
 * greg tested it on a production iPhone and it still failed while the phone's own camera app
 * read the same code instantly. So the button is gone and step 3 tells the person to use the
 * camera they already have.
 *
 * ⚠️ "JUST OPEN THE NATIVE CAMERA APP" IS NOT AVAILABLE, and the reason is worth keeping so
 * nobody re-proposes it. iOS has no public URL scheme for the Camera app; everything that
 * "opens the camera" presents its OWN in-app camera, which is the mechanism just deleted.
 * Android does have `android.media.action.STILL_IMAGE_CAMERA`, so a button there is possible
 * — but one that silently does nothing on every iPhone is worse than no button at all.
 *
 * ⚠️ STILL NO `getUserMedia`, NO VIEWFINDER, NO CAMERA PERMISSION. A real live scanner
 * (ML Kit on native) remains the only way to beat the native camera app, and it is a separate
 * piece of work with a permission prompt, a denied state and a preview surface behind it.
 *
 * ⚠️ CONSEQUENCE, RECORDED ON PURPOSE: `in-app-scan` was the ONLY transport that proved the
 * person chose to scan something, which is what let `DeviceApprovalSheet` skip its provenance
 * warning. Every approval now arrives as a deep link, so that warning shows every time.
 *
 * ⚠️ THE PANEL LEADS WITH WHICHEVER DIRECTION PUTS THE SCANNING JOB ON A DEVICE THAT HAS A
 * CAMERA. On a phone that is PUSH: this device photographs a code shown by a signed-in one.
 * On a laptop it is PULL: this device displays a code for a signed-in phone to read. The
 * panel used to lead with pull everywhere, which is why greg — on an iPhone, looking at a
 * QR his phone could not scan itself — asked what it was for. Both directions stay
 * reachable on both form factors; only the order changes.
 */
import DeviceApprovalRequest from '@/components/login/DeviceApprovalRequest.vue';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import ColdEntrySteps from '@/components/login/ColdEntrySteps.vue';
import { onMounted, ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { emitColdUnlockStarted } from '@/services/telemetry/loginFlowEvents';

const emit = defineEmits<{ 'paste-submitted': [] }>();

const { t } = useTranslation();

/**
 * THE DENOMINATOR. `magicLink.ts:5-9` records that 6 of 22 families redeemed a kit on a
 * cold device — but with no count of how many families reached a cold surface at all,
 * "27%" cannot be compared before and after this change. `surface` distinguishes the
 * welcome gate from the load-pod screen, which is what separates the cold-phone case from
 * the cold-laptop one.
 */
const props = defineProps<{
  surface: string;
  pasteTarget?: 'join';
  /**
   * ⚠️ A CALLBACK PROP, NOT AN EMIT, AND THAT IS LOAD-BEARING. The approval that calls this
   * also causes this component to unmount — `openPodWithFamilyKey` clears the staged file and
   * the parent's `v-if` tears the panel down mid-await. `emit()` checks `isUnmounted` and
   * silently drops; a closure does not. See the call site in `LoadPodView`.
   */
  onApproved?: () => void;
}>();
onMounted(() => emitColdUnlockStarted({ surface: props.surface }));

const isTouchPrimary = useIsTouchPrimary();

/**
 * Pull is mounted on DEMAND, not eagerly.
 *
 * `DeviceApprovalRequest` generates an ECDH keypair and starts a THREE-SECOND poll that
 * re-reads the whole family file, both in `onMounted`. Eagerly mounting it on a phone — where
 * pull is now the secondary route — burns a throwaway keypair and inflates the
 * `device_approval_requested` denominator on every view of this screen, on top of the
 * bandwidth.
 */
const showCode = ref(!isTouchPrimary.value);

/**
 * ⚠️ THE PARENT OWNS THE REMOUNT KEY. `DeviceApprovalRequest.retry()` used to be
 * `window.location.reload()`, which behind a disclosure would drop the user back here with
 * the section shut — "show a new one" doing visibly the opposite of what it says. A
 * component cannot key itself, so it emits and this counter remounts it.
 */
const codeGeneration = ref(0);

/** Ordered so the numerals are derived, never hand-written text nodes. */
const pushSteps = computed(() => [
  t('coldEntry.pushStep1'),
  t('coldEntry.pushStep2'),
  t('coldEntry.pushStep3'),
]);
</script>

<template>
  <!--
    ⚠️ NO CARD. This used to be a white `rounded-3xl` card with its own padding, mounted
    INSIDE `LoadPodView`'s white card — a white box on a white box, which at 390px cost 104px
    of horizontal padding between the two and read as a rendering bug rather than as
    structure. A card separates a surface from what surrounds it; there was nothing to
    separate from. The dividers below carry the grouping instead.
  -->
  <div>
    <h3 class="font-outfit dark:text-ink mb-3 text-base font-semibold text-balance text-gray-900">
      {{ isTouchPrimary && !showCode ? t('coldEntry.pushTitle') : t('coldEntry.scanTitle') }}
    </h3>
    <!-- No lead line under this heading, on either route. The pull heading now says what to
         do ("scan this code with a device where you're already signed in"), so the line that
         used to repeat it underneath was redundant (greg, 2026-09-23). -->

    <!-- PUSH, led on a device that has a camera. The steps end by telling the person to use
         that camera, because the in-app scanner is gone and the phone's own camera app is now
         the only scan route — see this file's header for why, and for what it cost. -->
    <div v-if="isTouchPrimary && !showCode" class="space-y-3">
      <!-- ⚠️ SHARED WITH `ScanFirstBlock` VIA `ColdEntrySteps`. This markup used to be inline
           here AND duplicated there, which meant two live copies of what this file's own header
           calls the only instructions a locked-out person has. A wording, numbering or dark-mode
           edit would land in one and drift the other across the `decrypt` and `cards` surfaces
           that same person compares. -->
      <ColdEntrySteps :steps="pushSteps" />

      <button
        type="button"
        class="dark:text-ink-soft w-full text-center text-sm text-gray-600 underline"
        @click="showCode = true"
      >
        {{ t('coldEntry.showMyCode') }}
      </button>
    </div>

    <!-- PULL. Mounted only when it is the led direction or the user asked for it, because
         mounting it starts a 3s whole-file poll and mints a keypair. -->
    <div v-else class="space-y-3">
      <DeviceApprovalRequest
        :key="codeGeneration"
        :on-approved="props.onApproved"
        @retry="codeGeneration += 1"
      />
      <button
        v-if="isTouchPrimary"
        type="button"
        class="dark:text-ink-soft w-full text-center text-sm text-gray-600 underline"
        @click="showCode = false"
      >
        {{ t('coldEntry.scanInstead') }}
      </button>
    </div>

    <div class="my-4 flex items-center gap-3">
      <span class="dark:border-line h-px flex-1 border-t border-gray-200" />
      <span class="dark:text-ink-faint text-xs text-gray-500">{{ t('coldEntry.or') }}</span>
      <span class="dark:border-line h-px flex-1 border-t border-gray-200" />
    </div>

    <!--
      The paste fallback stays, and stays visible: someone who was SENT a link is holding a
      credential, and the screen they land on must let them use it.
    -->
    <PasteLinkPanel @submitted="emit('paste-submitted')" />
  </div>
</template>
