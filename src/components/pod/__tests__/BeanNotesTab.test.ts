/**
 * Smoke tests for BeanNotesTab — empty-state, populated rendering,
 * per-member filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanNotesTab from '@/components/pod/BeanNotesTab.vue';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import type { MemberNote } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useQuickAddIntent', () => ({
  useQuickAddIntent: () => undefined,
}));

const MEMBER_ID = 'bean-neil';

function makeNote(overrides: Partial<MemberNote> = {}): MemberNote {
  return {
    id: overrides.id ?? 'n1',
    memberId: overrides.memberId ?? MEMBER_ID,
    title: overrides.title ?? 'Bedtime routine',
    body: overrides.body ?? 'Lights out at 8pm',
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T00:00:00Z',
  };
}

function mountTab(notes: MemberNote[] = []) {
  setActivePinia(createPinia());
  const store = useMemberNotesStore();
  store.notes = notes;
  return mount(BeanNotesTab, {
    props: { memberId: MEMBER_ID },
    global: { stubs: { MemberNoteFormModal: true } },
  });
}

describe('BeanNotesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when the member has no notes', () => {
    const wrapper = mountTab([]);
    expect(wrapper.text()).toContain('memberNotes.empty');
    expect(wrapper.text()).toContain('memberNotes.emptyCTA');
  });

  it('renders a card per note plus the AddTile when populated', () => {
    const wrapper = mountTab([
      makeNote({ id: 'n1', title: 'Bedtime', body: 'Lights out at 8pm' }),
      makeNote({ id: 'n2', title: 'Favorite lovey', body: 'Blue bunny' }),
    ]);
    expect(wrapper.text()).toContain('Bedtime');
    expect(wrapper.text()).toContain('Lights out at 8pm');
    expect(wrapper.text()).toContain('Favorite lovey');
    expect(wrapper.text()).toContain('memberNotes.addTile');
  });

  it('filters out notes for other members', () => {
    const wrapper = mountTab([
      makeNote({ id: 'n1', title: 'Mine', memberId: MEMBER_ID }),
      makeNote({ id: 'n2', title: 'Sibling note', memberId: 'someone-else' }),
    ]);
    expect(wrapper.text()).toContain('Mine');
    expect(wrapper.text()).not.toContain('Sibling note');
  });
});
