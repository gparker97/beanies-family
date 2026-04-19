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

  it('sorts active medications before ended ones', () => {
    const wrapper = mountTab([
      makeMed({ id: 'm1', name: 'Ended-med', endDate: '2020-01-01' }),
      makeMed({ id: 'm2', name: 'Ongoing-med', ongoing: true }),
    ]);
    const text = wrapper.text();
    expect(text.indexOf('Ongoing-med')).toBeLessThan(text.indexOf('Ended-med'));
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
