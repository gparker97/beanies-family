/**
 * WallScrapbookButton: the footer's picture button into the family scrapbook. Present only on
 * a wall with the viewer on; a tap opens it through the one `open`, naming its own door.
 */
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import WallScrapbookButton from '../WallScrapbookButton.vue';
import { WALL_MEMORIES } from '../wallMemoriesKey';
import type { WallMemoriesContext } from '@/composables/useWallMemories';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function context(enabled: boolean) {
  const open = vi.fn();
  const on = ref(enabled);
  const ctx = { enabled: computed(() => on.value), open } as unknown as WallMemoriesContext;
  return { ctx, open };
}

function mountButton(provide?: WallMemoriesContext, slot?: string) {
  return mount(WallScrapbookButton, {
    slots: slot ? { default: slot } : {},
    global: provide ? { provide: { [WALL_MEMORIES as symbol]: provide } } : {},
  });
}

const WORDMARK = '<span class="brand">beanies.family</span>';

describe('WallScrapbookButton', () => {
  it('renders nothing outside a wall (no provider)', () => {
    expect(mountButton().find('button').exists()).toBe(false);
  });

  it('renders nothing with the viewer switched off', () => {
    const { ctx } = context(false);
    expect(mountButton(ctx).find('button').exists()).toBe(false);
  });

  it('with the viewer on: a labelled picture button that opens the scrapbook', async () => {
    const { ctx, open } = context(true);
    const button = mountButton(ctx).find('button');

    expect(button.exists()).toBe(true);
    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-label')).toBe('wall.memories.open');
    expect(button.attributes('title')).toBe('wall.memories.open');
    expect(button.attributes('aria-haspopup')).toBe('dialog');
    // A picture, no word: the label is the only name, and the drawing is hidden.
    expect(button.text()).toBe('');
    expect(button.find('svg').attributes('aria-hidden')).toBe('true');

    await button.trigger('click');
    expect(open).toHaveBeenCalledWith('footer-button', button.element);
  });

  it('one door: the slot (the wordmark) is inside the same button, the name is unchanged', async () => {
    const { ctx, open } = context(true);
    const button = mountButton(ctx, WORDMARK).find('button');

    expect(button.find('.brand').exists()).toBe(true);
    // The circle is an inner span, so the slot sits beside it, not inside the 2.5rem disc.
    const icon = button.find('[data-test="wall-scrapbook-icon"]');
    expect(icon.classes()).toEqual(expect.arrayContaining(['h-10', 'w-10', 'rounded-full']));
    expect(icon.find('.brand').exists()).toBe(false);
    expect(button.classes()).toContain('inline-flex');
    expect(button.attributes('aria-label')).toBe('wall.memories.open');

    await button.find('.brand').trigger('click');
    expect(open).toHaveBeenCalledWith('footer-button', button.element);
  });

  it('with the viewer off or outside a wall: the slot stands plain, with no button', () => {
    const { ctx } = context(false);
    for (const w of [mountButton(ctx, WORDMARK), mountButton(undefined, WORDMARK)]) {
      expect(w.find('button').exists()).toBe(false);
      expect(w.find('.brand').exists()).toBe(true);
    }
  });
});
