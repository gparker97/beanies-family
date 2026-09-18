<script setup lang="ts">
/**
 * DEV-ONLY browser harness for the magic-link + recovery-kit copy pass.
 *
 * Both surfaces this renders sit behind real Google OAuth and a real Drive file — the
 * kit-plus-link modal only appears during pod CREATION, and the `link-saved` pane only
 * after a genuine join — so neither can be reached from an automated browser run. Unit
 * tests confirm the strings resolve; they cannot answer whether the reordered modal reads
 * in the right order, whether the emphasised line actually stands out, or whether the copy
 * button survives phone width. That is what this is for.
 *
 * Same pattern and same DEV gate as `/dev/calendar-import`. Stripped from production
 * builds, reachable from no nav.
 */
import { ref } from 'vue';

import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';
import PasteLinkPanel from '@/components/login/PasteLinkPanel.vue';
import { useTranslation } from '@/composables/useTranslation';
import { generateInviteQR } from '@/utils/qrCode';

const { t } = useTranslation();

// Shaped like the real thing — LENGTH is what breaks the layout, not the bytes. Composed
// rather than written out: a literal high-entropy token trips the no-secrets lint, and
// rightly so, since that rule is the thing standing between a real token and a commit.
const LINK = `https://app.beanies.family/login?t=mL_${'0123456789abcdef'.repeat(4)}`;

const kitOpen = ref(true);
const qr = ref('');
generateInviteQR(LINK)
  .then((d) => (qr.value = d))
  .catch(() => (qr.value = ''));
</script>

<template>
  <div class="dark:bg-surface-ground min-h-screen space-y-8 bg-[#F8F9FA] p-6">
    <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- dev-only harness label -->
    <h1 class="font-outfit dark:text-ink text-xl font-bold text-gray-900">
      magic link / kit copy harness
    </h1>

    <RecoveryKitDisplay
      :open="kitOpen"
      kit-id="KIT-4F2A-91C6"
      code="7QH4-2MKD-8PLR-3XVN"
      :magic-link="LINK"
      @stored="kitOpen = false"
    />

    <!-- The paste affordance, both states side by side, on the card ground it actually sits
         on. Collapsed it must read as a control; open it must read as something you type in. -->
    <section class="dark:bg-surface-raised mx-auto max-w-md space-y-6 rounded-2xl bg-white p-4">
      <PasteLinkPanel />
      <div class="dark:border-line border-t border-gray-200 pt-4">
        <PasteLinkPanel />
      </div>
    </section>

    <!-- The join surface's `link-saved` pane, rendered standalone: the same panel with the
         same hint, so the copy can be read at both widths without a real join. -->
    <section class="dark:bg-surface-raised mx-auto max-w-md space-y-4 rounded-2xl bg-white p-4">
      <h2 class="font-outfit dark:text-ink text-xl font-bold text-gray-900">
        {{ t('magicLink.title') }}
      </h2>
      <MintedLinkPanel
        :link="LINK"
        :qr-url="qr"
        :qr-unavailable="qr === ''"
        :loading="false"
        :qr-alt="t('magicLink.title')"
        :hint="t('magicLink.saveAndUse')"
        surface="login-flow"
      />
      <p class="dark:text-ink-faint text-xs text-gray-500">{{ t('magicLink.needNewOne') }}</p>
    </section>
  </div>
</template>
