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
import MintedLinkPanel from '@/components/settings/MintedLinkPanel.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();

const { link, qr, isMinting, errorKey, qrUnavailable, run } = useMintedLink({
  kind: 'device',
  surface: 'login-flow',
  mint: async () => {
    const fk = syncStore.familyKey;
    if (!fk) return { errorKey: 'recovery.podNotOpen', errorCode: 'no_family_key' };
    const {
      buildInviteLink,
      generateInviteToken,
      createInvitePackage,
      hashInviteToken,
      LINK_EXPIRY_MS,
    } = await import('@/services/crypto/inviteService');

    const token = generateInviteToken();
    const pkg = await createInvitePackage(fk, token, LINK_EXPIRY_MS);
    // R2-F15: a link whose key never reached the durable file cannot be redeemed inside
    // its 15-minute window — refuse to hand out a dead QR.
    const published = await syncStore.addInvitePackage(await hashInviteToken(token), pkg);
    if (!published) return { errorKey: 'deviceLink.publishFailed', errorCode: 'publish-failed' };

    const provider = syncStore.storageProviderType;
    return {
      link: buildInviteLink({
        familyId: familyContextStore.activeFamilyId ?? '',
        provider: provider === 'google_drive' || provider === 'local' ? provider : undefined,
        fileName: syncStore.fileName ?? undefined,
        fileId: syncStore.driveFileId ?? undefined,
        token,
        linkMode: true,
      }),
    };
  },
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
