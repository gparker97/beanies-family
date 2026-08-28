<script setup lang="ts">
/**
 * "Link a Device" (Phase 4 of the login rethink): mint a short-expiry QR/link from
 * this signed-in device so an EXISTING member signs in on a new device — the link
 * transports the family key (invite-style wrap, 15-minute expiry), the member's
 * doc-synced PIN proves identity on the other side. This is what the classic
 * invite flow structurally cannot do (it serves unclaimed members only).
 *
 * Reuses the invite machinery end-to-end: `generateInviteToken` /
 * `createInvitePackage(…, LINK_EXPIRY_MS)` / `buildInviteLink({ linkMode: true })`,
 * QR via `generateInviteQR`, copy via `useClipboard`. No Drive-share step — the
 * link is scanned or pasted directly, both devices in hand.
 */
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import { generateInviteQR } from '@/utils/qrCode';
import { emitDeviceLinkMinted } from '@/services/telemetry/loginFlowEvents';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const { copy, copied } = useClipboard();

const link = ref('');
const qr = ref('');
const isMinting = ref(false);
const formError = ref<string | null>(null);

async function handleMint() {
  formError.value = null;
  isMinting.value = true;
  try {
    const fk = syncStore.familyKey;
    if (!fk) {
      formError.value = t('recovery.podNotOpen');
      return;
    }
    const {
      buildInviteLink,
      generateInviteToken,
      createInvitePackage,
      hashInviteToken,
      LINK_EXPIRY_MS,
    } = await import('@/services/crypto/inviteService');
    const token = generateInviteToken();
    const pkg = await createInvitePackage(fk, token, LINK_EXPIRY_MS);
    const tokenHash = await hashInviteToken(token);
    // R2-F15: a link whose key never reached the durable file cannot be redeemed
    // within its 15-minute window — refuse to hand out a dead QR.
    const published = await syncStore.addInvitePackage(tokenHash, pkg);
    if (!published) {
      formError.value = t('deviceLink.publishFailed');
      emitDeviceLinkMinted(false);
      return;
    }

    const provider = syncStore.storageProviderType;
    link.value = buildInviteLink({
      familyId: familyContextStore.activeFamilyId ?? '',
      provider: provider === 'google_drive' || provider === 'local' ? provider : undefined,
      fileName: syncStore.fileName ?? undefined,
      fileId: syncStore.driveFileId ?? undefined,
      token,
      linkMode: true,
    });
    try {
      qr.value = await generateInviteQR(link.value);
    } catch {
      qr.value = ''; // QR is an extra — the link itself is the transport
    }
    emitDeviceLinkMinted(true);
  } catch (e) {
    formError.value = t('deviceLink.mintFailed');
    reportError({
      surface: 'login-flow',
      message: 'device link mint failed',
      error: e,
      severity: 'warning',
      context: { action: 'device_link_mint_failed' },
    });
  } finally {
    isMinting.value = false;
  }
}
</script>

<template>
  <BaseCard :title="t('deviceLink.title')">
    <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
      {{ t('deviceLink.description') }}
    </p>

    <BaseButton v-if="!link" variant="secondary" :loading="isMinting" @click="handleMint">
      {{ t('deviceLink.mint') }}
    </BaseButton>

    <div v-else class="space-y-3">
      <img v-if="qr" :src="qr" alt="" class="mx-auto h-44 w-44 rounded-xl bg-white p-2" />
      <div class="flex items-center gap-2">
        <p
          class="flex-1 truncate rounded-xl bg-gray-50 p-2.5 text-xs text-gray-600 select-all dark:bg-slate-700 dark:text-gray-300"
        >
          {{ link }}
        </p>
        <BaseButton variant="secondary" size="sm" type="button" @click="copy(link)">
          {{ copied ? t('login.copied') : t('login.copyLink') }}
        </BaseButton>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('deviceLink.expiryNote') }}
      </p>
    </div>

    <p v-if="formError" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">
      {{ formError }}
    </p>
  </BaseCard>
</template>
