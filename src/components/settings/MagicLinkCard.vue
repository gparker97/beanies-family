<script setup lang="ts">
/**
 * "Your beanies magic link" — the member's own saved sign-in link, and the only place it
 * can be (re)created.
 *
 * ⚠️ IT CANNOT SHOW YOU THE CURRENT LINK. The token is never persisted — same contract
 * as the recovery kit — so there is nothing to re-display. The only action is CREATE A
 * NEW ONE, and doing that cancels the old one. That is not a limitation to apologise
 * for; it is the reason a leaked link can be killed at all.
 *
 * ⚠️ PLACEMENT IS A DELIBERATE OVERRIDE. `SettingsPage`'s own comment says Security &
 * Recovery is "family/device-level protection" while "personal sign-in methods live in
 * Account & Sign-In above". By that rule a per-member sign-in link belongs above. It is
 * here anyway, beside `DeviceLinkCard` (which is here for the same reason), because a
 * person looking for "how do I get back in" looks here. Recorded so the next reader does
 * not "correct" it.
 *
 * Thin by design: the mint sequence is `useMintedLink`, the presentation is
 * `MintedLinkPanel`, both shared with `DeviceLinkCard`.
 */
import { computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMintedLink } from '@/composables/useMintedLink';
import { fillTemplate } from '@/utils/fillTemplate';
import { mintMagicLink } from '@/services/auth/linkMint';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();

const memberId = computed(() => authStore.currentUser?.memberId ?? null);
const existing = computed(() =>
  memberId.value ? syncStore.envelope?.memberLinkKeys?.[memberId.value] : undefined
);

/**
 * Four states, not three. A 7-day link needs an EXPIRED state of its own — showing a
 * green "active" dot next to a link that stopped working on Tuesday is a lie the user
 * only discovers when they are locked out on a new phone.
 */
const status = computed<'none' | 'active' | 'expired'>(() => {
  const pkg = existing.value;
  if (!pkg || !pkg.tokenHash) return 'none'; // no entry, or a revoked tombstone
  return Date.parse(pkg.expiresAt) > Date.now() ? 'active' : 'expired';
});

const statusText = computed(() => {
  const pkg = existing.value;
  if (!pkg || status.value === 'none') return t('magicLink.statusNone');
  const date = new Date(pkg.expiresAt).toLocaleDateString();
  return status.value === 'active'
    ? fillTemplate(t('magicLink.statusActive'), { date })
    : fillTemplate(t('magicLink.statusExpired'), { date });
});

const { link, qr, isMinting, errorKey, qrUnavailable, run } = useMintedLink({
  kind: 'magic',
  surface: 'login-flow',
  detail: 'origin=settings',
  // The crypto, the monotonic stamp, the durable publish and the URL all live in
  // `linkMint` now — shared with the creation and join mints, which had the same body and
  // had each independently grown (and had fixed) the same two bugs.
  // `?? ''` rather than widening the service's signature: `mintMagicLink` already
  // treats an empty id as 'the pod is not open' and returns that error key, so the one
  // refusal lives in one place instead of being re-decided per caller.
  mint: () => mintMagicLink({ memberId: memberId.value ?? '' }),
});
</script>

<template>
  <BaseCard :title="t('magicLink.title')">
    <p class="dark:text-ink-soft mb-2 text-sm text-gray-600">
      {{ t('magicLink.settingsDesc') }}
    </p>

    <template v-if="!link">
      <p class="dark:text-ink-faint mb-3 flex items-center gap-2 text-xs text-gray-500">
        <span
          class="h-2 w-2 rounded-full"
          :class="status === 'active' ? 'bg-green-500' : 'dark:bg-line-strong bg-gray-300'"
          aria-hidden="true"
        />
        {{ statusText }}
      </p>

      <BaseButton variant="secondary" :loading="isMinting" @click="run">
        {{ t('magicLink.create') }}
      </BaseButton>

      <!-- The warning is attached to the ACTION, not floating at the top of the card,
           because that is where the decision is made. -->
      <p v-if="status === 'active'" class="dark:text-ink-soft mt-2 text-xs text-gray-500">
        {{ t('magicLink.createWarning') }}
      </p>
    </template>

    <div v-else class="space-y-3">
      <MintedLinkPanel
        :link="link"
        :qr-url="qr"
        :qr-unavailable="qrUnavailable"
        :qr-alt="t('magicLink.title')"
        :hint="t('magicLink.saveAndUse')"
        surface="login-flow"
      />
      <p class="dark:text-ink-faint text-xs font-semibold text-gray-500">
        {{ t('magicLink.onlyTimeShown') }}
      </p>
    </div>

    <p v-if="errorKey" role="alert" class="dark:text-danger-lift mt-3 text-sm text-red-600">
      {{ t(errorKey as UIStringKey) }}
    </p>
  </BaseCard>
</template>
