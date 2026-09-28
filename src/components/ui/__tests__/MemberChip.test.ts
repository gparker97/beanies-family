import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MemberChip from '../MemberChip.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MEMBERS: FamilyMember[] = [
  // @ts-expect-error — partial fixture sufficient for chip rendering
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', isPet: false },
  // @ts-expect-error — partial fixture
  { id: 'm-aria', name: 'Aria', color: '#6AA84F', isPet: false },
];

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string | null | undefined) =>
      id ? MEMBERS.find((m) => m.id === id) : undefined,
    getMemberName: (id: string | null | undefined, fallback = 'Unknown') =>
      id ? (MEMBERS.find((m) => m.id === id)?.name ?? fallback) : fallback,
    getMemberColor: (id: string | null | undefined, fallback = '#6b7280') =>
      id ? (MEMBERS.find((m) => m.id === id)?.color ?? fallback) : fallback,
  }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MemberChip', () => {
  it('renders the member name pill when the ID resolves', () => {
    const wrapper = mount(MemberChip, { props: { memberId: 'm-greg' } });
    expect(wrapper.text()).toContain('Greg');
  });

  it('renders an initial dot when size="dot" and the ID resolves', () => {
    const wrapper = mount(MemberChip, { props: { memberId: 'm-aria', size: 'dot' } });
    expect(wrapper.text()).toBe('A');
  });

  it('renders NOTHING for an unresolved (deleted) member ID', () => {
    // The "deleted member shows up as Unknown" bug: an orphan ID in an
    // activity's assigneeIds used to render a stale "Unknown" gray pill.
    // The chip now silently skips orphans so every consumer that loops
    // assigneeIds transparently drops orphaned entries.
    const wrapper = mount(MemberChip, { props: { memberId: 'm-deleted-bean' } });
    expect(wrapper.text()).toBe('');
    expect(wrapper.find('span').exists()).toBe(false);
  });

  it('renders NOTHING for an empty memberId string', () => {
    const wrapper = mount(MemberChip, { props: { memberId: '' } });
    expect(wrapper.find('span').exists()).toBe(false);
  });
});

describe('MemberChip attribute fallthrough', () => {
  it("a caller's class reaches the chip (dot and pill), with no fragment warning", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const size of ['dot', 'sm'] as const) {
      const w = mount(MemberChip, {
        props: { memberId: 'm-greg', size },
        attrs: { class: 'shrink-0' },
      });
      expect(w.classes()).toContain('shrink-0');
      w.unmount();
    }
    const extraneous = warn.mock.calls.filter((c) => String(c[0]).includes('Extraneous non-props'));
    expect(extraneous).toHaveLength(0);
    warn.mockRestore();
  });
});
