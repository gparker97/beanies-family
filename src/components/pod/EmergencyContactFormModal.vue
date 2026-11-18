<script setup lang="ts">
/**
 * Add/edit an EmergencyContact. Category picker (chips), optional
 * custom-label refinement when "Other" is selected, plus the standard
 * contact fields. Phone and email both optional since many entries
 * skip one or the other (school main line has no email; poison
 * control has no address).
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import LocationField from '@/components/ui/LocationField.vue';
import { orUndefined } from '@/utils/diffPayload';
import { useLocationPair } from '@/composables/useLocationPair';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { confirm } from '@/composables/useConfirm';
import type { EmergencyContact, EmergencyContactCategory } from '@/types/models';

const props = defineProps<{
  open: boolean;
  contact?: EmergencyContact | null;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const store = useEmergencyContactsStore();

const category = ref<EmergencyContactCategory>('doctor');
const customCategory = ref('');
const name = ref('');
const role = ref('');
const phone = ref('');
const email = ref('');
/** #150: the address string and its picked place, bound as one pair. */
const addressPair = useLocationPair('address');
const { text: address, value: addressValue } = addressPair;
const notes = ref('');

const categoryOptions = computed(() => [
  { value: 'doctor', label: t('contacts.category.doctor'), icon: '\u{1FA7A}' },
  { value: 'dentist', label: t('contacts.category.dentist'), icon: '\u{1F9B7}' },
  { value: 'nurse', label: t('contacts.category.nurse'), icon: '\u{1F482}' },
  { value: 'teacher', label: t('contacts.category.teacher'), icon: '\u{1F469}\u200D\u{1F3EB}' },
  { value: 'school', label: t('contacts.category.school'), icon: '\u{1F3EB}' },
  { value: 'other', label: t('contacts.category.other'), icon: '\u2728' },
]);

const { isEditing, isSubmitting } = useFormModal(
  () => props.contact,
  () => props.open,
  {
    onEdit: (c) => {
      category.value = c.category;
      customCategory.value = c.customCategory ?? '';
      name.value = c.name;
      role.value = c.role ?? '';
      phone.value = c.phone ?? '';
      email.value = c.email ?? '';
      addressPair.seed(c);
      notes.value = c.notes ?? '';
    },
    onNew: () => {
      category.value = 'doctor';
      customCategory.value = '';
      name.value = '';
      role.value = '';
      phone.value = '';
      email.value = '';
      addressPair.reset();
      notes.value = '';
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('contacts.editTitle') : t('contacts.addTitle')
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = {
      category: category.value,
      ...(category.value === 'other' && customCategory.value.trim()
        ? { customCategory: customCategory.value.trim() }
        : {}),
      name: name.value.trim(),
      ...(role.value.trim() ? { role: role.value.trim() } : {}),
      ...(phone.value.trim() ? { phone: phone.value.trim() } : {}),
      ...(email.value.trim() ? { email: email.value.trim() } : {}),
      // Present-as-undefined when cleared, so the address and its place are really removed.
      ...addressPair.patch(orUndefined(address.value)),
      ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    };
    if (isEditing.value && props.contact) {
      await store.updateContact(props.contact.id, payload);
    } else {
      await store.createContact(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.contact) return;
  const ok = await confirm({
    title: 'contacts.deleteConfirm.title',
    message: 'contacts.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await store.deleteContact(props.contact.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="🆘"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('contacts.field.category')">
      <FrequencyChips
        :model-value="category"
        :options="categoryOptions"
        @update:model-value="(v: string) => (category = v as EmergencyContactCategory)"
      />
    </FormFieldGroup>

    <FormFieldGroup
      v-if="category === 'other'"
      :label="t('contacts.field.customCategory')"
      optional
    >
      <BaseInput v-model="customCategory" :placeholder="t('contacts.placeholder.customCategory')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('contacts.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('contacts.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('contacts.field.role')" optional>
      <BaseInput v-model="role" :placeholder="t('contacts.placeholder.role')" />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('contacts.field.phone')" optional>
        <BaseInput v-model="phone" type="tel" :placeholder="t('contacts.placeholder.phone')" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('contacts.field.email')" optional>
        <BaseInput v-model="email" type="email" :placeholder="t('contacts.placeholder.email')" />
      </FormFieldGroup>
    </div>

    <FormFieldGroup :label="t('contacts.field.address')" optional>
      <LocationField v-model:value="addressValue" mode="address" field-kind="contact" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('contacts.field.notes')" optional>
      <textarea
        v-model="notes"
        rows="3"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter dark:border-line-strong dark:bg-surface-overlay dark:text-ink w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1"
        :placeholder="t('contacts.placeholder.notes')"
      />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
