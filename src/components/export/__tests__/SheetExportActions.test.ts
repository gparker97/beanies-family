/**
 * SheetExportActions: the fridge sheet's Share + Export as PDF pair (Meal Planner, Who Owns
 * What). The phone rule is CSS (`md:`), so this pins the markup that carries it: Share keeps
 * its name as an icon, Export hides below md, a building Share shows a visible ring spinner
 * and says so, the building button is `aria-busy`, and each button emits its format.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SheetExportActions from '../SheetExportActions.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mountActions = (props: Record<string, unknown> = {}) =>
  mount(SheetExportActions, {
    props: { exportingFormat: null, shareLabel: 'Share the Deck', testid: 'deck', ...props },
    global: { stubs: { BeanieIcon: true } },
  });

describe('SheetExportActions', () => {
  it('Share is named at every width; its label and Export show from md up', () => {
    const w = mountActions();
    const share = w.find('[data-testid="deck-share"]');
    expect(share.attributes('aria-label')).toBe('Share the Deck');
    expect(share.find('span').classes()).toEqual(expect.arrayContaining(['hidden', 'md:inline']));
    expect(share.attributes('aria-busy')).toBeUndefined();
    const exp = w.find('[data-testid="deck-export"]');
    expect(exp.classes()).toEqual(expect.arrayContaining(['hidden', 'md:inline-flex']));
    expect(exp.text()).toBe('sheetExport.exportPdf');
  });

  it('emits run with each format', async () => {
    const w = mountActions();
    await w.find('[data-testid="deck-share"]').trigger('click');
    await w.find('[data-testid="deck-export"]').trigger('click');
    expect(w.emitted('run')).toEqual([['image'], ['pdf']]);
  });

  it('while Share builds: a spinner (never an empty circle), the building name, aria-busy', () => {
    const w = mountActions({ exportingFormat: 'image' });
    const share = w.find('[data-testid="deck-share"]');
    // A white ring (a <span>, valid inside a button), hidden from AT; the name says it.
    const ring = share.find('span.animate-spin');
    expect(ring.exists()).toBe(true);
    expect(ring.attributes('aria-hidden')).toBe('true');
    expect(ring.classes()).toEqual(
      expect.arrayContaining([
        'border-white',
        'border-t-transparent',
        'motion-reduce:animate-pulse',
      ])
    );
    expect(share.attributes('aria-label')).toBe('sheetExport.building');
    expect(share.attributes('aria-busy')).toBe('true');
    expect(share.attributes('disabled')).toBeDefined();
    const exp = w.find('[data-testid="deck-export"]');
    expect(exp.attributes('disabled')).toBeDefined();
    expect(exp.attributes('aria-busy')).toBeUndefined();
  });

  it('while the PDF builds: Export says so and is aria-busy, Share is disabled but not busy', () => {
    const w = mountActions({ exportingFormat: 'pdf' });
    const share = w.find('[data-testid="deck-share"]');
    expect(share.attributes('disabled')).toBeDefined();
    expect(share.attributes('aria-busy')).toBeUndefined();
    expect(share.find('.animate-spin').exists()).toBe(false);
    const exp = w.find('[data-testid="deck-export"]');
    expect(exp.text()).toBe('sheetExport.building');
    expect(exp.attributes('aria-busy')).toBe('true');
    expect(exp.attributes('disabled')).toBeDefined();
  });

  it('no testid prefix, no test ids', () => {
    const w = mountActions({ testid: undefined });
    expect(w.find('[data-testid]').exists()).toBe(false);
  });
});
