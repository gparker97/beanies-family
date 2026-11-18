/**
 * The shared bonus / take-away row (#154): the words, the signed amount in its colour (a
 * take-away in neutral ink, never red), the caller's attributes on the root `<li>`, and the two
 * slots the Star Report's bonus summary uses.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StarGiftRow from '../StarGiftRow.vue';
import type { BonusEntryLine } from '../starText';
import type { ChoreStarGift } from '@/types/models';

const line = (over: Partial<BonusEntryLine> = {}): BonusEntryLine => ({
  gift: { id: 'g1' } as ChoreStarGift,
  take: false,
  title: 'Mom gave 2 bonus stars',
  amount: '+2',
  sub: 'Tue. "Helped Grandma"',
  ...over,
});

describe('StarGiftRow', () => {
  it('draws the words and the amount; the caller’s attributes land on the root li', () => {
    const w = mount(StarGiftRow, {
      props: { entry: line(), amountTestid: 'amt' },
      attrs: { class: 'tile', 'data-testid': 'row', 'data-kind': 'bonus' },
    });
    const li = w.get('li');
    expect(li.classes()).toContain('tile');
    expect(li.attributes('data-testid')).toBe('row');
    expect(li.attributes('data-kind')).toBe('bonus');
    expect(w.text()).toContain('Mom gave 2 bonus stars');
    expect(w.text()).toContain('Tue. "Helped Grandma"');
    const amount = w.get('[data-testid="amt"]');
    expect(amount.text()).toBe('+2');
    expect(amount.classes()).toContain('text-green-700');
    expect(amount.classes()).toContain('dark:text-success-lift');
    expect(amount.attributes('aria-hidden')).toBeUndefined();
  });

  it('a take-away is neutral ink; the amount can be left out of the spoken row', () => {
    const w = mount(StarGiftRow, {
      props: {
        entry: line({ take: true, amount: '-1', sub: '' }),
        amountTestid: 'amt',
        amountHidden: true,
      },
    });
    const amount = w.get('[data-testid="amt"]');
    expect(amount.classes()).toContain('text-secondary-500');
    expect(amount.classes()).not.toContain('text-green-700');
    expect(amount.attributes('aria-hidden')).toBe('true');
  });

  it('a glyph before the words and an action after the amount, through the slots', () => {
    const w = mount(StarGiftRow, {
      props: { entry: line() },
      slots: { leading: '<i class="lead">*</i>', trailing: '<button class="act">x</button>' },
    });
    const kids = w.get('li').element.children;
    expect(kids[0]!.className).toBe('lead');
    expect(kids[kids.length - 1]!.className).toBe('act');
  });

  it('lg (the wall) scales the title, the note and the amount; md stays the default', () => {
    const md = mount(StarGiftRow, { props: { entry: line(), amountTestid: 'amt' } });
    expect(md.get('[data-testid="amt"]').classes()).toContain('text-sm');
    const lg = mount(StarGiftRow, { props: { entry: line(), amountTestid: 'amt', size: 'lg' } });
    expect(lg.get('[data-testid="amt"]').classes()).toContain('text-xl');
    expect(lg.get('[data-testid="amt"]').classes()).toContain('text-green-700');
    const [title, sub] = lg.findAll('span.block');
    expect(title.classes()).toContain('text-xl');
    expect(sub.classes()).toContain('text-base');
    expect(sub.text()).toBe('Tue. "Helped Grandma"');
  });
});
