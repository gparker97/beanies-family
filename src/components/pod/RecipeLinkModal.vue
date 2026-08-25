<script setup lang="ts">
/**
 * Paste-a-link intake for the recipe reader (#72 phases 2/3).
 *
 * Deliberately recipe-specific rather than a generic "prompt for one value" modal: no such
 * component exists today and there is exactly one caller, so extracting one now would be
 * speculative. If a second caller appears, that is the moment to generalise it.
 *
 * Validation is the SAME `routeUrl` the resolver uses, so what the user is told here and
 * what the fetcher will accept can never disagree.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { routeUrl } from '@/utils/recipeSourceUrl';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; submit: [url: string] }>();

const { t } = useTranslation();

const link = ref('');
/** Only show the error once the user has actually tried, so an empty field is not scolded. */
const touched = ref(false);

const route = computed(() => routeUrl(link.value));
const isValid = computed(() => route.value.kind !== 'invalid');
const showError = computed(() => touched.value && link.value.trim().length > 0 && !isValid.value);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      link.value = '';
      touched.value = false;
    }
  }
);

function handleSave(): void {
  touched.value = true;
  if (!isValid.value) return;
  emit('submit', link.value.trim());
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    layer="overlay"
    :open="open"
    :title="t('recipeExtract.link.title')"
    icon="🔗"
    icon-bg="var(--tint-orange-8)"
    size="default"
    :save-disabled="!isValid"
    @close="emit('close')"
    @save="handleSave"
  >
    <FormFieldGroup :label="t('recipeExtract.link.label')" required>
      <BaseInput
        v-model="link"
        type="url"
        :placeholder="t('recipeExtract.link.placeholder')"
        @blur="touched = true"
        @keyup.enter="handleSave"
      />
      <!-- Heritage Orange, not Alert Red: a mistyped link is routine, not a failure. -->
      <p v-if="showError" class="font-outfit text-primary-500 mt-1.5 text-xs">
        {{ t('recipeExtract.link.invalid') }}
      </p>
    </FormFieldGroup>
  </BeanieFormModal>
</template>
