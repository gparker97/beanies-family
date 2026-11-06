<script setup lang="ts">
/**
 * "Keep Parents Posted": the one place the copy and the on/off hint live for the per-item
 * flag that lets grown-ups see a child's routine every time, not only when it is missed.
 * Interactive by default (a `ToggleRow`); with `readonly` it renders only the hint, for
 * surfaces where the flag is managed elsewhere (a card to-do, the card view drawer).
 */
import ToggleRow from '@/components/ui/ToggleRow.vue';
import { useTranslation } from '@/composables/useTranslation';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** `data-testid` for the switch (interactive) or the hint paragraph (readonly). */
    testid?: string;
    readonly?: boolean;
  }>(),
  { testid: undefined, readonly: false }
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const { t } = useTranslation();

const hint = () =>
  t(props.modelValue ? 'recurrence.notifyParents.hintOn' : 'recurrence.notifyParents.hintOff');
</script>

<template>
  <p
    v-if="readonly"
    class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
    :data-testid="testid"
  >
    {{ hint() }}
  </p>
  <ToggleRow
    v-else
    :model-value="modelValue"
    :title="t('recurrence.notifyParents.title')"
    :hint="hint()"
    :testid="testid"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
