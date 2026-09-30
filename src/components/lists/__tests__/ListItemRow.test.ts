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
      expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('goggles');
    });

    it('focuses the input so the rename can be typed immediately', async () => {
      // Guards the template-ref wiring: a tap-to-rename that does not focus is
      // broken from the user's side even though every emit assertion passes.
      const w = mountRow({ editing: false, attachTo: document.body });
      await w.setProps({ editing: true });
      await nextTick();
      expect(document.activeElement).toBe(w.get('textarea').element);
      w.unmount();
    });

    it('a soft keyboard Return (insertLineBreak) saves, and never reaches the text', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('swim cap');
      const ev = new InputEvent('beforeinput', { inputType: 'insertLineBreak', cancelable: true });
      w.get('textarea').element.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(w.emitted('edit-save')).toEqual([['swim cap']]);
    });

    it('a paste mid-text lands at the caret as one line', async () => {
      const w = mountRow({ editing: false });
      await w.setProps({ editing: true });
      const ta = w.get('textarea').element as HTMLTextAreaElement;
      ta.setSelectionRange(3, 3); // "gog|gles"
      const ev = new Event('paste', { cancelable: true, bubbles: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => 'X\nY' } });
      ta.dispatchEvent(ev);
      await nextTick();
      expect(ev.defaultPrevented).toBe(true);
      expect(ta.value).toBe('gogX Ygles');
      expect(ta.selectionStart).toBe(6);
      await w.get('textarea').trigger('keydown.enter');
      expect(w.emitted('edit-save')).toEqual([['gogX Ygles']]);
    });

    it('asks the soft keyboard for a "done" key', () => {
      const w = mountRow({ editing: true });
      expect(w.get('textarea').attributes('enterkeyhint')).toBe('done');
    });

    it('saves on Enter', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('swim cap');
      await w.get('textarea').trigger('keydown.enter');
      expect(w.emitted('edit-save')).toEqual([['swim cap']]);
    });

    it('saves on Enter EVEN WHEN BLANK, so clearing the field reverts and never deletes', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('');
      await w.get('textarea').trigger('keydown.enter');
      expect(w.emitted('edit-save')).toEqual([['']]);
    });

    it('saves on blur only when the draft actually changed', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').trigger('blur');
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    it('saves on blur when dirty', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('towel');
      await w.get('textarea').trigger('blur');
      expect(w.emitted('edit-save')).toEqual([['towel']]);
    });

    it('does not save a draft that is only whitespace on blur', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('   ');
      await w.get('textarea').trigger('blur');
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    it('cancels on Esc and suppresses the blur that follows', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('towel');
      pressEscape();
      await w.get('textarea').trigger('blur');
      expect(w.emitted('edit-cancel')).toHaveLength(1);
      expect(w.emitted('edit-save')).toBeUndefined();
    });

    // `wrapper.emitted()` drops its record once the wrapper is unmounted, so these
    // two assert through a real listener instead. That is not a workaround for a
    // component quirk; it is the only way to count emissions that straddle unmount.
    it('commits once, not twice, when Enter is followed by the unmount backstop', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      await w.get('textarea').setValue('towel');
      await w.get('textarea').trigger('keydown.enter');
      w.unmount();
      expect(onEditSave).toHaveBeenCalledTimes(1);
      expect(onEditSave).toHaveBeenCalledWith('towel');
    });

    it('commits a dirty draft on unmount, so closing mid-edit never loses text', async () => {
      const onEditSave = vi.fn();
      const w = mountRow({ editing: true, onEditSave });
      await w.get('textarea').setValue('kickboard');
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
      await w.get('textarea').setValue('towel');
      pressEscape();
      w.unmount();
      expect(onEditSave).not.toHaveBeenCalled();
    });

    it('commits a dirty draft when the parent ends the edit', async () => {
      const w = mountRow({ editing: true });
      await w.get('textarea').setValue('shampoo');
      await w.setProps({ editing: false });
      expect(w.emitted('edit-save')).toEqual([['shampoo']]);
    });
  });

  describe('a long item (#116: merged shopping lines)', () => {
    const long: FamilyListItem = {
      id: 'i2',
      title: 'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)',
      completed: false,
    };

    it('edits in a field that wraps, holding the whole text, and Enter commits it', async () => {
      const w = mount(ListItemRow, {
        props: { item: long, editable: true, removable: true, editing: false },
        attachTo: document.body,
      });
      await w.setProps({ editing: true });
      await nextTick();
      const field = w.get('[data-testid="list-item-edit"]');
      // A textarea (it wraps), never a single-line input that scrolls sideways.
      expect(field.element.tagName).toBe('TEXTAREA');
      expect(w.find('input').exists()).toBe(false);
      expect((field.element as HTMLTextAreaElement).value).toBe(long.title);
      expect(document.activeElement).toBe(field.element);

      await field.setValue(`${long.title} + 1 lb beef`);
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      field.element.dispatchEvent(enter);
      // Enter never adds a line: it is blocked and commits instead.
      expect(enter.defaultPrevented).toBe(true);
      expect(w.emitted('edit-save')).toEqual([[`${long.title} + 1 lb beef`]]);
      w.unmount();
    });

    it('never keeps a line break: a pasted one becomes a space', async () => {
      const w = mount(ListItemRow, {
        props: { item: long, editable: true, removable: true, editing: true },
      });
      await w.get('textarea').setValue('2 onions\n1 lemon');
      await w.get('textarea').trigger('blur');
      expect(w.emitted('edit-save')).toEqual([['2 onions 1 lemon']]);
    });
  });

  describe('read-only variants render unchanged', () => {
    it('shows no input when not editing', () => {
      expect(mountRow({ editing: false }).find('textarea').exists()).toBe(false);
    });

    it('shows no input when the row is not editable at all', async () => {
      const w = mountRow({ editable: false, editing: true });
      expect(w.find('textarea').exists()).toBe(false);
    });

    it('still toggles', async () => {
      const w = mountRow({ editing: false });
      await w.get('button[aria-label="goggles"]').trigger('click');
      expect(w.emitted('toggle')).toEqual([['i1']]);
    });
  });
});
