<script setup lang="ts">
/**
 * The hour Morning, Afternoon and Evening start (#146): a family setting, the same for
 * everyone. The four blocks themselves are fixed; Anytime shows all day. Changing the hours
 * changes only which block is "now" and which have ended, never anyone's ticks.
 *
 * The store refuses unless morning < afternoon < evening. That rule is shown INLINE here, in
 * Heritage Orange (never red: it is guidance, not a hard error), the moment the three hours
 * fall out of order, and Save is drawn not-ready; a Save tap while out of order writes nothing.
 *
 * Dark mode: each row paints its block's `--chore-tint` / `--chore-ink` (dark partners in
 * `src/style.css`); the hint is `ink-faint`, the refusal `accent-lift`.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieTimePicker from '@/components/ui/BeanieTimePicker.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { isValidBlockStarts } from '@/utils/chores';
import type { ChoreBlockStarts } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();

const TIMED = ['morning', 'afternoon', 'evening'] as const;

const draft = ref<ChoreBlockStarts>({ ...choreStore.starts });

function reset(): void {
  draft.value = { ...choreStore.starts };
}

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  { onEdit: reset, onNew: reset }
);

const ordered = computed(() => isValidBlockStarts(draft.value));
const unchanged = computed(() => TIMED.every((b) => draft.value[b] === choreStore.starts[b]));

function setStart(block: (typeof TIMED)[number], value: string): void {
  // A cleared pill is not an hour; keep the last one rather than store a gap.
  if (!value) return;
  draft.value = { ...draft.value, [block]: value };
}

async function onSave(): Promise<void> {
  if (isSubmitting.value || !ordered.value) return;
  if (unchanged.value) {
    emit('close');
    return;
  }
  const actorId = familyStore.currentMemberId;
  if (!actorId) return;
  isSubmitting.value = true;
  try {
    // null: the store has already toasted (a refusal or a failed write). Stay open.
    const ok = await choreStore.setBlockStarts({ ...draft.value }, actorId);
    if (ok) emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('choreboard.hoursModal.title')"
    icon="🕐"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="t('choreboard.hoursModal.save')"
    :save-ready="ordered"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-2" data-testid="chore-hours-modal">
      <div
        v-for="b in TIMED"
        :key="b"
        class="font-outfit flex items-center gap-3 rounded-2xl bg-[var(--chore-tint)] px-3 py-2 text-base font-bold text-[var(--chore-ink)]"
        :class="CHORE_BLOCK_META[b].colorClass"
        data-testid="chore-hours-row"
        :data-block="b"
      >
        <span class="text-2xl" aria-hidden="true">{{ CHORE_BLOCK_META[b].emoji }}</span>
        <span class="min-w-0 flex-1">
          {{ t(CHORE_BLOCK_META[b].labelKey) }}
          <span class="font-inter block text-xs font-medium">{{
            t('choreboard.hoursModal.startsAt')
          }}</span>
        </span>
        <BeanieTimePicker
          :model-value="draft[b]"
          class="w-32 flex-none"
          @update:model-value="setStart(b, $event)"
        />
      </div>
      <div
        class="font-outfit chore-block-anytime flex items-center gap-3 rounded-2xl bg-[var(--chore-tint)] px-3 py-2 text-base font-bold text-[var(--chore-ink)]"
        data-testid="chore-hours-row"
        data-block="anytime"
      >
        <span class="text-2xl" aria-hidden="true">{{ CHORE_BLOCK_META.anytime.emoji }}</span>
        <span class="min-w-0 flex-1">
          {{ t(CHORE_BLOCK_META.anytime.labelKey) }}
          <span class="font-inter block text-xs font-medium">{{
            t('choreboard.hoursModal.allDay')
          }}</span>
        </span>
      </div>
    </div>

    <p
      v-if="!ordered"
      class="text-primary-700 dark:text-accent-lift mt-3 text-sm font-semibold"
      role="status"
      data-testid="chore-hours-refusal"
    >
      {{ t('choreboard.error.badHours') }}
    </p>
    <p class="dark:text-ink-faint text-secondary-400 mt-3 text-xs">
      {{ t('choreboard.hoursModal.hint') }}
    </p>
  </BeanieFormModal>
</template>
