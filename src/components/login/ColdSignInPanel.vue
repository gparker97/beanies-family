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
 * ⚠️ NO CAMERA CODE, ON ANY SURFACE. "Scan" here means the person points their OTHER
 * device's native camera at the code on this screen. There is no `getUserMedia`, no
 * viewfinder and no in-app scanner anywhere in this flow — the repo has none today and
 * gains none. "Make scan the top-line action" reads to an implementer like "build a
 * scanner", which is the largest accidental scope expansion available here.
 */
import DeviceApprovalRequest from '@/components/login/DeviceApprovalRequest.vue';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import { onMounted } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { emitColdUnlockStarted } from '@/services/telemetry/loginFlowEvents';

const emit = defineEmits<{ approved: []; 'paste-submitted': [] }>();

const { t } = useTranslation();

/**
 * THE DENOMINATOR. `magicLink.ts:5-9` records that 6 of 22 families redeemed a kit on a
 * cold device — but with no count of how many families reached a cold surface at all,
 * "27%" cannot be compared before and after this change. `surface` distinguishes the
 * welcome gate from the load-pod screen, which is what separates the cold-phone case from
 * the cold-laptop one.
 */
const props = defineProps<{ surface: string; pasteTarget?: 'join' }>();
onMounted(() => emitColdUnlockStarted({ surface: props.surface }));
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised rounded-3xl border border-gray-200 bg-white p-5 shadow-[var(--card-shadow)]"
  >
    <h3 class="font-outfit dark:text-ink text-center text-base font-semibold text-gray-900">
      {{ t('coldEntry.scanTitle') }}
    </h3>
    <p class="dark:text-ink-soft mt-1 mb-4 text-center text-sm text-gray-600">
      {{ t('coldEntry.scanLead') }}
    </p>

    <DeviceApprovalRequest @approved="emit('approved')" />

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
