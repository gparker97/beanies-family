import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MemberGroupCard from '../MemberGroupCard.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: FamilyMember) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));

const leo = { id: 'm-leo', name: 'Leo', color: '#3b82f6' } as unknown as FamilyMember;

describe('MemberGroupCard', () => {
  it('renders the avatar, name, caption and slot content', () => {
    const w = mount(MemberGroupCard, {
      props: { member: leo, caption: '2 repeating to-dos' },
      slots: { default: '<ul data-testid="slot"><li>Trash night</li></ul>' },
    });
    expect(w.findComponent({ name: 'BeanieAvatar' }).exists()).toBe(true);
    expect(w.text()).toContain('Leo');
    expect(w.text()).toContain('2 repeating to-dos');
    expect(w.get('[data-testid="slot"]').text()).toBe('Trash night');
  });

  it('omits the caption line when there is none, and carries its dark surface', () => {
    const w = mount(MemberGroupCard, { props: { member: leo } });
    expect(w.findAll('p')).toHaveLength(1);
    expect(w.get('[data-testid="member-group-card"]').classes()).toEqual(
      expect.arrayContaining(['dark:bg-surface-raised', 'dark:border-line'])
    );
  });

  it('without a member, shows the given name and no face', () => {
    const w = mount(MemberGroupCard, { props: { name: 'Unassigned', caption: '1 reminder' } });
    expect(w.findComponent({ name: 'BeanieAvatar' }).exists()).toBe(false);
    expect(w.text()).toContain('Unassigned');
  });
});
