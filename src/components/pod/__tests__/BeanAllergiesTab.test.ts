/**
 * Smoke tests for BeanAllergiesTab — empty-state, populated rendering
 * with severity sort, per-member filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanAllergiesTab from '@/components/pod/BeanAllergiesTab.vue';
import { useAllergiesStore } from '@/stores/allergiesStore';
import type { Allergy, AllergySeverity, AllergyType } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useAutoOpenOnQuery', () => ({
  useAutoOpenOnQuery: () => undefined,
}));

const MEMBER_ID = 'bean-neil';

function makeAllergy(overrides: Partial<Allergy> = {}): Allergy {
  return {
    id: overrides.id ?? 'a1',
    memberId: overrides.memberId ?? MEMBER_ID,
    name: overrides.name ?? 'Peanuts',
    allergyType: (overrides.allergyType as AllergyType) ?? 'food',
    severity: (overrides.severity as AllergySeverity) ?? 'mild',
    reaction: overrides.reaction,
    emergencyResponse: overrides.emergencyResponse,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T00:00:00Z',
  };
}

function mountTab(allergies: Allergy[] = []) {
  setActivePinia(createPinia());
  const store = useAllergiesStore();
  store.allergies = allergies;
  return mount(BeanAllergiesTab, {
    props: { memberId: MEMBER_ID },
    global: { stubs: { AllergyFormModal: true } },
  });
}

describe('BeanAllergiesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when the member has no allergies', () => {
    const wrapper = mountTab([]);
    expect(wrapper.text()).toContain('allergies.empty');
  });

  it('sorts allergies severity-first (severe → moderate → mild)', () => {
    const wrapper = mountTab([
      makeAllergy({ id: 'a1', name: 'Pollen', severity: 'mild' }),
      makeAllergy({ id: 'a2', name: 'Peanuts', severity: 'severe' }),
      makeAllergy({ id: 'a3', name: 'Cat dander', severity: 'moderate' }),
    ]);
    const text = wrapper.text();
    // All three names present.
    expect(text).toContain('Peanuts');
    expect(text).toContain('Cat dander');
    expect(text).toContain('Pollen');
    // Peanuts (severe) comes before Pollen (mild) in rendered order.
    expect(text.indexOf('Peanuts')).toBeLessThan(text.indexOf('Pollen'));
    expect(text.indexOf('Cat dander')).toBeLessThan(text.indexOf('Pollen'));
  });

  it('filters out allergies for other members', () => {
    const wrapper = mountTab([
      makeAllergy({ id: 'a1', name: 'Mine' }),
      makeAllergy({ id: 'a2', name: 'Sibling allergy', memberId: 'someone-else' }),
    ]);
    expect(wrapper.text()).toContain('Mine');
    expect(wrapper.text()).not.toContain('Sibling allergy');
  });
});
