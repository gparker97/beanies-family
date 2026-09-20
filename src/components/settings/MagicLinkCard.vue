<script setup lang="ts">
/**
 * "Magic Links" in Settings → Security & Recovery: create a link that signs a family member in
 * on another device.
 *
 * ⚠️ THIS CARD REPLACED TWO. There used to be "Your beanies magic link" (7 days, per-member,
 * `memberLinkKeys`) and "Link a Device" (15 minutes, family-scoped, `inviteKeys`) sitting next
 * to each other, and a separate profile-menu sheet doing the same job a third way. greg's call,
 * 2026-09-20: there is no such distinction. A magic link is a magic link, the only difference is
 * when it expires, and all surfaces mint the SAME fifteen-minute link. Two cards became one, and
 * the flow inside it is `MagicLinkFlow`, shared verbatim with the profile-menu sheet.
 *
 * ⚠️ WHAT WENT AWAY WITH THE 7-DAY LINK, DELIBERATELY. That link was per-member and newest-wins,
 * so this card had to show a status dot, an expiry date and a "this cancels the old one" warning
 * naming whose link was about to be destroyed — and getting that chain wrong silently revoked a
 * family member's working credential. The fifteen-minute link is ADDITIVE: its wrap lands in
 * `inviteKeys` under a token hash and cancels nothing, so none of that machinery is needed and
 * a whole class of silent-destruction bugs is gone with it.
 *
 * ⚠️ `mintMagicLink` AND `memberLinkKeys` STILL EXIST, and are still used by pod creation
 * (`ResumePodSetup`) and the join flow (`useJoinFlow`), which hand a new owner or joiner the
 * link they save during setup. Those are a different job from "make me a link now", and they
 * were deliberately left alone. Consequence worth knowing: a 7-day link issued at creation has
 * no UI that can see or revoke it any more, because this card was the only thing that read that
 * dict. Recorded in `docs/STATUS.md`.
 *
 * ⚠️ PLACEMENT IS A DELIBERATE OVERRIDE. `SettingsPage`'s own comment says Security & Recovery
 * is "family/device-level protection" while "personal sign-in methods live in Account & Sign-In
 * above". By that rule this might belong above. It is here anyway, because a person looking for
 * "how do I get back in" looks here. Recorded so the next reader does not "correct" it.
 */
import BaseCard from '@/components/ui/BaseCard.vue';
import MagicLinkFlow from '@/components/auth/MagicLinkFlow.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <BaseCard :title="t('magicLink.title')">
    <!-- ⚠️ NO LEAD PARAGRAPH HERE. `MagicLinkFlow` prints its own first-step lead, so a
         description here meant the card opened with two paragraphs saying the same thing. The
         flow owns that line, which also keeps it identical to the profile-menu sheet. -->
    <MagicLinkFlow origin="settings" />
  </BaseCard>
</template>
