/**
 * InlineMemberPicker's `memberTarget`: the ONE lookup a host's landing effects use, so the
 * flight target (the tile) and the bounce target (its avatar) can never drift apart.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useMemberAvatar', () => ({
  getMemberAvatarVariant: () => 'adult-other',
  getMemberAvatarUrl: () => null,
}));

import InlineMemberPicker from '../InlineMemberPicker.vue';

const members = [
  { id: 'greg', name: 'greg', color: '#000' },
  { id: 'sofia', name: 'Sofia', color: '#111' },
] as FamilyMember[];

describe('InlineMemberPicker memberTarget', () => {
  it("returns the member's tile and the avatar inside it; null for someone not offered", () => {
    const w = mount(InlineMemberPicker, {
      props: { members, title: 't', backLabel: 'b', emptyMessage: 'e', tileTestidPrefix: 'p-' },
      global: { stubs: { BeanieAvatar: { template: '<span v-bind="$attrs" />' } } },
    });
    const vm = w.vm as unknown as {
      memberTarget: (id: string) => { tile: HTMLElement; face: HTMLElement | null } | null;
    };
    const target = vm.memberTarget('sofia')!;
    expect(target.tile).toBe(w.find('[data-testid="p-sofia"]').element);
    expect(target.face?.dataset.face).toBe('sofia');
    expect(target.tile.contains(target.face)).toBe(true);
    expect(vm.memberTarget('leo')).toBeNull();
  });
});
