import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ActivityOwnerStack from '../ActivityOwnerStack.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: FamilyMember) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));

const m = (id: string, name: string) => ({ id, name, color: '#3b82f6' }) as unknown as FamilyMember;
const stack = (members: FamilyMember[], max?: number) =>
  mount(ActivityOwnerStack, { props: { members, ...(max ? { max } : {}) } });

describe('ActivityOwnerStack', () => {
  it('renders nothing at all for an empty set', () => {
    // A solo card in a bean lane passes []. It must render no wrapper, not an empty
    // one, or every such card pays for a stray flex child.
    expect(stack([]).find('[role="img"]').exists()).toBe(false);
  });

  it('renders one face per member below the cap', () => {
    expect(
      stack([m('1', 'Max'), m('2', 'Leo')]).findAllComponents({ name: 'BeanieAvatar' })
    ).toHaveLength(2);
  });

  it('caps at three and shows the remainder as +n', () => {
    // The cap is what keeps the reserved width bounded — without it a family of eight
    // pushes a card's title into a two-word column, which is the whole reason the
    // stack is right-anchored in the first place.
    const w = stack(['a', 'b', 'c', 'd', 'e'].map((x, i) => m(String(i), x)));
    expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(3);
    expect(w.text()).toContain('+2');
  });

  it('shows no +n when the count exactly equals the cap', () => {
    const w = stack([m('1', 'A'), m('2', 'B'), m('3', 'C')]);
    expect(w.text()).not.toContain('+');
  });

  it('collapses to ONE face plus a count in dense mode', () => {
    // The title is the only thing a reader cannot recover by tapping — the faces are
    // one tap away, a truncated title is not. On a month cell four pills ate about half
    // the row, so dense trades three faces for one plus a count and gives the width back.
    const w = mount(ActivityOwnerStack, {
      props: { members: ['a', 'b', 'c', 'd'].map((x, i) => m(String(i), x)), dense: true },
    });
    expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(1);
    expect(w.text()).toContain('+3');
  });

  it('still shows a lone owner as a face, not as +1, when dense', () => {
    const w = mount(ActivityOwnerStack, { props: { members: [m('1', 'Max')], dense: true } });
    expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(1);
    expect(w.text()).not.toContain('+');
  });

  it('honours a custom cap', () => {
    const w = stack([m('1', 'A'), m('2', 'B'), m('3', 'C')], 1);
    expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(1);
    expect(w.text()).toContain('+2');
  });

  it('names everyone once for a screen reader and hides the faces', () => {
    // Reading eight names between the title and the time is worse than reading none,
    // so the faces are decorative and the group carries a single label.
    const w = stack([m('1', 'Max'), m('2', 'Leo')]);
    expect(w.find('[role="img"]').attributes('aria-label')).toBe('Max, Leo');
    expect(w.findAllComponents({ name: 'BeanieAvatar' })[0]!.attributes('aria-hidden')).toBe(
      'true'
    );
  });

  describe('2xs (the month grid chip size, #141)', () => {
    const tiny = (members: FamilyMember[], max?: number) =>
      mount(ActivityOwnerStack, { props: { members, size: '2xs', ...(max ? { max } : {}) } });
    const four = ['a', 'b', 'c', 'd'].map((x, i) => m(String(i), x));

    it('draws the 14px face size with a thin ring and a tight overlap', () => {
      const faces = tiny([m('1', 'A'), m('2', 'B')]).findAllComponents({ name: 'BeanieAvatar' });
      expect(faces).toHaveLength(2);
      expect(faces[0]!.props('size')).toBe('2xs');
      for (const f of faces)
        expect(f.classes()).toEqual(expect.arrayContaining(['ring-1', '-ml-1']));
      expect(faces[0]!.classes()).not.toContain('ring-2');
    });

    it('draws the overflow as plain +N text, never a circle', () => {
      const w = tiny(four, 2);
      expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(2);
      const overflow = w.findAll('span[aria-hidden="true"]').find((s) => s.text() === '+2');
      expect(overflow).toBeDefined();
      expect(overflow!.classes()).toEqual(expect.arrayContaining(['text-xs', 'font-semibold']));
      expect(overflow!.classes()).not.toContain('rounded-full');
    });

    it('shows no +N when everyone fits', () => {
      expect(tiny([m('1', 'A')]).text()).not.toContain('+');
    });

    it('leaves the other sizes unchanged (ring-2, -ml-1.5, a circle overflow)', () => {
      const w = mount(ActivityOwnerStack, {
        props: { members: four, size: 'xs', max: 2 },
      });
      const face = w.findAllComponents({ name: 'BeanieAvatar' })[0]!;
      expect(face.classes()).toEqual(expect.arrayContaining(['ring-2', '-ml-1.5']));
      const circle = w.findAll('span').find((s) => s.text() === '+2');
      expect(circle!.classes()).toContain('rounded-full');
    });
  });

  it('imports no store', async () => {
    // Classification must happen once per activity, not once per face — a stack that
    // resolved its own members would re-derive the owner set on every avatar render
    // and could disagree with the wash its parent computed from the same activity.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/ui/ActivityOwnerStack.vue', 'utf8')
    );
    expect(src).not.toMatch(/from\s+['"]@\/stores\//);
  });
});
