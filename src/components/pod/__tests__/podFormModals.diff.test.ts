/**
 * Snapshot-at-open diff in the pod form modals (CRDT merge-safe writes, #117).
 *
 * An edit sends ONLY what the user changed, so a concurrent edit to another field on another
 * device is never overwritten; clearing a field sends it as `undefined` (the repo's delete
 * signal); an untouched save still calls `update`, with `{}` (the worker no-ops it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import AllergyFormModal from '@/components/pod/AllergyFormModal.vue';
import SayingFormModal from '@/components/pod/SayingFormModal.vue';
import MemberNoteFormModal from '@/components/pod/MemberNoteFormModal.vue';
import MedicationFormModal from '@/components/pod/MedicationFormModal.vue';
import CookLogFormModal from '@/components/pod/CookLogFormModal.vue';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useRecipesStore } from '@/stores/recipesStore';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));

const stubs = {
  BeanieFormModal: {
    name: 'BeanieFormModal',
    props: ['saveDisabled', 'isSubmitting', 'showDelete', 'title'],
    template: '<div><slot /></div>',
  },
  PhotoAttachments: true,
  BeanieDatePicker: true,
};

async function mountOpen(component: object, props: Record<string, unknown>) {
  const wrapper = mount(component as typeof AllergyFormModal, {
    props: { open: false, ...props } as never,
    global: { stubs },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  await nextTick();
  return wrapper;
}

async function save(wrapper: ReturnType<typeof mount>) {
  wrapper.findComponent({ name: 'BeanieFormModal' }).vm.$emit('save');
  await flushPromises();
}

beforeEach(() => setActivePinia(createPinia()));

describe('AllergyFormModal', () => {
  const allergy = {
    id: 'al1',
    memberId: 'm1',
    name: 'Peanuts',
    allergyType: 'food',
    severity: 'mild',
    reaction: 'hives',
    reviewedOn: '2026-01-01',
  };

  it('edit writes only the changed field', async () => {
    const store = useAllergiesStore();
    store.updateAllergy = vi.fn().mockResolvedValue(allergy);
    const w = await mountOpen(AllergyFormModal, { memberId: 'm1', allergy });
    await w.find('input').setValue('Tree nuts');
    await save(w);
    expect(store.updateAllergy).toHaveBeenCalledWith('al1', { name: 'Tree nuts' });
  });

  it('clearing a field sends it as undefined', async () => {
    const store = useAllergiesStore();
    store.updateAllergy = vi.fn().mockResolvedValue(allergy);
    const w = await mountOpen(AllergyFormModal, { memberId: 'm1', allergy });
    const reaction = w
      .findAll('input')
      .find((i) => (i.element as HTMLInputElement).value === 'hives');
    await reaction!.setValue('');
    await save(w);
    const payload = vi.mocked(store.updateAllergy).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['reaction']);
    expect(payload.reaction).toBeUndefined();
  });

  it('an untouched edit calls update with an empty patch', async () => {
    const store = useAllergiesStore();
    store.updateAllergy = vi.fn().mockResolvedValue(allergy);
    const w = await mountOpen(AllergyFormModal, { memberId: 'm1', allergy });
    await save(w);
    expect(store.updateAllergy).toHaveBeenCalledWith('al1', {});
  });

  it('create sends the full payload', async () => {
    const store = useAllergiesStore();
    store.createAllergy = vi.fn().mockResolvedValue(allergy);
    const w = await mountOpen(AllergyFormModal, { memberId: 'm1', allergy: null });
    await w.find('input').setValue('Dust');
    await save(w);
    expect(store.createAllergy).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', name: 'Dust', allergyType: 'food' })
    );
  });
});

describe('SayingFormModal', () => {
  const saying = { id: 's1', memberId: 'm1', words: 'banana', place: 'car', saidOn: '2026-02-02' };

  it('edit writes only the changed field; clearing sends undefined', async () => {
    const store = useSayingsStore();
    store.updateSaying = vi.fn().mockResolvedValue(saying);
    const w = await mountOpen(SayingFormModal, { memberId: 'm1', saying });
    const place = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === 'car');
    await place!.setValue('');
    await save(w);
    const payload = vi.mocked(store.updateSaying).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['place']);
    expect(payload.place).toBeUndefined();
  });
});

describe('MemberNoteFormModal', () => {
  const note = { id: 'n1', memberId: 'm1', title: 'Shoes', body: 'size 3' };

  it('edit writes only the changed field', async () => {
    const store = useMemberNotesStore();
    store.updateMemberNote = vi.fn().mockResolvedValue(note);
    const w = await mountOpen(MemberNoteFormModal, { memberId: 'm1', note });
    await w.find('input').setValue('Shoes!');
    await save(w);
    expect(store.updateMemberNote).toHaveBeenCalledWith('n1', { title: 'Shoes!' });
  });
});

describe('MedicationFormModal', () => {
  const medication = {
    id: 'med1',
    memberId: 'm1',
    name: 'Amoxicillin',
    dose: '5ml',
    frequency: 'Twice a day',
    dosesPerDay: 2,
    startDate: '2026-03-01',
    ongoing: true,
    notes: 'with food',
  };

  it('edit writes only the changed field and never photoIds', async () => {
    const store = useMedicationsStore();
    store.updateMedication = vi.fn().mockResolvedValue(medication);
    const w = await mountOpen(MedicationFormModal, { memberId: 'm1', medication });
    const dose = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === '5ml');
    await dose!.setValue('10ml');
    await save(w);
    expect(store.updateMedication).toHaveBeenCalledWith('med1', { dose: '10ml' });
  });

  it('clearing the notes sends notes: undefined', async () => {
    const store = useMedicationsStore();
    store.updateMedication = vi.fn().mockResolvedValue(medication);
    const w = await mountOpen(MedicationFormModal, { memberId: 'm1', medication });
    const notes = w
      .findAll('input,textarea')
      .find((i) => (i.element as HTMLInputElement).value === 'with food');
    await notes!.setValue('');
    await save(w);
    const payload = vi.mocked(store.updateMedication).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['notes']);
    expect(payload.notes).toBeUndefined();
  });
});

describe('CookLogFormModal', () => {
  const entry = {
    id: 'c1',
    recipeId: 'r1',
    cookedOn: '2026-04-04',
    rating: 4,
    wentWell: 'crispy',
    photoIds: ['p1'],
  };

  it('edit writes only the changed field and never photoIds', async () => {
    const store = useRecipesStore();
    store.updateCookLog = vi.fn().mockResolvedValue(entry);
    const w = await mountOpen(CookLogFormModal, { recipeId: 'r1', entry });
    const went = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === 'crispy');
    await went!.setValue('golden');
    await save(w);
    expect(store.updateCookLog).toHaveBeenCalledWith('c1', { wentWell: 'golden' });
  });

  it('clearing a field sends it as undefined', async () => {
    const store = useRecipesStore();
    store.updateCookLog = vi.fn().mockResolvedValue(entry);
    const w = await mountOpen(CookLogFormModal, { recipeId: 'r1', entry });
    const went = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === 'crispy');
    await went!.setValue('');
    await save(w);
    const payload = vi.mocked(store.updateCookLog).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['wentWell']);
    expect(payload.wentWell).toBeUndefined();
  });

  it('create without a photo calls createCookLog once with no photoIds', async () => {
    const store = useRecipesStore();
    store.createCookLog = vi.fn().mockResolvedValue({ ...entry, id: 'new' });
    const w = await mountOpen(CookLogFormModal, { recipeId: 'r1', entry: null });
    await save(w);
    expect(store.createCookLog).toHaveBeenCalledOnce();
    expect(vi.mocked(store.createCookLog).mock.calls[0]![0]).not.toHaveProperty('photoIds');
  });
});
