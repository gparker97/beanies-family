import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ColorCircleSelector from '../ColorCircleSelector.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: FamilyMember) => ({ ariaLabel: m.name, initials: 'X' }),
  }),
}));

const member = (id: string, name: string, color: string) =>
  ({ id, name, color }) as unknown as FamilyMember;

const COLORS = [{ value: '#111' }, { value: '#222' }, { value: '#333' }];

function mountWith(modelValue: string, taken?: Map<string, FamilyMember>) {
  return mount(ColorCircleSelector, { props: { modelValue, colors: COLORS, taken } });
}

describe('ColorCircleSelector', () => {
  it('selects a free colour', async () => {
    const w = mountWith('#111');
    await w.findAll('button')[1]!.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['#222']);
  });

  it('disables a colour held by someone else and does NOT emit on click', async () => {
    // A swatch that merely looks dimmed but still fires is a silent failure wearing
    // a hover state — the whole point is that a colour identifies exactly one bean.
    const taken = new Map([['#222', member('m2', 'Mia', '#222')]]);
    const w = mountWith('#111', taken);
    const second = w.findAll('button')[1]!;
    expect(second.attributes('disabled')).toBeDefined();
    expect(second.attributes('aria-disabled')).toBe('true');
    await second.trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it("names the holder, so 'taken' explains itself without a sentence", () => {
    const taken = new Map([['#222', member('m2', 'Mia', '#222')]]);
    const w = mountWith('#111', taken);
    expect(w.findAll('button')[1]!.attributes('title')).toContain('family.colorTakenBy');
  });

  it("keeps a member's OWN colour selectable even when it collides", async () => {
    // Families created before uniqueness was enforced got random colours, so a bean
    // can already share one. If its own swatch read as taken, the form could never
    // be saved and the collision could never be corrected.
    const taken = new Map([['#111', member('m2', 'Mia', '#111')]]);
    const w = mountWith('#111', taken);
    const own = w.findAll('button')[0]!;
    expect(own.attributes('disabled')).toBeUndefined();
    await own.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['#111']);
  });

  it('leaves every swatch selectable when nothing is taken', () => {
    const w = mountWith('#111');
    expect(w.findAll('button').filter((b) => b.attributes('disabled') !== undefined)).toHaveLength(
      0
    );
  });
});
