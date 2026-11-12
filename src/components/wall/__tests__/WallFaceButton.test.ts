/**
 * WallFaceButton: a face that opens the family scrapbook when the viewer is on, and stays the
 * plain picture it always was when it is off or there is no wall around it.
 */
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import WallFaceButton from '../WallFaceButton.vue';
import { WALL_MEMORIES } from '../wallMemoriesKey';
import type { WallMemoriesContext } from '@/composables/useWallMemories';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'wall.memories.openFor' ? '{name}: open' : key),
  }),
}));

function context(enabled: boolean) {
  const open = vi.fn();
  const on = ref(enabled);
  const ctx = { enabled: computed(() => on.value), open } as unknown as WallMemoriesContext;
  return { ctx, open };
}

function mountFace(provide?: WallMemoriesContext) {
  return mount(WallFaceButton, {
    props: { name: 'Leo', source: 'face-chore' },
    attrs: { class: 'flex items-center gap-2' },
    slots: { default: '<i class="face">L</i>' },
    global: provide ? { provide: { [WALL_MEMORIES as symbol]: provide } } : {},
  });
}

describe('WallFaceButton', () => {
  it('with the viewer on: a real button, labelled with the bean, that opens the scrapbook', async () => {
    const { ctx, open } = context(true);
    const w = mountFace(ctx);
    const button = w.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe('Leo: open');
    expect(button.attributes('aria-haspopup')).toBe('dialog');
    expect(button.attributes('type')).toBe('button');
    // The caller's layout classes land on the button, and the face is inside it, unchanged.
    expect(button.classes()).toEqual(expect.arrayContaining(['flex', 'items-center', 'gap-2']));
    expect(button.find('i.face').exists()).toBe(true);

    await button.trigger('click');
    expect(open).toHaveBeenCalledWith('face-chore', button.element);
  });

  it('with the viewer off: the plain element, nothing to press', () => {
    const { ctx, open } = context(false);
    const w = mountFace(ctx);
    expect(w.find('button').exists()).toBe(false);
    const span = w.find('span');
    expect(span.classes()).toEqual(expect.arrayContaining(['flex', 'items-center', 'gap-2']));
    expect(span.attributes('aria-label')).toBeUndefined();
    expect(span.find('i.face').exists()).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('outside a wall (no provider): the plain element', () => {
    const w = mountFace();
    expect(w.find('button').exists()).toBe(false);
    expect(w.find('i.face').exists()).toBe(true);
  });
});
