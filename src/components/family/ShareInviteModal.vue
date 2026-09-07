<script setup lang="ts">
import { computed } from 'vue';
import ShareSheetModal from '@/components/ui/ShareSheetModal.vue';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import { useTranslation } from '@/composables/useTranslation';
import { buildInviteShareBody, buildInviteEmailSubject } from '@/utils/inviteShareText';

const props = defineProps<{
  open: boolean;
  link: string;
  familyName: string;
  memberName: string;
  /**
   * Optional title override — used when this modal is reused outside
   * the per-bean share context (e.g. the join-flow "Continue on
   * another device" recovery). Falls back to `share.title`.
   */
  title?: string;
  /** Optional subtitle override. Falls back to `share.subtitle`. */
  subtitle?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();

// The invite message is built HERE now, not inside the grid — the grid takes a finished
// message so an invite and a recipe can share one channel implementation. See #92.
const body = computed(() =>
  buildInviteShareBody({
    link: props.link,
    familyName: props.familyName,
    memberName: props.memberName,
    t,
  })
);
const emailSubject = computed(() => buildInviteEmailSubject({ familyName: props.familyName, t }));
</script>

<template>
  <ShareSheetModal
    :open="open"
    :title="props.title ?? t('share.title')"
    :subtitle="props.subtitle ?? t('share.subtitle')"
    @close="emit('close')"
  >
    <ShareChannelGrid
      :link="link"
      :body="body"
      :email-subject="emailSubject"
      surface="invite-share"
    >
      <template #footer>
        <p class="dark:text-ink-faint text-center text-xs text-gray-400">
          🔒 {{ t('family.linkExpiry') }}
        </p>
      </template>
    </ShareChannelGrid>
  </ShareSheetModal>
</template>
