<script setup lang="ts">
/**
 * "Sign In Another Device", from the profile menu.
 *
 * ⚠️ THIN BY DESIGN NOW. The whole flow — CTA, mandatory recipient pick, PIN, link and QR —
 * lives in `MagicLinkFlow`, shared verbatim with the Settings card. greg's call, 2026-09-20:
 * those two surfaces are the same thing and must behave identically, so there is exactly one
 * implementation and this file is the modal shell around it.
 *
 * ⚠️ "MAGIC LINK" IS THE USER-FACING NAME FOR EVERY SIGN-IN LINK, WHATEVER ITS LIFETIME. greg's
 * rule, and a product decision rather than a technical one: a person does not need two names for
 * "a link that signs me in", so the expiry is stated next to the link instead of encoded in what
 * it is called. Both surfaces now mint the same FIFTEEN-MINUTE additive `inviteKeys` link.
 *
 * ⚠️ THERE IS NO CHOOSER, AND NO IN-APP SCANNER. The sheet used to open on two cards, "create a
 * code" and "scan a code"; the second WAS the in-app scanner, which took a single photo through
 * the OS picker and decoded the file. greg confirmed on a production iPhone that it still failed
 * where the phone's own camera app succeeded instantly, so it was removed, and a chooser with
 * one option is not a choice. The pull direction did not go with it: the other device shows a
 * code and this one reads it with the NATIVE camera, which deep-links into the approval sheet.
 */
import { watch, useTemplateRef } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import MagicLinkFlow from '@/components/auth/MagicLinkFlow.vue';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const flowRef = useTemplateRef<InstanceType<typeof MagicLinkFlow>>('flowRef');

/**
 * Reset on every open, so a sheet reopened later never shows a stale link, a stale step or a
 * stale recipient.
 *
 * ⚠️ THE FLOW OWNS THE RESET, and it has to: it holds the mint generation. Clearing state from
 * out here once unlocked the re-entrancy guard while leaving the abandoned run live, so that run
 * came back and wrote its verdict over the retry's. The token is also deliberately never
 * persisted, so a previously minted link could not be re-shown anyway — showing one from
 * component state would be showing something the app can no longer vouch for.
 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    flowRef.value?.reset();
  }
);
</script>

<template>
  <BaseModal :open="open" :title="t('signInCode.title')" icon="📲" size="md" @close="emit('close')">
    <MagicLinkFlow ref="flowRef" origin="profile-menu" @leave="emit('close')" />
  </BaseModal>
</template>
