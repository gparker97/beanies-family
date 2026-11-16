/**
 * Stars and rewards (#148): the child-facing bonus / take-away note, read in real English. A
 * take-away says who took how many away, then the grown-up's own reason in quotes and the way
 * forward; never "lost", "penalty" or "minus", never red, never a tally of what is gone.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', async () => {
  const { computed } = await import('vue');
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  const strings = UI_STRINGS as Record<string, string>;
  return {
    useTranslation: () => ({
      t: (k: string) => strings[k] ?? k,
      currentLanguage: computed(() => 'en'),
    }),
  };
});

import StarNote from '../StarNote.vue';

const note = (stars: number, text?: string, byName = 'Papa') =>
  mount(StarNote, { props: { gift: { stars, note: text }, byName } });

describe('StarNote', () => {
  it('a bonus: who gave how many, and their note in quotes', () => {
    const w = note(2, 'Helped Juno with her shoes');
    expect(w.attributes('data-kind')).toBe('bonus');
    expect(w.text()).toBe('🌟Papa gave you 2 bonus stars! "Helped Juno with her shoes"');
  });

  it('a bonus with no note, and one star', () => {
    expect(note(1).text()).toBe('🌟Papa gave you 1 bonus star!');
  });

  it('a take-away: who took how many away, the reason in quotes, the way forward', () => {
    const w = note(-1, 'Bike left out in the rain');
    expect(w.attributes('data-kind')).toBe('take');
    expect(w.text()).toBe(
      '↩Papa took away 1 star. "Bike left out in the rain." Your next chore wins it right back.'
    );
    expect(note(-3, 'Too late').text()).toContain('Papa took away 3 stars.');
    expect(w.text()).not.toMatch(/moved back|says:/i);
    // A reason that already ends a sentence keeps its own punctuation.
    expect(note(-1, 'Shoes on the couch!').text()).toContain('"Shoes on the couch!" Your');
    expect(note(-3, 'Too late').text()).toContain('Your next chores win them right back.');
  });

  it('never shaming: no "lost", "penalty", "minus", no red, no tally', () => {
    for (const w of [note(-2, 'Bike'), note(2, 'Nice')]) {
      expect(w.text().toLowerCase()).not.toMatch(/lost|penalty|minus|-\d/);
      expect(w.html()).not.toMatch(/red-|danger/);
    }
  });

  it('a grown-up who has left the family reads as "A grown-up"', () => {
    expect(note(2, undefined, '').text()).toContain('A grown-up gave you 2 bonus stars!');
  });
});
