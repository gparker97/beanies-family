/**
 * The job row, locked and unlocked.
 *
 * The row's root had to stop being a `<button>` for this feature: an `<input>`
 * and a trash `<button>` cannot be nested inside one. That restructure is the
 * riskiest part of the change, because the thing it could quietly break is the
 * one thing a five-year-old uses. Hence the "locked" block below, which pins
 * tap-anywhere-to-tick on every element of the row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { __resetEscapeCloseForTests } from '@/composables/useEscapeClose';
import WallJobRow from '../WallJobRow.vue';
import ActionButtons from '@/components/ui/ActionButtons.vue';
import { WALL_LOCK } from '../wallLockKey';
import { WALL_EDIT, type WallEditContext } from '../wallEditKey';
import type { WallJob } from '@/types/wall';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const job: WallJob = {
  key: 'list:l1:i1',
  title: 'goggles',
  done: false,
  ownerId: 'm1',
  source: 'list',
  listId: 'l1',
  itemId: 'i1',
  listEmoji: '🏊',
};

function mountRow(
  opts: { unlocked?: boolean; edit?: Partial<WallEditContext>; job?: WallJob } = {}
) {
  const writers: WallEditContext = {
    addListItem: vi.fn().mockResolvedValue(true),
    addTodo: vi.fn().mockResolvedValue(true),
    renameJob: vi.fn().mockResolvedValue(true),
    removeJob: vi.fn().mockResolvedValue(true),
    ...opts.edit,
  };
  const wrapper = mount(WallJobRow, {
    props: { job: opts.job ?? job, pending: false, ownerLabel: 'Leo' },
    global: {
      provide: {
        [WALL_LOCK as symbol]: { isLocked: ref(!opts.unlocked), noteActivity: vi.fn() },
        ...(opts.unlocked ? { [WALL_EDIT as symbol]: writers } : {}),
      },
    },
  });
  return { wrapper, writers };
}

describe('WallJobRow', () => {
  beforeEach(() => __resetEscapeCloseForTests());

  describe('locked: the tick is the whole row, exactly as before', () => {
    it('ticks when the tick itself is tapped', async () => {
      const { wrapper } = mountRow();
      await wrapper.get('button[aria-pressed]').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('ticks when the TITLE is tapped', async () => {
      const { wrapper } = mountRow();
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('ticks when the owner pill is tapped, because it sits inside the title button', async () => {
      const { wrapper } = mountRow();
      await wrapper.get('.wall-job-done-at').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('ticks when the list emoji is tapped', async () => {
      const { wrapper } = mountRow();
      await wrapper.get('.wall-job-tag').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('offers no trash and no rename', () => {
      const { wrapper } = mountRow();
      expect(wrapper.findComponent(ActionButtons).exists()).toBe(false);
      expect(wrapper.find('input').exists()).toBe(false);
    });
  });

  describe('the tick survives the restructure', () => {
    it('keeps the wall-tick span, its classes and its position as first child', () => {
      const { wrapper } = mountRow({ unlocked: true });
      // `get` throws if the tick is gone, so reaching the assertion is itself
      // half the test: the glyph must still exist AND still sit in the tick button.
      const tick = wrapper.get('.wall-tick');
      expect(wrapper.get('button[aria-pressed]').element.contains(tick.element)).toBe(true);
      expect(wrapper.get('.wall-job-row').element.firstElementChild).toBe(
        wrapper.get('button[aria-pressed]').element
      );
    });

    it('carries aria-pressed on the tick, and it tracks the done state', async () => {
      const { wrapper } = mountRow({ unlocked: true, job: { ...job, done: true } });
      expect(wrapper.get('button[aria-pressed]').attributes('aria-pressed')).toBe('true');
    });

    it('still ticks while unlocked: edit mode never takes the tick away', async () => {
      const { wrapper } = mountRow({ unlocked: true });
      await wrapper.get('button[aria-pressed]').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('does not tick a row that is mid-write', async () => {
      const { wrapper } = mountRow();
      await wrapper.setProps({ pending: true });
      await wrapper.get('button[aria-pressed]').trigger('click');
      expect(wrapper.emitted('toggle')).toBeUndefined();
    });
  });

  describe('unlocked: rename', () => {
    it('opens the input when the title is tapped, and does NOT tick', async () => {
      const { wrapper } = mountRow({ unlocked: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.find('input').exists()).toBe(true);
      expect(wrapper.emitted('toggle')).toBeUndefined();
    });

    it('seeds the input with the current title', async () => {
      const { wrapper } = mountRow({ unlocked: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect((wrapper.get('input').element as HTMLInputElement).value).toBe('goggles');
    });

    it('renames on Enter and closes the editor', async () => {
      const { wrapper, writers } = mountRow({ unlocked: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      await wrapper.get('input').setValue('swim cap');
      await wrapper.get('input').trigger('keyup.enter');
      await nextTick();
      expect(writers.renameJob).toHaveBeenCalledWith(job, 'swim cap');
      expect(wrapper.find('input').exists()).toBe(false);
    });

    it('cancels on Escape without renaming', async () => {
      const { wrapper, writers } = mountRow({ unlocked: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      await wrapper.get('input').setValue('swim cap');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      expect(writers.renameJob).not.toHaveBeenCalled();
      expect(wrapper.find('input').exists()).toBe(false);
    });

    it('hides the trash while renaming, so the two controls cannot be confused', async () => {
      const { wrapper } = mountRow({ unlocked: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.findComponent(ActionButtons).exists()).toBe(false);
    });

    it('does not start a rename on a row that is mid-write', async () => {
      const { wrapper } = mountRow({ unlocked: true });
      await wrapper.setProps({ pending: true });
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.find('input').exists()).toBe(false);
    });
  });

  describe('unlocked: remove', () => {
    it('shows a trash control at the wall touch size, with no edit pencil beside it', () => {
      const { wrapper } = mountRow({ unlocked: true });
      const actions = wrapper.findComponent(ActionButtons);
      expect(actions.exists()).toBe(true);
      expect(actions.props('size')).toBe('xl');
      expect(actions.props('showEdit')).toBe(false);
    });

    it('removes the job it belongs to', async () => {
      const { wrapper, writers } = mountRow({ unlocked: true });
      await wrapper.findComponent(ActionButtons).vm.$emit('delete');
      expect(writers.removeJob).toHaveBeenCalledWith(job);
    });

    it('does not remove a row that is mid-write', async () => {
      const { wrapper, writers } = mountRow({ unlocked: true });
      await wrapper.setProps({ pending: true });
      await wrapper.findComponent(ActionButtons).vm.$emit('delete');
      expect(writers.removeJob).not.toHaveBeenCalled();
    });
  });

  describe('without the write channel', () => {
    it('renders read-plus-tick rather than controls that would swallow writes', async () => {
      const wrapper = mount(WallJobRow, {
        props: { job, pending: false },
        global: {
          provide: {
            [WALL_LOCK as symbol]: { isLocked: ref(false), noteActivity: vi.fn() },
          },
        },
      });
      expect(wrapper.findComponent(ActionButtons).exists()).toBe(false);
      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.emitted('toggle')).toHaveLength(1);
    });
  });
});
