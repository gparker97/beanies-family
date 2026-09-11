import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BirthdayChip from '../BirthdayChip.vue';
import { useTranslationStore } from '@/stores/translationStore';
import type { BirthdayOccurrence } from '@/utils/birthdays';

function birthday(over: Partial<BirthdayOccurrence> = {}): BirthdayOccurrence {
  return {
    date: '2026-09-15',
    memberId: 'm-joey',
    name: 'Joey',
    age: 7,
    isPet: false,
    ...over,
  };
}

describe('BirthdayChip', () => {
  beforeEach(() => {
    // The chip resolves its label through the translation store, which defaults
    // to beanie mode. The tests below assert the ENGLISH values, so turn it off
    // and let the one beanie test opt back in.
    setActivePinia(createPinia());
    useTranslationStore().setBeanieMode(false);
  });

  it("reads 'Joey's 7th birthday'", () => {
    const w = mount(BirthdayChip, { props: { birthday: birthday() } });
    expect(w.text()).toContain("Joey's 7th birthday");
  });

  it('drops the age when the birth year is unknown, rather than printing nothing sensible', () => {
    const w = mount(BirthdayChip, { props: { birthday: birthday({ age: undefined }) } });
    expect(w.text()).toContain("Joey's birthday");
    expect(w.text()).not.toMatch(/undefined|NaN/);
  });

  it('gets the ordinal right for the teens, where naive suffixing fails', () => {
    // 11th/12th/13th, not 11st/12nd/13rd.
    for (const [age, expected] of [
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [21, '21st'],
      [1, '1st'],
    ] as const) {
      const w = mount(BirthdayChip, { props: { birthday: birthday({ age }) } });
      expect(w.text()).toContain(`Joey's ${expected} birthday`);
    }
  });

  it('carries the cake and its own testid, so it is distinguishable from a holiday', () => {
    const w = mount(BirthdayChip, { props: { birthday: birthday() } });
    expect(w.text()).toContain('🎂');
    expect(w.find('[data-testid="birthday-chip"]').exists()).toBe(true);
  });

  it('uses the contrast-safe token, NOT the raw Heritage Orange', () => {
    // #F15D22 measures 3.32:1 on a white month cell, which fails AA for a 12px
    // chip. If someone "simplifies" this to the birthday category's colour, this
    // is the test that says why not. Asserted on the STYLE, not the whole html —
    // the component's own comment names the hex it is avoiding.
    const style = mount(BirthdayChip, { props: { birthday: birthday() } })
      .find('[data-testid="birthday-chip"]')
      .attributes('style');
    expect(style).toContain('var(--birthday-orange)');
    expect(style).not.toContain('#F15D22');
  });

  it('keeps the real noun in beanie mode — a bean day is still a birthday', () => {
    // Cosmetic copy, so the playful overlay is allowed here: nobody can act
    // wrongly on a calendar label. The NAME and the age still have to survive it.
    useTranslationStore().setBeanieMode(true);
    const w = mount(BirthdayChip, { props: { birthday: birthday() } });
    expect(w.text()).toContain("Joey's 7th");
  });
});
