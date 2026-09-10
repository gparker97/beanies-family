/**
 * Characterisation test for `ListItemRow`.
 *
 * Written against the UNCONVERTED component, before `useInlineRename` was
 * extracted from it, so that the extraction has a real gate rather than an
 * assumed one. The component had no unit test and no E2E coverage at all
 * despite being consumed by `ListDetailModal`, `LinkedLists` and
 * `ListCycleModal`.
 *
 * The Enter/blur asymmetry below is the load-bearing part and is easy to
 * "simplify" away by mistake:
 *   - Enter saves UNCONDITIONALLY, so clearing the field and pressing Enter
 *     reverts cleanly (the store no-ops an empty or unchanged title) rather
 *     than deleting the item.
 *   - blur, unmount and the falling edge of `editing` save ONLY when dirty.
 *   - whichever path fires first wins; the rest are no-ops.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { __resetEscapeCloseForTests } from '@/composables/useEscapeClose';
import type { FamilyListItem } from '@/types/models';
import ListItemRow from '../ListItemRow.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const item: FamilyListItem = { id: 'i1', title: 'goggles', completed: false };

/**
 * Escape is handled by the shared `useEscapeClose` stack (a window `keydown`),
 * not by a `keyup.esc` binding on the input. That moved during the
 * `useInlineRename` extraction and is a deliberate behaviour change: Escape now
 * cancels the edit even when focus has left the input, and an editing row sits
 * on top of the stack so one press cancels the rename without also dismissing
 * whatever it is nested inside.
 */
function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

function mountRow(props: Record<string, unknown> = {}) {
  const { attachTo, ...rest } = props as { attachTo?: HTMLElement };
  return mount(ListItemRow, {
    props: { item, editable: true, removable: true, ...rest },
    ...(attachTo ? { attachTo } : {}),
  });
}

describe('ListItemRow', () => {
  beforeEach(() => {
    // Module-level stack; a row left registered by a previous test would eat
    // the next test's Escape.
    __resetEscapeCloseForTests();
  });

  describe('inline rename', () => {
    it('populates the draft from the item when editing begins', async () => {
      const w = mountRow({ editing: false });
      await w.setProps({ editing: true });
      expect((w.get('input').element as HTMLInputElement).value).toBe('goggles');
    });

    it('focuses the input so the rename can be typed immediately', async () => {
      // Guards the template-ref wiring: a tap-to-rename that does not focus is
      // broken from the user's side even though every emit assertion passes.
      const w = mountRow({ editing: false, attachTo: document.body });
      await w.setProps({ editing: true });
      await nextTick();
      expect(document.activeElement).toBe(w.get('input').element);
      w.unmount();
    });

    it('saves on Enter', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('swim cap');
      await w.get('input').trigger('keyup.enter');
      expect(w.emitted('edit-save')).toEqual([['swim cap']]);
    });

    it('saves on Enter EVEN WHEN BLANK, so clearing the field reverts and never deletes', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('');
      await w.get('input').trigger('keyup.enter');
      expect(w.emitted('edit-save')).toEqual([['']]);
    });

    it('saves on blur only when the draft actually changed', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').trigger('blur');
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    it('saves on blur when dirty', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('towel');
      await w.get('input').trigger('blur');
      expect(w.emitted('edit-save')).toEqual([['towel']]);
    });

    it('does not save a draft that is only whitespace on blur', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('   ');
      await w.get('input').trigger('blur');
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    it('cancels on Esc and suppresses the blur that follows', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('towel');
      pressEscape();
      await w.get('input').trigger('blur');
      expect(w.emitted('edit-cancel')).toHaveLength(1);
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    // `wrapper.emitted()` drops its record once the wrapper is unmounted, so these
    // two assert through a real listener instead. That is not a workaround for a
    // component quirk; it is the only way to count emissions that straddle unmount.
    it('commits once, not twice, when Enter is followed by the unmount backstop', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      await w.get('input').setValue('towel');
      await w.get('input').trigger('keyup.enter');
      w.unmount();
      expect(onEditSave).toHaveBeenCalledTimes(1);
      expect(onEditSave).toHaveBeenCalledWith('towel');
    });

    it('commits a dirty draft on unmount, so closing mid-edit never loses text', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      await w.get('input').setValue('kickboard');
      w.unmount();
      expect(onEditSave).toHaveBeenCalledTimes(1);
      expect(onEditSave).toHaveBeenCalledWith('kickboard');
    });

    it('does not commit anything on unmount when the draft is clean', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      w.unmount();
      expect(onEditSave).not.toHaveBeenCalled();
    });

    it('does not commit on unmount after Esc', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      await w.get('input').setValue('towel');
      pressEscape();
      w.unmount();
      expect(onEditSave).not.toHaveBeenCalled();
    });

    it('commits a dirty draft when the parent ends the edit', async () => {
      const w = mountRow({ editing: true });
      await w.get('input').setValue('shampoo');
      await w.setProps({ editing: false });
      expect(w.emitted('edit-save')).toEqual([['shampoo']]);
    });
  });

  describe('read-only variants render unchanged', () => {
    it('shows no input when not editing', () => {
      expect(mountRow({ editing: false }).find('input').exists()).toBe(false);
    });

    it('shows no input when the row is not editable at all', async () => {
      const w = mountRow({ editable: false, editing: true });
      expect(w.find('input').exists()).toBe(false);
    });

    it('still toggles', async () => {
      const w = mountRow({ editing: false });
      await w.get('button[aria-label="goggles"]').trigger('click');
      expect(w.emitted('toggle')).toEqual([['i1']]);
    });
  });
});
