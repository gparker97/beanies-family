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

function mountButton(provide?: WallMemoriesContext) {
  return mount(WallScrapbookButton, {
    global: provide ? { provide: { [WALL_MEMORIES as symbol]: provide } } : {},
  });
}

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
});
