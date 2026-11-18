/**
 * #150: the emergency contact address is written with its picked place, and clearing the
 * address removes both (the old conditional spread left the key out, so a clear was never
 * written).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

const flags = vi.hoisted(() => ({ on: true }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

import EmergencyContactFormModal from '@/components/pod/EmergencyContactFormModal.vue';
import LocationField from '@/components/ui/LocationField.vue';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import type { EmergencyContact } from '@/types/models';

const PLACE = { placeId: 'ChIJ1', name: '1 Raffles Place, Singapore 048616' };
const contact = (over: Partial<EmergencyContact> = {}): EmergencyContact =>
  ({
    id: 'c1',
    category: 'doctor',
    name: 'Dr Lim',
    address: `${PLACE.name}, level 5`,
    addressPlace: PLACE,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }) as unknown as EmergencyContact;

async function mountModal(c?: EmergencyContact) {
  setActivePinia(createPinia());
  const store = useEmergencyContactsStore();
  store.createContact = vi.fn().mockResolvedValue(null);
  store.updateContact = vi.fn().mockResolvedValue(null);
  const wrapper = mount(EmergencyContactFormModal, {
    props: { open: false, contact: c ?? null } as never,
    global: {
      stubs: {
        BeanieFormModal: {
          emits: ['save'],
          template: '<div><slot /><button data-testid="save" @click="$emit(\'save\')" /></div>',
        },
      },
    },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  return { wrapper, store };
}

describe('EmergencyContactFormModal address (#150)', () => {
  beforeEach(() => {
    flags.on = true;
    vi.clearAllMocks();
  });

  it('seeds the field with the stored string and place', async () => {
    const { wrapper } = await mountModal(contact());
    expect(wrapper.getComponent(LocationField).props('value')).toEqual({
      text: `${PLACE.name}, level 5`,
      place: PLACE,
    });
  });

  it('an untouched save writes the same string and the same place', async () => {
    const { wrapper, store } = await mountModal(contact());
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    const [, payload] = vi.mocked(store.updateContact).mock.calls[0]!;
    expect(payload).toMatchObject({ address: `${PLACE.name}, level 5`, addressPlace: PLACE });
  });

  it('clearing the address removes it AND its place (keys present as undefined)', async () => {
    const { wrapper, store } = await mountModal(contact());
    wrapper.getComponent(LocationField).vm.$emit('update:value', { text: '' });
    await nextTick();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    const [, payload] = vi.mocked(store.updateContact).mock.calls[0]!;
    expect(payload).toHaveProperty('address', undefined);
    expect(payload).toHaveProperty('addressPlace', undefined);
  });

  it('a place that no longer matches the string is not written back', async () => {
    const { wrapper, store } = await mountModal(contact());
    wrapper
      .getComponent(LocationField)
      .vm.$emit('update:value', { text: '9 Other Road', place: PLACE });
    await nextTick();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    const [, payload] = vi.mocked(store.updateContact).mock.calls[0]!;
    expect(payload).toMatchObject({ address: '9 Other Road' });
    expect(payload).toHaveProperty('addressPlace', undefined);
  });
});
