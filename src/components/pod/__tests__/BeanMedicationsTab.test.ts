/**
 * Smoke tests for BeanMedicationsTab — empty-state, populated
 * rendering with active-first sort, per-member filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanMedicationsTab from '@/components/pod/BeanMedicationsTab.vue';
import { useMedicationsStore } from '@/stores/medicationsStore';
import type { Medication } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useQuickAddIntent', () => ({
  useQuickAddIntent: () => undefined,
}));

const MEMBER_ID = 'bean-neil';

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: overrides.id ?? 'm1',
    memberId: overrides.memberId ?? MEMBER_ID,
    name: overrides.name ?? 'Amoxicillin',
    dose: overrides.dose ?? '5 ml',
    frequency: overrides.frequency ?? '3 times a day',
    startDate: overrides.startDate,
    endDate: overrides.endDate,
    ongoing: overrides.ongoing,
    notes: overrides.notes,
    photoIds: overrides.photoIds,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T00:00:00Z',
  };
}

function mountTab(medications: Medication[] = []) {
  setActivePinia(createPinia());
  const store = useMedicationsStore();
  store.medications = medications;
  return mount(BeanMedicationsTab, {
    props: { memberId: MEMBER_ID },
    global: { stubs: { MedicationFormModal: true } },
  });
}

describe('BeanMedicationsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when the member has no medications', () => {
    const wrapper = mountTab([]);
    expect(wrapper.text()).toContain('medications.empty');
  });

  it('shows active medications in the primary grid and keeps ended ones collapsed by default', async () => {
    const wrapper = mountTab([
      makeMed({ id: 'm1', name: 'Ended-med', endDate: '2020-01-01' }),
      makeMed({ id: 'm2', name: 'Ongoing-med', ongoing: true }),
    ]);
    // Active med is rendered immediately; ended med is hidden until the
    // "Ended medications" section is expanded.
    expect(wrapper.text()).toContain('Ongoing-med');
    expect(wrapper.text()).not.toContain('Ended-med');
    expect(wrapper.text()).toContain('medications.endedSection.title');

    // Toggle the section — ended med now renders.
    await wrapper.find('button[aria-expanded]').trigger('click');
    expect(wrapper.text()).toContain('Ended-med');
  });

  it('filters out medications for other members', () => {
    const wrapper = mountTab([
      makeMed({ id: 'm1', name: 'Mine' }),
      makeMed({ id: 'm2', name: 'Sibling med', memberId: 'someone-else' }),
    ]);
    expect(wrapper.text()).toContain('Mine');
    expect(wrapper.text()).not.toContain('Sibling med');
  });
});
