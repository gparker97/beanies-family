<script setup lang="ts">
/**
 * "Link a Device" (Phase 4 of the login rethink): mint a short-expiry QR/link from this
 * signed-in device so an EXISTING member signs in on a new device — the link transports
 * the family key (invite-style wrap, 15-minute expiry), the member's doc-synced PIN
 * proves identity on the other side. This is what the classic invite flow structurally
 * cannot do (it serves unclaimed members only).
 *
 * ⚠️ THIN ON PURPOSE. The mint SEQUENCE lives in `useMintedLink` and the QR/link/copy
 * presentation in `MintedLinkPanel`, both shared with `MagicLinkCard`. The two cards
 * were ~90% identical, and the duplicated half was the dangerous half: the guard order,
 * the withhold-on-publish-failure rule, and the copy-failure reporting. This file should
 * contain no `try`/`catch` and no telemetry call — if it grows either back, the
 * extraction has been undone.
 *
 * Still the right tool for "both devices in hand, right now". The 7-day magic link is
 * the one you SAVE; this is the one you use on the spot.
 */
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { mintDeviceLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();

const { link, qr, isMinting, errorKey, qrUnavailable, run } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  // Which entry point this mint came from. Settings has never carried one; now every
  // `link_minted` event in the product has a queryable origin.
  detail: 'origin=settings',
  mint: mintDeviceLink,
});
</script>

<template>
  <BaseCard :title="t('deviceLink.title')">
    <p class="dark:text-ink-soft mb-3 text-sm text-gray-600">
      {{ t('deviceLink.description') }}
    </p>

    <BaseButton v-if="!link" variant="secondary" :loading="isMinting" @click="run">
      {{ t('deviceLink.mint') }}
    </BaseButton>

    <div v-else class="space-y-3">
      <MintedLinkPanel
        :link="link"
        :qr-url="qr"
        :qr-unavailable="qrUnavailable"
        :qr-alt="t('deviceLink.title')"
        :hint="t('deviceLink.description')"
        surface="login-flow"
      />
      <p class="dark:text-ink-soft text-xs text-gray-500">
        {{ t('deviceLink.expiryNote') }}
      </p>
    </div>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as UIStringKey) }}
    </p>
  </BaseCard>
</template>
