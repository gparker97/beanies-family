import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LinkedItemLink from '../LinkedItemLink.vue';

const base = { icon: '🗑️', title: 'Trash Night', ariaLabel: 'Open the card' };

describe('LinkedItemLink', () => {
  it('chip: renders icon, "title, sub", the aria label and the dark-mode tokens', () => {
    const w = mount(LinkedItemLink, { props: { ...base, sub: 'for Leo' } });
    const chip = w.get('[data-testid="linked-item-chip"]');
    expect(chip.text()).toContain('🗑️');
    expect(chip.text()).toContain('Trash Night, for Leo');
    expect(chip.attributes('aria-label')).toBe('Open the card');
    expect(chip.attributes('title')).toBe('Trash Night');
    expect(chip.classes()).toContain('dark:text-ink');
    expect(w.get('svg').classes()).toContain('dark:text-accent-lift');
  });

  it('chip: omits the comma when there is no sub', () => {
    const w = mount(LinkedItemLink, { props: base });
    expect(w.text()).not.toContain(',');
  });

  it('row: renders title and sub on separate lines with dark partners', () => {
    const w = mount(LinkedItemLink, { props: { ...base, sub: 'Wed 8pm', variant: 'row' } });
    expect(w.find('[data-testid="linked-item-chip"]').exists()).toBe(false);
    const row = w.get('[data-testid="linked-item-row"]');
    expect(row.classes()).toEqual(
      expect.arrayContaining(['dark:bg-surface-overlay', 'dark:border-line'])
    );
    const lines = row.findAll('span.block');
    expect(lines.map((l) => l.text())).toEqual(['Trash Night', 'Wed 8pm']);
    expect(lines[1]!.classes()).toContain('dark:text-ink-soft');
  });

  it('emits click and does not let it bubble to a clickable parent', async () => {
    let parentClicks = 0;
    const host = mount({
      components: { LinkedItemLink },
      data: () => ({ base }),
      methods: { onParent: () => parentClicks++ },
      template: '<div @click="onParent"><LinkedItemLink v-bind="base" variant="row" /></div>',
    });
    await host.get('button').trigger('click');
    expect(host.findComponent(LinkedItemLink).emitted('click')).toHaveLength(1);
    expect(parentClicks).toBe(0);
  });
});
