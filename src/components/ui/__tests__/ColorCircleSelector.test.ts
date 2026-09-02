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

  it('disables a colour held by someone else', () => {
    const taken = new Map([['#222', member('m2', 'Mia', '#222')]]);
    const w = mountWith('#111', taken);
    const second = w.findAll('button')[1]!;
    expect(second.attributes('disabled')).toBeDefined();
    expect(second.attributes('aria-disabled')).toBe('true');
  });

  it('refuses a taken colour in the HANDLER, not just via the disabled attribute', async () => {
    // Calling the handler directly, because `trigger('click')` proves nothing here:
    // @vue/test-utils no-ops it on a disabled BUTTON (`vue-test-utils.cjs.js:7215`),
    // so the previous version of this test was satisfied by the library rather than by
    // the component — and would have stayed green if the guard were only an attribute.
    // Swapping `disabled` for `aria-disabled` (to keep the swatch focusable and its
    // tooltip readable) would then have silently re-opened duplicate assignment.
    const taken = new Map([['#222', member('m2', 'Mia', '#222')]]);
    const w = mountWith('#111', taken);
    (w.vm as unknown as { select: (v: string) => void }).select?.('#222');
    await w.vm.$nextTick();
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('keeps the holder badges visible when the palette is exhausted and unlocks', async () => {
    // The escape hatch used to strip BOTH signals: `isTaken()` returned false for every
    // swatch, which unlocked the palette AND removed every holder badge, while the
    // notice only ever fired on the create path. A family holding all six hues editing
    // a legacy bean saw a completely ordinary picker and created a duplicate blind.
    const taken = new Map([
      ['#111', member('m1', 'Ann', '#111')],
      ['#222', member('m2', 'Mia', '#222')],
      ['#333', member('m3', 'Bo', '#333')],
    ]);
    const w = mountWith('#999', taken);
    expect(w.findAll('button').filter((b) => b.attributes('disabled') !== undefined)).toHaveLength(
      0
    );
    expect(w.findAllComponents({ name: 'BeanieAvatar' }).length).toBe(3);
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
