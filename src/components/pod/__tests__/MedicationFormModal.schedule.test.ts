/**
 * MedicationFormModal — schedule choice + end-date safety gate.
 *
 * The bare "ongoing" toggle was replaced by an explicit two-option
 * schedule control ("Ongoing" / "Has an end date"). These tests pin the
 * two behaviours that matter for a care-and-safety record:
 *   1. Choosing "Has an end date" reveals the end-date field.
 *   2. Save is blocked until that end date is actually provided — an
 *      end-dated medication with no date must not persist.
 *
 * The eager-create + photo-binding composables are stubbed: they have
 * store side effects irrelevant to the schedule view logic under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import MedicationFormModal from '@/components/pod/MedicationFormModal.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useEagerEntityCreate', () => ({
  useEagerEntityCreate: () => ({
    entityId: ref<string | null>(null),
    isCreating: ref(false),
    reset: vi.fn(),
    commit: vi.fn(),
    ensureId: vi.fn(),
  }),
}));

vi.mock('@/composables/usePhotoEntityBinding', () => ({
  usePhotoEntityBinding: () => ({
    photoIds: ref<string[]>([]),
    updatePhotoIds: vi.fn(),
  }),
}));

const BeanieFormModalStub = {
  name: 'BeanieFormModal',
  props: [
    'open',
    'title',
    'icon',
    'iconBg',
    'size',
    'variant',
    'saveDisabled',
    'isSubmitting',
    'showDelete',
  ],
  template: '<div><slot /></div>',
};

const DatePickerStub = {
  name: 'BeanieDatePicker',
  props: ['modelValue', 'disabled'],
  template:
    '<input class="date-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountModal() {
  setActivePinia(createPinia());
  return mount(MedicationFormModal, {
    props: { open: false, memberId: 'bean-neil', medication: null },
    global: {
      stubs: {
        BeanieFormModal: BeanieFormModalStub,
        BeanieDatePicker: DatePickerStub,
        PhotoAttachments: true,
        BeanieIcon: true,
      },
    },
  });
}

/** Drive the three required core fields so canSave hinges only on the schedule. */
async function fillCoreFields(wrapper: ReturnType<typeof mountModal>) {
  await wrapper.find('input[placeholder="medications.placeholder.name"]').setValue('Amoxicillin');
  await wrapper.find('input[placeholder="medications.placeholder.dose"]').setValue('5 ml');
  // Pick a structured dose → sets frequency display string.
  const onceBtn = wrapper
    .findAll('button')
    .find((b) => b.text() === 'medications.dosesOption.once');
  await onceBtn?.trigger('click');
}

function saveDisabled(wrapper: ReturnType<typeof mountModal>): boolean {
  return wrapper.findComponent(BeanieFormModalStub).props('saveDisabled') as boolean;
}

/** The end-date reveal wrapper's `show` prop — true once revealed. */
function endDateShown(wrapper: ReturnType<typeof mountModal>): boolean {
  return wrapper.findComponent(ConditionalSection).props('show') as boolean;
}

async function chooseHasEndDate(wrapper: ReturnType<typeof mountModal>) {
  const endsBtn = wrapper
    .findAll('button')
    .find((b) => b.text() === 'medications.schedule.hasEndDate');
  await endsBtn?.trigger('click');
  await wrapper.vm.$nextTick();
}

describe('MedicationFormModal — schedule + end-date gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to "Ongoing" with the end-date field collapsed', async () => {
    const wrapper = mountModal();
    await wrapper.setProps({ open: true }); // triggers onNew()
    await wrapper.vm.$nextTick();

    // The ongoing-only hint is shown and the end-date reveal is collapsed.
    expect(wrapper.text()).toContain('medications.schedule.ongoingHint');
    expect(endDateShown(wrapper)).toBe(false);
  });

  it('choosing "Has an end date" reveals the end-date field and blocks save until it is set', async () => {
    const wrapper = mountModal();
    await wrapper.setProps({ open: true });
    await wrapper.vm.$nextTick();
    await fillCoreFields(wrapper);

    // Core fields valid + ongoing → save enabled.
    expect(saveDisabled(wrapper)).toBe(false);

    await chooseHasEndDate(wrapper);

    // End-date field now revealed, but no date yet → save blocked (safety gate),
    // and the ongoing hint is gone.
    expect(endDateShown(wrapper)).toBe(true);
    expect(wrapper.text()).not.toContain('medications.schedule.ongoingHint');
    expect(saveDisabled(wrapper)).toBe(true);

    // Provide an end date (2nd date picker; the 1st is the start date) → unblocks.
    const dateInputs = wrapper.findAll('input.date-stub');
    await dateInputs[dateInputs.length - 1].setValue('2026-12-31');
    await wrapper.vm.$nextTick();
    expect(saveDisabled(wrapper)).toBe(false);
  });
});
