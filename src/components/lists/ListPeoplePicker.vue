<script setup lang="ts">
/**
 * Who a list (#147) or a chore (#146) is for: several people allowed, never nobody. The ONE copy
 * of that rule, shared by the list drawer, the new-list sheet and the Add Chores sheet, so its
 * hint names no list. A pick that leaves nobody the roster still
 * knows (none chosen, or only removed members, which the chip picker keeps) is not emitted: the
 * current people stay and an inline hint in Heritage Orange (never red) says why. The `hint`
 * slot holds the host's resting hint, shown while nothing is refused. The refusal clears on the
 * next accepted pick, whenever the host sets a selection the roster knows (a reseeded or
 * reopened modal, which stays mounted while closed), and when the host unmounts the picker.
 */
import { ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { membersByIds } from '@/utils/assignees';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

const props = defineProps<{
  modelValue: string[];
  /** The refusal hint's test id (each host keeps its own). */
  hintTestid: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const refused = ref(false);

const knowsSomeone = (ids: readonly string[]) => membersByIds(familyStore.members, ids).length > 0;

// The host set a valid selection itself (it reseeded on reopen, or carried people in): any
// earlier refusal no longer describes what is on screen.
watch(
  () => props.modelValue,
  (ids) => {
    if (refused.value && knowsSomeone(ids)) refused.value = false;
  }
);

function pick(value: string | string[]): void {
  const ids = Array.isArray(value) ? value : [value];
  // Counted against the roster: the picker keeps ids it does not show (a removed member), and
  // the store prunes those, so a selection holding only them is as empty as no selection.
  refused.value = !knowsSomeone(ids);
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
