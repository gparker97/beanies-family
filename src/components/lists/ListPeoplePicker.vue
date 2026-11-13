<script setup lang="ts">
/**
 * Who a list is for (#147): several people allowed, never nobody. The ONE copy of that rule,
 * shared by the list drawer and the new-list sheet. A pick that leaves nobody the roster still
 * knows (none chosen, or only removed members, which the chip picker keeps) is not emitted: the
 * current people stay and an inline hint in Heritage Orange (never red) says why. The `hint`
 * slot holds the host's resting hint, shown while nothing is refused. The refusal clears on the
 * next accepted pick, and when the host unmounts the picker (closing the row or the sheet).
 */
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { membersByIds } from '@/utils/assignees';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

defineProps<{
  modelValue: string[];
  /** The refusal hint's test id (each host keeps its own). */
  hintTestid: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const refused = ref(false);

function pick(value: string | string[]): void {
  const ids = Array.isArray(value) ? value : [value];
  // Counted against the roster: the picker keeps ids it does not show (a removed member), and
  // the store prunes those, so a selection holding only them is as empty as no selection.
  refused.value = membersByIds(familyStore.members, ids).length === 0;
  if (!refused.value) emit('update:modelValue', ids);
}
</script>

<template>
  <div>
    <FamilyChipPicker :model-value="modelValue" mode="multi" compact @update:model-value="pick" />
    <p
      v-if="refused"
      class="text-primary-600 dark:text-accent-lift mt-1.5 text-xs font-semibold"
      role="status"
      :data-testid="hintTestid"
    >
      {{ t('lists.people.keepOne') }}
    </p>
    <slot v-else name="hint" />
  </div>
</template>
