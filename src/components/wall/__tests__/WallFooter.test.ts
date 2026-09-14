/**
 * The wall's person filter, which is now a SET rather than one bean.
 *
 * These cases pin the two things that made multi-select safe on a shared screen, because both
 * are easy to lose in a refactor and neither fails loudly: every focused bean is a lit chip, and
 * there is no way to reach a filter that matches nobody.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import WallFooter from '../WallFooter.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

const members: FamilyMember[] = [
  { id: 'm1', name: 'Leo' } as FamilyMember,
  { id: 'm2', name: 'Mia' } as FamilyMember,
  { id: 'm3', name: 'Ana' } as FamilyMember,
];

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ sortedHumans: members }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

function mountFooter(focused: readonly string[]) {
  return mount(WallFooter, {
    props: { focused },
    global: { stubs: { BeanieAvatar: true } },
  });
}

/** The chips, in render order: "everyone" first, then one per bean. */
const chips = (w: ReturnType<typeof mountFooter>) => w.findAll('button');
const pressed = (w: ReturnType<typeof mountFooter>) =>
  chips(w)
    .filter((b) => b.attributes('aria-pressed') === 'true')
    .map((b) => b.text().trim());

describe('what the wall says it is showing', () => {
  it('lights ONLY "everyone" when nothing is focused', () => {
    const w = mountFooter([]);
    expect(pressed(w)).toEqual(['wall.filter.everyone']);
  });

  it('lights EVERY focused bean, so the state is legible from across the room', () => {
    // The whole reason multi-select is acceptable on an unattended screen: a half-filtered wall
    // announces itself. A checkbox set behind a menu would not.
    const w = mountFooter(['m1', 'm3']);
    expect(pressed(w)).toEqual(['Leo', 'Ana']);
  });

  it('stops lighting "everyone" as soon as anyone is focused', () => {
    // Both lit at once would read as "everything is filtered" rather than "no filter".
    expect(pressed(mountFooter(['m2']))).not.toContain('wall.filter.everyone');
  });
});

describe('what a tap asks for', () => {
  it('asks to toggle the bean, focused or not — the page owns the semantics', async () => {
    const w = mountFooter(['m1']);
    await chips(w)[1]!.trigger('click'); // Leo, already focused
    await chips(w)[2]!.trigger('click'); // Mia, not focused

    // Deliberately NOT "select m1" / "deselect m1": one event, and the page decides. A footer
    // that computed the next set would be a second place the min-selection rule lives.
    expect(w.emitted('select')).toEqual([['m1'], ['m2']]);
  });

  it('asks to clear, not to select nobody', async () => {
    // `clear` is its own event so "everyone" can never be expressed as an empty selection that
    // some other code path mistakes for "a filter matching nobody".
    const w = mountFooter(['m1', 'm2']);
    await chips(w)[0]!.trigger('click');

    expect(w.emitted('clear')).toHaveLength(1);
    expect(w.emitted('select')).toBeUndefined();
  });
});
