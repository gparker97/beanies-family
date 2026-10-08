<script setup lang="ts">
/**
 * "Use beanies on your phone too": the create wizard's one-line, one-tap phone hand-off
 * (#128), slotted under the kit modal's "Open my pod" button on desktop browsers.
 *
 * ⚠️ NOT `MagicLinkFlow`, ON PURPOSE. That flow is CTA → mandatory recipient pick → code,
 * three taps, because picking the wrong member destroys a link they hold. Here the roster
 * is the owner alone (members are added after the kit step), so the recipient is never in
 * doubt and the lower-level pieces compose to one tap: `useMintedLink` (the mint sequence
 * and the `link_minted` funnel, so no telemetry of its own here) + `mintDeviceLink` with
 * `gate: 'not-applicable'` (a PIN pad cannot stack over the unclosable kit modal) +
 * `MintedLinkPanel`.
 *
 * The host decides WHETHER to render this (desktop only); this component only decides what
 * the line does once it is there.
 */
import { onBeforeUnmount, ref } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  /** The owner's member id: the link's `login_hint` target (the link itself is family-scoped). */
  ownerMemberId: string;
}>();

const { t } = useTranslation();

const { link, qr, isMinting, errorKey, qrUnavailable, run, cancel } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  facts: () => ({ origin: 'creation', target: 'self' }),
  mint: () => mintDeviceLink({ hintMemberId: props.ownerMemberId, gate: 'not-applicable' }),
});

/** Whether the panel under the line is open. Closing keeps the minted link for a re-open. */
const expanded = ref(false);

function handleClick(): void {
  if (expanded.value && !errorKey.value) {
    expanded.value = false;
    return;
  }
  expanded.value = true;
  // Mint on the first open, and again only to retry a failure. A link already minted is
  // still good (15 minutes), so re-opening never burns a second wrap.
  if (!link.value && !isMinting.value) void run();
}

// The kit modal closes on "Open my pod" and takes this with it; settle any mint still in
// flight so the `link_mint_started` it booked gets its partner.
onBeforeUnmount(cancel);
</script>

<template>
  <div class="text-center" data-testid="phone-handoff">
    <button
      type="button"
      class="font-outfit text-secondary-500 hover:text-secondary-600 dark:text-ink-soft dark:hover:text-ink inline-flex cursor-pointer items-center justify-center gap-2 px-1 py-1 text-sm transition-colors"
      :aria-expanded="expanded"
      data-testid="phone-handoff-toggle"
      @click="handleClick"
    >
      <svg
        class="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <span class="underline decoration-1 underline-offset-4">{{ t('setup.usePhoneToo') }}</span>
    </button>

    <div v-if="expanded" class="mt-3 text-left">
      <div v-if="isMinting" class="flex justify-center py-4" data-testid="phone-handoff-minting">
        <BeanieSpinner size="sm" />
      </div>
      <p
        v-else-if="errorKey"
        role="alert"
        class="dark:text-accent-lift text-primary-700 text-center text-sm"
        data-testid="phone-handoff-error"
      >
        {{ t(errorKey as UIStringKey) }}
      </p>
      <template v-else-if="link">
        <MintedLinkPanel
          :link="link"
          :qr-url="qr"
          :qr-unavailable="qrUnavailable"
          :loading="isMinting"
          :qr-alt="t('signInCode.qrAlt')"
          :hint="t('deviceLink.mintedHint')"
          surface="login-flow"
        />
        <p class="dark:text-ink-faint mt-2 text-center text-xs text-gray-500">
          {{ t('deviceLink.expiryNote') }}
        </p>
      </template>
    </div>
  </div>
</template>
