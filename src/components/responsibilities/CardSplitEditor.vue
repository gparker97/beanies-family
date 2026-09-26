<script setup lang="ts">
/**
 * Who Owns What (#109): who holds a card, and how it is split (Requirement 5, mockup
 * section 6). Edits a local draft only; the edit drawer saves it once.
 *
 *  - One holder: a single `FamilyChipPicker`.
 *  - By child: one row per current child (a new child gets a row with nobody). Offered only
 *    while the family has a child; the drawer's validation still refuses a split with no
 *    parts (the last child removed while the drawer is open).
 *  - By label: rows the family names itself ("upstairs", "the apartment"), add / rename /
 *    remove.
 *
 * Switching mode goes through `draftPartsForMode`, the ONE owner of the part-key rules
 * (child ids, label uuids, `'main'`); this component never invents a key itself except
 * through `newLabelPartKey`.
 */
import { computed } from 'vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { draftPartsForMode, newLabelPartKey } from '@/utils/responsibilityOps';
import { childMembers } from '@/utils/responsibilityDeck';
import { fillTemplate } from '@/utils/fillTemplate';
import type { CardPart, CardSplitMode, FamilyMember } from '@/types/models';

export interface SplitDraft {
  splitMode: CardSplitMode;
  parts: CardPart[];
}

const props = withDefaults(
  defineProps<{
    modelValue: SplitDraft;
    /** The whole family (the child split is rebuilt from it). */
    members: readonly FamilyMember[];
    /** Who may hold a card: current non-pet members. */
    holders: FamilyMember[];
    /** False for a new card: one optional holder, no split. */
    allowSplit?: boolean;
    holderOptional?: boolean;
    /** `useFormValidation`'s bind for the label parts (every label needs a name). */
    partsBind?: Record<string, unknown>;
  }>(),
  { allowSplit: true, holderOptional: false, partsBind: () => ({}) }
);
const emit = defineEmits<{ 'update:modelValue': [value: SplitDraft] }>();

const { t } = useTranslation();
const { getMemberById, getMemberName } = useMemberInfo();
const { memberAvatarBindings } = useMemberAvatarBindings();

/** "By child" is offered only when there is a child to split for (else it has no parts). */
const hasChildren = computed(() => childMembers(props.members).length > 0);
const modeOptions = computed(() => [
  { value: 'single', label: t('whoOwnsWhat.edit.split.single'), variant: 'orange' as const },
  ...(hasChildren.value || props.modelValue.splitMode === 'child'
    ? [{ value: 'child', label: t('whoOwnsWhat.edit.split.child'), variant: 'orange' as const }]
    : []),
  { value: 'label', label: t('whoOwnsWhat.edit.split.label'), variant: 'orange' as const },
]);

function update(parts: CardPart[], splitMode = props.modelValue.splitMode): void {
  emit('update:modelValue', { splitMode, parts });
}

function setMode(mode: string): void {
  const next = mode as CardSplitMode;
  if (!next || next === props.modelValue.splitMode) return;
  update(
    draftPartsForMode(props.modelValue.parts, props.modelValue.splitMode, next, props.members),
    next
  );
}

function setHolder(index: number, value: string | string[]): void {
  const holderId = typeof value === 'string' && value ? value : undefined;
  update(
    props.modelValue.parts.map((p, i) => {
      if (i !== index) return p;
      const { holderId: _drop, ...rest } = p;
      return holderId ? { ...rest, holderId } : rest;
    })
  );
}

function setLabel(index: number, label: string): void {
  update(props.modelValue.parts.map((p, i) => (i === index ? { ...p, label } : p)));
}

function addPart(): void {
  update([...props.modelValue.parts, { key: newLabelPartKey(), label: '' }]);
}

function removePart(index: number): void {
  update(props.modelValue.parts.filter((_, i) => i !== index));
}

const singleHolder = computed(() => props.modelValue.parts[0]?.holderId ?? '');
</script>

<template>
  <div class="space-y-5">
    <FormFieldGroup
      v-if="modelValue.splitMode === 'single'"
      :label="t('whoOwnsWhat.edit.holder')"
      :optional="holderOptional"
    >
      <FamilyChipPicker
        :model-value="singleHolder"
        mode="single"
        :members="holders"
        data-testid="card-holder-picker"
        @update:model-value="setHolder(0, $event)"
      />
    </FormFieldGroup>

    <FormFieldGroup v-if="allowSplit" :label="t('whoOwnsWhat.edit.split')">
      <TogglePillGroup
        :model-value="modelValue.splitMode"
        :options="modeOptions"
        data-testid="card-split-mode"
        @update:model-value="setMode"
      />
    </FormFieldGroup>

    <FormFieldGroup
      v-if="modelValue.splitMode !== 'single'"
      :label="t('whoOwnsWhat.edit.parts')"
      v-bind="partsBind"
    >
      <p
        v-if="modelValue.splitMode === 'child' && !modelValue.parts.length"
        class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
      >
        {{ t('whoOwnsWhat.edit.noChildren') }}
      </p>
      <ul class="space-y-2.5">
        <li
          v-for="(part, index) in modelValue.parts"
          :key="part.key"
          class="dark:bg-surface-overlay space-y-2 rounded-2xl bg-white p-3"
          :data-testid="`card-part-${index}`"
        >
          <div class="flex items-center gap-2">
            <template v-if="modelValue.splitMode === 'child'">
              <BeanieAvatar
                v-if="getMemberById(part.key)"
                v-bind="memberAvatarBindings(getMemberById(part.key)!)"
                fallback="initials"
                size="xs"
              />
              <span
                class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]"
              >
                {{
                  fillTemplate(t('whoOwnsWhat.card.forChild'), {
                    name: getMemberName(part.key, ''),
                  })
                }}
              </span>
            </template>
            <template v-else>
              <input
                :value="part.label ?? ''"
                type="text"
                maxlength="40"
                :placeholder="t('whoOwnsWhat.edit.partPlaceholder')"
                :aria-label="t('whoOwnsWhat.edit.partName')"
                class="dark:border-line-strong dark:bg-surface-raised dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-base text-[var(--color-text)] focus:ring-2 focus:ring-[#AED6F1] focus:outline-none"
                @input="setLabel(index, ($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="modelValue.parts.length > 1"
                type="button"
                class="dark:text-ink-soft dark:hover:bg-surface-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-5)]"
                :aria-label="t('whoOwnsWhat.edit.removePart')"
                :title="t('whoOwnsWhat.edit.removePart')"
                @click="removePart(index)"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </template>
          </div>
          <FamilyChipPicker
            :model-value="part.holderId ?? ''"
            mode="single"
            compact
            :members="holders"
            @update:model-value="setHolder(index, $event)"
          />
        </li>
      </ul>
      <button
        v-if="modelValue.splitMode === 'label'"
        type="button"
        class="font-outfit text-primary-500 dark:text-accent-lift dark:hover:bg-surface-hover mt-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-[var(--tint-orange-8)]"
        data-testid="card-add-part"
        @click="addPart"
      >
        <span aria-hidden="true">＋</span> {{ t('whoOwnsWhat.edit.addPart') }}
      </button>
      <p
        v-if="modelValue.splitMode === 'child' && modelValue.parts.length"
        class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
      >
        {{ t('whoOwnsWhat.edit.childNote') }}
      </p>
    </FormFieldGroup>
  </div>
</template>
