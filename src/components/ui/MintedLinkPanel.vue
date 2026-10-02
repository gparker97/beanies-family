<script setup lang="ts">
/**
 * The "here is your link" presentation, once: QR + the link text + a copy button + any
 * inline error.
 *
 * `InviteLinkCard` renders NO link text and NO copy button — it is the QR frame and the
 * hint — so without this panel every consumer would re-implement the link/copy row
 * regardless of reusing the QR. That row is also where the one failure that must never
 * be silent lives: copying IS the save action for a magic link.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import { useShareText } from '@/composables/useShareText';
import { isNative } from '@/services/sync/capabilities';
import { logEvent } from '@/services/telemetry/logEvent';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import InviteLinkCard from '@/components/ui/InviteLinkCard.vue';

const props = defineProps<{
  link: string;
  qrUrl: string;
  loading?: boolean;
  /** True when the link is good but its QR could not be drawn. */
  qrUnavailable?: boolean;
  /** Telemetry surface for a copy failure — never hard-coded inside the composable. */
  surface: string;
  /**
   * ⚠️ COPY MUST BE SUPPLIED BY THE HOST. These were hard-coded to the magic link, which
   * made the 15-minute device-link card announce its QR as "Your beanies magic link" and
   * caption itself "open it on a new device and sign in with your PIN" — directly above
   * its own note saying the link works for 15 minutes. Two contradictory lifetimes on one
   * card, telling the user to SAVE the link that is meant to be used on the spot. That is
   * the same defect `InviteLinkCard`'s own prop comment was added to prevent.
   */
  qrAlt: string;
  hint: string;
}>();

const { t } = useTranslation();
const { copied, error, copy } = useClipboard({ surface: props.surface });
const { share } = useShareText();

// Capability probe, not UA sniffing. Computed once: neither answer changes mid-session.
const native = isNative();
const canShare = native || typeof navigator.share === 'function';

async function shareLink() {
  // `useShareText` owns the sheet, the cancel case and the clipboard fallback + toasts.
  const shared = await share(t('magicLink.shareTitle'), props.link, props.surface);
  logEvent({
    level: 'info',
    surface: props.surface,
    message: 'magic link share',
    context: { action: shared ? 'shared' : 'dismissed', kind: native ? 'native' : 'web' },
  });
}
</script>

<template>
  <div class="space-y-3">
    <InviteLinkCard
      :qr-url="qrUnavailable ? '' : qrUrl"
      :loading="loading"
      :qr-alt="qrAlt"
      :hint="hint"
      :show-default-footnote="false"
    >
      <template #footnote><span /></template>
    </InviteLinkCard>

    <!-- Degraded, and says so. The link still works; only the picture is missing. -->
    <p
      v-if="qrUnavailable"
      class="dark:text-ink-soft text-center text-xs text-gray-500"
      data-testid="qr-unavailable"
    >
      {{ t('magicLink.qrUnavailable') }}
    </p>

    <div
      class="dark:border-line dark:bg-surface-raised flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3"
    >
      <span class="dark:text-ink min-w-0 flex-1 truncate font-mono text-xs text-gray-700">{{
        link
      }}</span>
      <button
        type="button"
        class="bg-primary-500 hover:bg-primary-600 flex h-10 min-w-10 flex-none items-center justify-center rounded-xl text-white"
        :aria-label="copied ? t('login.copied') : t('login.copyLink')"
        data-testid="copy-link"
        @click="copy(link)"
      >
        <BeanieIcon :name="copied ? 'check' : 'copy'" size="md" aria-hidden="true" />
      </button>
      <span class="sr-only" aria-live="polite">{{ copied ? t('login.copied') : '' }}</span>
      <button
        v-if="canShare"
        type="button"
        class="dark:bg-surface-hover dark:text-ink flex h-10 min-w-10 flex-none items-center justify-center rounded-xl bg-[var(--tint-slate-5)] text-[var(--color-text)]"
        :aria-label="t('login.shareLink')"
        data-testid="share-link"
        @click="shareLink"
      >
        <BeanieIcon name="share" size="md" aria-hidden="true" />
      </button>
    </div>

    <!-- ⚠️ A failed copy USED to be a silent no-op. On the one surface where copying is
         how the credential gets saved, that is the difference between someone having a
         way back into their family and only believing they do. -->
    <p v-if="error" class="dark:text-danger-lift text-xs text-red-600" data-testid="copy-error">
      {{ t('share.copyFailedHelp') }}
    </p>
  </div>
</template>
