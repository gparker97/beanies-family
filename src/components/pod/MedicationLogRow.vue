<script setup lang="ts">
/**
 * Single medication-administration log entry — presentation-only.
 *
 * Emits `delete` with the log id; the parent handles confirmation and
 * the store call. The row resolves its `administeredBy` member from
 * familyStore; if that member has been deleted, falls back gracefully
 * to the `medicationLog.someone` translation key so the row never breaks.
 *
 * The `data-log-id` attribute on the root lets callers (e.g.
 * `MedicationViewModal`) target the element for `useAttentionPulse`
 * when a new entry was just created.
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { formatLogEntryTime } from '@/utils/date';
import type { AvatarVariant } from '@/constants/avatars';
import type { MedicationLogEntry } from '@/types/models';

const props = withDefaults(
  defineProps<{
    entry: MedicationLogEntry;
    /**
     * When true, hides the trash button — use in read-only contexts
     * (e.g. the dose-confirm dialog's "given today" list) where the
     * row is informational and deletion shouldn't be a tap away.
     */
    readOnly?: boolean;
  }>(),
  { readOnly: false }
);
defineEmits<{ delete: [id: string] }>();

const familyStore = useFamilyStore();
const { t } = useTranslation();

const member = computed(() => familyStore.members.find((m) => m.id === props.entry.administeredBy));

const displayName = computed(() => member.value?.name ?? t('medicationLog.someone'));

const variant = computed<AvatarVariant>(
  () => (member.value?.avatar as AvatarVariant | undefined) ?? 'adult-other'
);
const color = computed(() => member.value?.color ?? '#AED6F1');

const { url: avatarUrl } = useAvatarPhotoUrl(() => member.value?.avatarPhotoId);

// Today → relative ("3h ago"); yesterday → "Yesterday at 8:30am";
// older → graduated absolute date+time so the day-separation between
// doses is obvious at a glance.
const relativeTime = computed(() => formatLogEntryTime(props.entry.administeredOn));
</script>

<template>
  <div
    class="group/row flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2 transition-colors dark:bg-slate-800/60"
    :data-log-id="entry.id"
  >
    <BeanieAvatar
      :variant="variant"
      :color="color"
      :photo-url="avatarUrl"
      size="sm"
      :aria-label="displayName"
    />
    <div class="min-w-0 flex-1">
      <p class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100">
        {{ displayName }}
      </p>
      <p class="font-inter truncate text-xs text-[#2C3E50]/60 dark:text-gray-400">
        {{ relativeTime }}
      </p>
    </div>
    <button
      v-if="!readOnly"
      type="button"
      :aria-label="t('action.delete')"
      class="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:bg-red-50 focus:text-red-600 focus:outline-none dark:hover:bg-red-950/30 dark:focus:bg-red-950/30"
      @click="$emit('delete', entry.id)"
    >
      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fill-rule="evenodd"
          d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
          clip-rule="evenodd"
        />
      </svg>
    </button>
  </div>
</template>
