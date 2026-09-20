<script setup lang="ts">
/**
 * Quick Add's inline member picker: a thin binding of `useQuickAdd` to `InlineMemberPicker`.
 *
 * The presentation — the fold-down expansion, the back chip, the staggered avatar grid, the
 * empty state — moved to `src/components/ui/InlineMemberPicker.vue` so the magic-link mint
 * surfaces could reuse it instead of each growing their own copy. What stays here is the part
 * that is genuinely Quick Add's: the `stage` binding, the pending item's label, and the
 * re-scroll when the user taps a SIBLING member-required tile without this component
 * unmounting.
 *
 * Why inline rather than a view swap, kept from the original because it is still the reason:
 * - Families are small (3 to 8 beanies), so the grid fits a tight inline card.
 * - Member selection is the most common picker case.
 * - Staying in the main grid keeps the spatial connection to the tapped tile (highlighted via
 *   `is-pending`) and lets the user change their mind without backing out.
 * - Recipes and medications can be unbounded, so they need a full scrollable view; fan-out and
 *   inline layouts do not scale past about eight items.
 *
 * ⚠️ BOTH `data-testid`s ARE PRESERVED VERBATIM (`quick-add-member-picker-inline` and
 * `quick-add-member-inline-tile-${id}`). Nothing in the suite referenced them when this was
 * extracted, which is precisely why they are pinned here: the extraction had no safety net, so
 * the ids are the contract a future test will hang off.
 *
 * ⚠️ PETS STAY IN THIS LIST, unlike the sign-in pickers. A pet cannot sign in, but a pet can
 * take medication, have an allergy and have a favourite toy — which is exactly what this picker
 * is for. `sortedMembers`, not `sortedHumans`.
 */
import { computed, watch, useTemplateRef } from 'vue';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';

const { t } = useTranslation();
const { stage, commitPicker, cancelPicker } = useQuickAdd();
const familyStore = useFamilyStore();

const members = computed(() => familyStore.sortedMembers);

/**
 * Backs the header's second line ("Pick a beanie for <Label>"). Guarded: this component should
 * only mount when `stage.mode === 'picker'`, but we stay defensive against future mount-order
 * bugs rather than rendering a raw key.
 */
const pendingLabel = computed(() => {
  if (stage.value.mode !== 'picker') return undefined;
  return t(stage.value.pending.labelKey);
});

const pickerRef = useTemplateRef<InstanceType<typeof InlineMemberPicker>>('pickerRef');

/**
 * Re-tapping ANOTHER member-required item within the same group keeps this component mounted
 * (same `v-if` slot), so the child's own `onMounted` scroll does not fire again. Without this,
 * a mobile user who scrolled up and tapped a sibling would see no response and the picker would
 * feel broken even though it had updated its highlight and header copy.
 */
watch(
  () => (stage.value.mode === 'picker' ? stage.value.pending.id : null),
  (newId, oldId) => {
    if (!newId || !oldId || newId === oldId) return;
    void pickerRef.value?.scrollIntoView();
  }
);
</script>

<template>
  <InlineMemberPicker
    ref="pickerRef"
    data-testid="quick-add-member-picker-inline"
    :members="members"
    :title="t('quickAdd.picker.bean.title')"
    :subtitle="pendingLabel"
    :back-label="t('quickAdd.picker.back')"
    :empty-message="t('quickAdd.picker.bean.empty')"
    :tile-testid-prefix="'quick-add-member-inline-tile-'"
    @pick="commitPicker"
    @cancel="cancelPicker"
  />
</template>
