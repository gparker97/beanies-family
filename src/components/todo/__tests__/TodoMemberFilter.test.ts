import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TodoMemberFilter from '../TodoMemberFilter.vue';
import type { FamilyMember } from '@/types/models';

// Passthrough translation so assertions are language-agnostic.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// MemberChip resolves members via useMemberInfo — stub it so the avatar renders.
const MEMBERS: Record<string, { name: string; color: string }> = {
  m1: { name: 'Ada', color: '#e76f51' },
  m2: { name: 'Ben', color: '#2a7fb5' },
};
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberById: (id: string) => MEMBERS[id] }),
}));

const members = [
  { id: 'm1', name: 'Ada', color: '#e76f51' },
  { id: 'm2', name: 'Ben', color: '#2a7fb5' },
] as unknown as FamilyMember[];

const mounted: VueWrapper[] = [];
function factory(modelValue = 'all') {
  const wrapper = mount(TodoMemberFilter, { props: { modelValue, members } });
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

describe('TodoMemberFilter', () => {
  it('renders an Everyone segment plus one per member', () => {
    const wrapper = factory('all');
    const buttons = wrapper.findAll('button');
    // Everyone + 2 members
    expect(buttons).toHaveLength(3);
    expect(wrapper.text()).toContain('todo.filterEveryone');
  });

  it('marks the active segment with aria-pressed', () => {
    const wrapper = factory('m1');
    const everyone = wrapper.findAll('button')[0]!;
    const adaBtn = wrapper.findAll('button')[1]!;
    expect(everyone.attributes('aria-pressed')).toBe('false');
    expect(adaBtn.attributes('aria-pressed')).toBe('true');
  });

  it('emits the member id when a member is picked', async () => {
    const wrapper = factory('all');
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['m1']);
  });

  it('toggles back to all when the active member is clicked again', async () => {
    const wrapper = factory('m1');
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['all']);
  });

  it('emits all when Everyone is clicked', async () => {
    const wrapper = factory('m1');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['all']);
  });
});
