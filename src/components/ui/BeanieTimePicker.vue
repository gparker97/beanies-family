<script setup lang="ts">
/**
 * One time field: a pill that opens the time picker (a sheet on phones, a popover from 768px).
 * For a start/end pair use `BeanieTimeRange`, which adds durations, Recent and All day.
 *
 * Each pick reaches the v-model exactly once: a minute, a typed time or Done writes and
 * closes; an hour tap only lights the hour; dismissing (outside click, the dim, Escape) writes
 * nothing. That matters to callers that save on every update and close their inline editor
 * when they do (`useInlineEdit.saveField`). Done writes only a value that differs.
 *
 * `clearable` adds the ✕ beside a set pill and Clear in the panel's footer; both write `''`.
 */
import { computed, ref } from 'vue';
import TimePickerHost from '@/components/ui/TimePickerHost.vue';
import TimePickerPanel from '@/components/ui/TimePickerPanel.vue';
import TimePickerPill from '@/components/ui/TimePickerPill.vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12, isWallClockTime } from '@/utils/date';

interface Props {
  /** `HH:mm`, or `''` for no time. */
  modelValue: string;
  clearable?: boolean;
  /** The empty pill's text. Default: "Select a time". */
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), { clearable: false, placeholder: undefined });

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();

const host = ref<InstanceType<typeof TimePickerHost> | null>(null);

const isSet = computed(() => isWallClockTime(props.modelValue));
const label = computed(() =>
  isSet.value ? formatTime12(props.modelValue) : (props.placeholder ?? t('modal.selectTime'))
);

function write(value: string): void {
  emit('update:modelValue', value);
  host.value?.close();
}

function onDone(value: string | null): void {
  if (value !== null && value !== props.modelValue) emit('update:modelValue', value);
  host.value?.close();
}
</script>

<template>
  <TimePickerHost ref="host" :title="t('modal.selectTime')" :subtitle="isSet ? label : undefined">
    <template #default="{ isOpen, open, close }">
      <TimePickerPill
        :label="label"
        :is-set="isSet"
        :is-open="isOpen"
        :clearable="clearable"
        @toggle="(el) => (isOpen ? close() : open(el))"
        @clear="write('')"
      />
    </template>
    <template #panel="{ isSheet }">
      <TimePickerPanel
        :value="modelValue"
        :clearable="clearable"
        :autofocus-typed="!isSheet"
        @commit="write"
        @done="onDone"
        @clear="write('')"
      />
    </template>
  </TimePickerHost>
</template>
