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
import { __resetWallRowEditForTests } from '@/composables/useWallRowEdit';
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
  beforeEach(() => {
    __resetEscapeCloseForTests();
    // The active row is module-level (one row edits at a time, across every wall
    // surface), so a test that leaves one open would put the next test's row
    // straight into edit mode.
    __resetWallRowEditForTests();
  });

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
  describe('guards found by review', () => {
    it('does not fire a second delete on a double-tap', async () => {
      let release!: (v: boolean) => void;
      const removeJob = vi.fn(() => new Promise<boolean>((r) => (release = r)));
      const { wrapper } = mountRow({ unlocked: true, edit: { removeJob } });

      await wrapper.findComponent(ActionButtons).vm.$emit('delete');
      await wrapper.findComponent(ActionButtons).vm.$emit('delete');

      expect(removeJob).toHaveBeenCalledTimes(1);
      release(true);
    });

    it('accepts a delete again once the first one has landed', async () => {
      const removeJob = vi.fn().mockResolvedValue(true);
      const { wrapper } = mountRow({ unlocked: true, edit: { removeJob } });

      await wrapper.findComponent(ActionButtons).vm.$emit('delete');
      await nextTick();
      await wrapper.findComponent(ActionButtons).vm.$emit('delete');

      expect(removeJob).toHaveBeenCalledTimes(2);
    });

    it('closes an open rename when the wall relocks, rather than writing past the padlock', async () => {
      const isLocked = ref(false);
      const writers = {
        addListItem: vi.fn().mockResolvedValue(true),
        addTodo: vi.fn().mockResolvedValue(true),
        renameJob: vi.fn().mockResolvedValue(true),
        removeJob: vi.fn().mockResolvedValue(true),
      };
      const wrapper = mount(WallJobRow, {
        props: { job, pending: false },
        global: {
          provide: {
            [WALL_LOCK as symbol]: { isLocked, noteActivity: vi.fn() },
            [WALL_EDIT as symbol]: writers,
          },
        },
      });

      await wrapper.get('button:not([aria-pressed])').trigger('click');
      expect(wrapper.find('input').exists()).toBe(true);

      // The 2-minute idle timer fires while the editor sits untouched.
      isLocked.value = true;
      await nextTick();

      expect(wrapper.find('input').exists()).toBe(false);
      expect(wrapper.findComponent(ActionButtons).exists()).toBe(false);
    });
  });

  /**
   * One row at a time. Two live inputs on a wall is a state nobody can reason
   * about, and an unchanged row used to stay open forever because the
   * commit-on-blur path only runs when the draft is dirty.
   */
  describe('only one row edits at a time', () => {
    function twoRows() {
      const writers = {
        addListItem: vi.fn().mockResolvedValue(true),
        addTodo: vi.fn().mockResolvedValue(true),
        renameJob: vi.fn().mockResolvedValue(true),
        removeJob: vi.fn().mockResolvedValue(true),
      };
      const provide = {
        [WALL_LOCK as symbol]: { isLocked: ref(false), noteActivity: vi.fn() },
        [WALL_EDIT as symbol]: writers,
      };
      const a = mount(WallJobRow, {
        props: { job, pending: false },
        global: { provide },
      });
      const b = mount(WallJobRow, {
        props: { job: { ...job, key: 'list:l1:i2', itemId: 'i2', title: 'towel' }, pending: false },
        global: { provide },
      });
      return { a, b, writers };
    }

    const openRename = (w: ReturnType<typeof mount>) =>
      w.get('button:not([aria-pressed])').trigger('click');

    it('closes the first row when a second is tapped', async () => {
      const { a, b } = twoRows();
      await openRename(a);
      expect(a.find('input').exists()).toBe(true);

      await openRename(b);
      await nextTick();

      expect(a.find('input').exists()).toBe(false);
      expect(b.find('input').exists()).toBe(true);
    });

    it('SAVES the first row rather than discarding it when switching', async () => {
      const { a, b, writers } = twoRows();
      await openRename(a);
      await a.get('input').setValue('swim cap');

      await openRename(b);
      await nextTick();

      expect(writers.renameJob).toHaveBeenCalledWith(job, 'swim cap');
    });

    it('lets the new row keep the claim when the old row tears down', async () => {
      const { a, b } = twoRows();
      await openRename(a);
      await openRename(b);
      await nextTick();
      // a's input unmounted and blurred on the way out; b must survive that.
      expect(b.find('input').exists()).toBe(true);
    });

    it('closes on blur even when nothing was changed', async () => {
      const { a } = twoRows();
      await openRename(a);
      expect(a.find('input').exists()).toBe(true);

      await a.get('input').trigger('blur');
      await nextTick();

      expect(a.find('input').exists()).toBe(false);
    });

    it('closes on blur after a change, and saves it', async () => {
      const { a, writers } = twoRows();
      await openRename(a);
      await a.get('input').setValue('goggles case');
      await a.get('input').trigger('blur');
      await nextTick();

      expect(a.find('input').exists()).toBe(false);
      expect(writers.renameJob).toHaveBeenCalledWith(job, 'goggles case');
    });
  });
});
